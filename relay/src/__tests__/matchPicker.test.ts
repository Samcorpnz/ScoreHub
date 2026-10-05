import request from "supertest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// Bridging is gated on the Data Feed add-on (SA-114), and unpinned Bridge /
// Stream Deck tokens choose their own match (SA-145). Multi-tenant branches
// only, via a mocked @scorehub/db — legacy mode has neither add-ons nor
// matches to pick from.
jest.mock("@scorehub/db", () => {
  const orgs = new Map<string, { accountId: string }>();
  const accounts = new Map<string, { plan: string; addOns: string[] }>();
  const tokens = new Map<string, { type: string; orgId: string; matchId?: string; revokedAt: Date | null }>();
  type Row = { id: string; orgId: string; status: string; sport: string | null; homeName: string | null; visitorName: string | null; scheduledAt: Date | null; displayToken: string | null };
  const matches = new Map<string, Row>();
  const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

  return {
    recordAuditEvent: jest.fn(),
    __seedOrg(orgId: string, addOns: string[] = []) {
      orgs.set(orgId, { accountId: `acct-${orgId}` });
      accounts.set(`acct-${orgId}`, { plan: "pro", addOns });
    },
    __seedToken(plaintext: string, data: { type: string; orgId: string; matchId?: string }) {
      tokens.set(hashToken(plaintext), { revokedAt: null, ...data });
    },
    __seedMatch(id: string, data: Partial<Row> & { orgId: string }) {
      matches.set(id, { id, status: "LIVE", sport: "netball", homeName: "Hawks", visitorName: "Owls", scheduledAt: null, displayToken: `dt-${id}`, ...data });
    },
    __reset() { orgs.clear(); accounts.clear(); tokens.clear(); matches.clear(); },
    prisma: {
      org: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const org = orgs.get(where.id);
          if (!org) return null;
          const account = accounts.get(org.accountId)!;
          return { accountId: org.accountId, account };
        }),
      },
      scopedToken: {
        findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => tokens.get(where.tokenHash) ?? null),
      },
      match: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => matches.get(where.id) ?? null),
        findMany: jest.fn(async ({ where }: { where: { orgId: string; status: { in: string[] }; id?: string } }) =>
          [...matches.values()].filter(m => m.orgId === where.orgId && where.status.in.includes(m.status) && (!where.id || m.id === where.id))),
      },
    },
  };
});

import { createServer } from "../server";
import { resolveBridgeAccess, BRIDGE_ADDON_REQUIRED_MESSAGE } from "../matchPicker";
import * as db from "@scorehub/db";

const { __seedOrg: seedOrg, __seedToken: seedToken, __seedMatch: seedMatch, __reset: resetSeed } = db as unknown as {
  __seedOrg: (orgId: string, addOns?: string[]) => void;
  __seedToken: (plaintext: string, data: { type: string; orgId: string; matchId?: string }) => void;
  __seedMatch: (id: string, data: { orgId: string; status?: string; homeName?: string; visitorName?: string }) => void;
  __reset: () => void;
};

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
let app: ReturnType<typeof createServer>["app"];
let closeServer: ReturnType<typeof createServer>["close"];
let uploadDir: string;

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://fake-for-tests";
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-match-picker-test-"));
  ({ app, close: closeServer } = createServer({
    bridgeSecret: "test-bridge-secret",
    controlSecret: "test-control-secret",
    uploadDir,
    allowedOrigins: ["http://localhost:3000"],
  }));
});

