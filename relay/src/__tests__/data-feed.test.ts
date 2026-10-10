import request from "supertest";
import { io as ioClient, Socket } from "socket.io-client";
import type { AddressInfo } from "net";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// Covers the Data Feed add-on's authenticated REST route and the
// DISPLAY_TOKEN_REQUIRED rollout flag on the public /state route — both
// gated by a mocked @scorehub/db so multi-tenant branches (orgHasAddOn,
// ScopedToken lookup, Match.displayToken) are actually exercised, unlike
// graphics.test.ts's legacy-mode-only coverage.
jest.mock("@scorehub/db", () => {
  const orgs = new Map<string, { accountId: string }>();
  const accounts = new Map<string, { plan: string; addOns: string[] }>();
  const tokens = new Map<string, { type: string; orgId: string; matchId?: string; revokedAt: Date | null }>();
  const matches = new Map<string, { id: string; orgId: string; state: unknown; status: string; displayToken: string | null }>();

  function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  return {
    recordAuditEvent: jest.fn(),
    __seedOrg(orgId: string, accountId: string, addOns: string[] = []) {
      orgs.set(orgId, { accountId });
      accounts.set(accountId, { plan: "pro", addOns });
    },
    __seedToken(plaintext: string, data: { type: string; orgId: string; matchId?: string; revokedAt?: Date | null }) {
      tokens.set(hashToken(plaintext), { revokedAt: null, ...data });
    },
    __seedMatch(id: string, data: { orgId: string; state?: unknown; status?: string; displayToken?: string | null }) {
      matches.set(id, { id, orgId: data.orgId, state: data.state ?? { sport: "netball" }, status: data.status ?? "LIVE", displayToken: data.displayToken ?? null });
    },
    __reset() {
      orgs.clear();
      accounts.clear();
      tokens.clear();
      matches.clear();
    },
    prisma: {
      org: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const org = orgs.get(where.id);
          if (!org) return null;
          const account = accounts.get(org.accountId);
          return { accountId: org.accountId, account: { plan: account?.plan ?? "free", addOns: account?.addOns ?? [] } };
        }),
      },
      scopedToken: {
        findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => tokens.get(where.tokenHash) ?? null),
      },
      match: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => matches.get(where.id) ?? null),
        findFirst: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        update: jest.fn(async ({ where }: { where: { id: string } }) => matches.get(where.id)),
      },
    },
  };
});

import { createServer } from "../server";
import * as db from "@scorehub/db";

type Db = {
  __seedOrg: (orgId: string, accountId: string, addOns?: string[]) => void;
  __seedToken: (plaintext: string, data: { type: string; orgId: string; matchId?: string; revokedAt?: Date | null }) => void;
  __seedMatch: (id: string, data: { orgId: string; state?: unknown; status?: string; displayToken?: string | null }) => void;
  __reset: () => void;
};
const { __seedOrg: seedOrg, __seedToken: seedToken, __seedMatch: seedMatch, __reset: resetSeed } = db as unknown as Db;

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

// DISPLAY_TOKEN_REQUIRED is read once at createServer() time (same pattern
// as every other secret/option) — so soft vs. enforced mode needs two
// separate server instances, not a mid-test env var flip, which the running
// server would never observe.
let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let softApp: ReturnType<typeof createServer>["app"];
let softHttpServer: ReturnType<typeof createServer>["httpServer"];
let closeSoftServer: ReturnType<typeof createServer>["close"];
let enforcedApp: ReturnType<typeof createServer>["app"];
let enforcedHttpServer: ReturnType<typeof createServer>["httpServer"];
let closeEnforcedServer: ReturnType<typeof createServer>["close"];
let uploadDir: string;
let softUploadDir: string;
let enforcedUploadDir: string;