afterAll(async () => {
  await closeServer();
  fs.rmSync(uploadDir, { recursive: true, force: true });
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

beforeEach(() => {
  resetSeed();
  seedOrg("org-paid", ["data-feed"]);
  seedOrg("org-free");
  seedOrg("org-other", ["data-feed"]);
  seedToken("bridge-paid", { type: "BRIDGE", orgId: "org-paid" });
  seedToken("bridge-pinned", { type: "BRIDGE", orgId: "org-paid", matchId: "m-live" });
  seedToken("bridge-free", { type: "BRIDGE", orgId: "org-free" });
  seedToken("control-free", { type: "CONTROL", orgId: "org-free" });
  seedMatch("m-live", { orgId: "org-paid" });
  seedMatch("m-next", { orgId: "org-paid", status: "SCHEDULED", homeName: "Kea", visitorName: "Tui" });
  seedMatch("m-done", { orgId: "org-paid", status: "ENDED" });
  seedMatch("m-other", { orgId: "org-other" });
  seedMatch("m-free", { orgId: "org-free" });
});

describe("resolveBridgeAccess", () => {
  it("returns null for an unknown secret", async () => {
    expect(await resolveBridgeAccess("nope", "legacy", undefined)).toBeNull();
  });

  it("refuses an org without the Data Feed add-on (SA-114)", async () => {
    expect(await resolveBridgeAccess("bridge-free", "legacy", undefined)).toEqual({ ok: false, error: BRIDGE_ADDON_REQUIRED_MESSAGE });
  });

  it("lets an unpinned token attach to a match it asks for (SA-145)", async () => {
    expect(await resolveBridgeAccess("bridge-paid", "legacy", "m-live")).toEqual({ ok: true, orgId: "org-paid", matchId: "m-live" });
  });

  it("keeps the org default room when an unpinned token asks for no match", async () => {
    expect(await resolveBridgeAccess("bridge-paid", "legacy", undefined)).toEqual({ ok: true, orgId: "org-paid", matchId: undefined });
  });

  it("ignores the requested match when the token is pinned", async () => {
    expect(await resolveBridgeAccess("bridge-pinned", "legacy", "m-next")).toEqual({ ok: true, orgId: "org-paid", matchId: "m-live" });
  });

  it("refuses another org's match", async () => {
    const access = await resolveBridgeAccess("bridge-paid", "legacy", "m-other");
    expect(access).toMatchObject({ ok: false });
  });

  it("refuses a match that has ended", async () => {
    const access = await resolveBridgeAccess("bridge-paid", "legacy", "m-done");
    expect(access).toMatchObject({ ok: false, error: expect.stringMatching(/ended/) });
  });
});

describe("GET /api/matches", () => {
  it("401s without a valid token", async () => {
    expect((await request(app).get("/api/matches")).status).toBe(401);
    expect((await request(app).get("/api/matches").set("x-bridge-secret", "nope")).status).toBe(401);
  });

  it("lists the org's live and upcoming matches for a Bridge token, without display tokens", async () => {
    const res = await request(app).get("/api/matches").set("x-bridge-secret", "bridge-paid");
    expect(res.status).toBe(200);
    expect(res.body.pinnedMatchId).toBeNull();
    expect(res.body.matches.map((m: { id: string }) => m.id).sort()).toEqual(["m-live", "m-next"]);
    expect(res.body.matches.find((m: { id: string }) => m.id === "m-next").name).toBe("Kea v Tui");
    expect(res.body.matches[0]).not.toHaveProperty("displayToken");
  });

  it("returns only the pinned match for a pinned token", async () => {
    const res = await request(app).get("/api/matches").set("x-bridge-secret", "bridge-pinned");
    expect(res.body.pinnedMatchId).toBe("m-live");
    expect(res.body.matches.map((m: { id: string }) => m.id)).toEqual(["m-live"]);
  });

  it("403s a Bridge token whose org lacks the Data Feed add-on", async () => {
    const res = await request(app).get("/api/matches").set("x-bridge-secret", "bridge-free");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(BRIDGE_ADDON_REQUIRED_MESSAGE);
  });

  it("lists matches for a Stream Deck (CONTROL) token with no add-on needed, including display tokens", async () => {
    const res = await request(app).get("/api/matches").set("x-control-secret", "control-free");
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([expect.objectContaining({ id: "m-free", displayToken: "dt-m-free" })]);
  });
});