beforeAll(done => {
  process.env.DATABASE_URL = "postgresql://fake-for-tests";
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-data-feed-test-"));
  softUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-data-feed-soft-test-"));
  enforcedUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-data-feed-enforced-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: "test-bridge-secret",
    controlSecret: "test-control-secret",
    dataFeedSecret: "test-data-feed-secret",
    uploadDir,
    allowedOrigins: ["http://localhost:3000"],
  }));
  ({ app: softApp, httpServer: softHttpServer, close: closeSoftServer } = createServer({
    bridgeSecret: "test-bridge-secret",
    controlSecret: "test-control-secret",
    displayTokenRequired: false,
    uploadDir: softUploadDir,
    allowedOrigins: ["http://localhost:3000"],
  }));
  ({ app: enforcedApp, httpServer: enforcedHttpServer, close: closeEnforcedServer } = createServer({
    bridgeSecret: "test-bridge-secret",
    controlSecret: "test-control-secret",
    displayTokenRequired: true,
    uploadDir: enforcedUploadDir,
    allowedOrigins: ["http://localhost:3000"],
  }));
  let pending = 3;
  const onListening = () => { if (--pending === 0) done(); };
  httpServer.listen(0, onListening);
  softHttpServer.listen(0, onListening);
  enforcedHttpServer.listen(0, onListening);
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(softUploadDir, { recursive: true, force: true });
  fs.rmSync(enforcedUploadDir, { recursive: true, force: true });
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  let pending = 3;
  const onClosed = () => { if (--pending === 0) done(); };
  closeServer(onClosed);
  closeSoftServer(onClosed);
  closeEnforcedServer(onClosed);
});

beforeEach(() => {
  resetSeed();
});

describe("GET /api/data-feed/state", () => {
  it("401s with no secret header", async () => {
    const res = await request(app).get("/api/data-feed/state");
    expect(res.status).toBe(401);
  });

  it("401s with a wrong secret", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    const res = await request(app).get("/api/data-feed/state").set("x-data-feed-secret", "wrong");
    expect(res.status).toBe(401);
  });

  it("403s for a valid token whose org lacks the data-feed add-on", async () => {
    seedOrg("org-1", "acc-1", []);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1" });
    const res = await request(app).get("/api/data-feed/state").set("x-data-feed-secret", "tok-1");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/data-feed add-on/);
  });

  it("200s and returns state for an entitled org", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1", matchId: "match-1" });
    seedMatch("match-1", { orgId: "org-1" });
    const res = await request(app).get("/api/data-feed/state").set("x-data-feed-secret", "tok-1");
    expect(res.status).toBe(200);
    expect(res.body.sport).toBe("netball");
  });

  // SA-162: looking at an upcoming fixture must not start it.
  it("returns an upcoming fixture's state without making it live", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1" });
    seedMatch("fixture-1", { orgId: "org-1", status: "SCHEDULED", state: { sport: "hockey" } });
    const update = (db as unknown as { prisma: { match: { update: jest.Mock } } }).prisma.match.update;
    update.mockClear();
    const res = await request(app).get("/api/data-feed/state").query({ matchId: "fixture-1" }).set("x-data-feed-secret", "tok-1");
    expect(res.status).toBe(200);
    expect(res.body.sport).toBe("hockey");
    expect(update).not.toHaveBeenCalled();
  });

  it("404s for a match in another org", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1" });
    seedMatch("other-1", { orgId: "org-2" });
    const res = await request(app).get("/api/data-feed/state").query({ matchId: "other-1" }).set("x-data-feed-secret", "tok-1");
    expect(res.status).toBe(404);
  });

  it("401s for a token of the wrong type (e.g. BRIDGE)", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "BRIDGE", orgId: "org-1" });
    const res = await request(app).get("/api/data-feed/state").set("x-data-feed-secret", "tok-1");
    expect(res.status).toBe(401);
  });

  it("401s for a revoked token", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1", revokedAt: new Date() });
    const res = await request(app).get("/api/data-feed/state").set("x-data-feed-secret", "tok-1");
    expect(res.status).toBe(401);
  });
});

describe("GET /state — DISPLAY_TOKEN_REQUIRED rollout", () => {
  it("soft mode (flag off): allows a request with no token at all", async () => {
    seedMatch("match-1", { orgId: "org-1", displayToken: "the-real-token" });
    const res = await request(softApp).get("/state").query({ org: "org-1", matchId: "match-1" });
    expect(res.status).toBe(200);
  });

  it("soft mode: still rejects a wrong token", async () => {
    seedMatch("match-1", { orgId: "org-1", displayToken: "the-real-token" });
    const res = await request(softApp).get("/state").query({ org: "org-1", matchId: "match-1", token: "wrong" });
    expect(res.status).toBe(403);
  });

  it("soft mode: accepts the correct token", async () => {
    seedMatch("match-1", { orgId: "org-1", displayToken: "the-real-token" });
    const res = await request(softApp).get("/state").query({ org: "org-1", matchId: "match-1", token: "the-real-token" });
    expect(res.status).toBe(200);
  });

  it("enforced mode: rejects a request with no token", async () => {
    seedMatch("match-1", { orgId: "org-1", displayToken: "the-real-token" });
    const res = await request(enforcedApp).get("/state").query({ org: "org-1", matchId: "match-1" });
    expect(res.status).toBe(403);
  });

  it("enforced mode: accepts the correct token", async () => {
    seedMatch("match-1", { orgId: "org-1", displayToken: "the-real-token" });
    const res = await request(enforcedApp).get("/state").query({ org: "org-1", matchId: "match-1", token: "the-real-token" });
    expect(res.status).toBe(200);
  });

  it("a match with no displayToken yet (pre-backfill) is never blocked, even in enforced mode", async () => {
    seedMatch("match-1", { orgId: "org-1", displayToken: null });
    const res = await request(enforcedApp).get("/state").query({ org: "org-1", matchId: "match-1" });
    expect(res.status).toBe(200);
  });
});

// SA-163: a data feed token that isn't pinned to one match names the match in
// the handshake. It has proved itself with its secret, so it isn't asked for
// the match's display token as well.
describe("data-feed socket with a token not pinned to a match", () => {
  let socket: Socket | undefined;
  afterEach(() => { socket?.disconnect(); socket = undefined; });

  function connect(auth: Record<string, string>): Socket {
    const { port } = enforcedHttpServer.address() as AddressInfo;
    socket = ioClient(`http://localhost:${port}`, { auth, transports: ["websocket"], reconnection: false });
    return socket;
  }

  it("joins the match it asks for and is sent its state", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1" });
    seedMatch("match-9", { orgId: "org-1", displayToken: "display-tok", state: { sport: "hockey" } });
    const s = connect({ role: "data-feed", secret: "tok-1", matchId: "match-9" });
    const state = await new Promise<{ sport: string }>((resolve, reject) => {
      s.on("matchStateChange", resolve);
      s.on("connect_error", reject);
    });
    expect(state.sport).toBe("hockey");
  });

  it("is refused a match that belongs to another org", async () => {
    seedOrg("org-1", "acc-1", ["data-feed"]);
    seedToken("tok-1", { type: "DATA_FEED", orgId: "org-1" });
    seedMatch("other-1", { orgId: "org-2", displayToken: "display-tok" });
    const s = connect({ role: "data-feed", secret: "tok-1", matchId: "other-1" });
    const err = await new Promise<Error>(resolve => s.on("connect_error", resolve));
    expect(err.message).toBe("match not found");
  });

  it("still asks an unauthenticated viewer for the display token", async () => {
    seedMatch("match-9", { orgId: "org-1", displayToken: "display-tok" });
    const s = connect({ matchId: "match-9" });
    const err = await new Promise<Error>(resolve => s.on("connect_error", resolve));
    expect(err.message).toBe("invalid or missing display token");
  });
});
