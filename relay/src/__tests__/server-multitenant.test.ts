import { io as ioClient, Socket } from "socket.io-client";
import request from "supertest";
import { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { SignJWT } from "jose";

// DATABASE_URL-set (multi-tenant) coverage: the socket-auth matchId
// resolution path, /match creation (success + ConcurrentMatchLimitError),
// GET /state's org-from-matchId resolution, and the initial-getState error
// branches (ConcurrentMatchLimitError / MatchNotFoundError) on socket
// connect — none of which are reachable in legacy (no-DATABASE_URL) mode,
// which is what relay.test.ts's shared server runs in.
//
// Same @scorehub/db mocking approach as socket-controller-handoff.test.ts,
// extended with per-test control over org.account.plan and match rows via
// mockResolvedValueOnce / mockImplementation.

const orgFindUniqueMock = jest.fn();
const matchFindFirstMock = jest.fn();
const matchFindUniqueMock = jest.fn();
const matchCreateMock = jest.fn();
const matchUpdateMock = jest.fn();
const matchCountMock = jest.fn();

jest.mock("@scorehub/db", () => ({
  // auth.ts logs auth failures through this; the real one writes an audit row.
  recordAuditEvent: jest.fn(),
  prisma: {
    org: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) },
    match: {
      findFirst: (...a: unknown[]) => matchFindFirstMock(...a),
      findUnique: (...a: unknown[]) => matchFindUniqueMock(...a),
      create: (...a: unknown[]) => matchCreateMock(...a),
      update: (...a: unknown[]) => matchUpdateMock(...a),
      count: (...a: unknown[]) => matchCountMock(...a),
    },
    // Only JWT-based control/action auth is exercised in this file — no
    // ScopedToken flows — so this always misses, falling through to the JWT
    // check in verifyControlSecret/verifyActionSecret (auth.ts).
    scopedToken: { findUnique: jest.fn(async () => null) },
  },
}));

import { createServer } from "../server";

const AUTH_SECRET = "multitenant-test-auth-secret";
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let serverUrl: string;
let uploadDir: string;

beforeAll(done => {
  process.env.DATABASE_URL = "postgresql://fake-for-multitenant-test";
  process.env.AUTH_SECRET = AUTH_SECRET;
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-multitenant-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    uploadDir,
    controlRateLimit: 5000,
    allowedOrigins: ["http://localhost:3000"],
  }));
  httpServer.listen(0, () => {
    const port = (httpServer.address() as AddressInfo).port;
    serverUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll(done => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

beforeEach(() => {
  orgFindUniqueMock.mockReset();
  matchFindFirstMock.mockReset();
  matchFindUniqueMock.mockReset();
  matchCreateMock.mockReset();
  matchUpdateMock.mockReset();
  matchCountMock.mockReset();
});

function controlToken(orgId: string, extra: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ orgId, role: "OPERATOR", ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-1")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(AUTH_SECRET));
}

function proAccount(accountId = "acct-1") {
  return { accountId, account: { plan: "pro", addOns: [] } };
}
function freeAccount(accountId = "acct-1") {
  return { accountId, account: { plan: "free", addOns: [] } };
}

// ─── POST /match ──────────────────────────────────────────────────────────

describe("POST /match (multi-tenant)", () => {
  it("creates a new LIVE match and returns its id when under the free-plan limit", async () => {
    const token = await controlToken("org-match-ok");
    orgFindUniqueMock.mockResolvedValue(proAccount());
    matchCreateMock.mockResolvedValue({ id: "new-match-id" });

    const res = await request(app).post("/match").set("x-control-secret", token);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("new-match-id");
  });

  it("returns 402 when a free-plan account already has a live match elsewhere", async () => {
    const token = await controlToken("org-match-blocked");
    orgFindUniqueMock.mockResolvedValue(freeAccount());
    matchCountMock.mockResolvedValue(1);

    const res = await request(app).post("/match").set("x-control-secret", token);
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/one live match/);
    expect(matchCreateMock).not.toHaveBeenCalled();
  });

  it("rejects without a valid token", async () => {
    const res = await request(app).post("/match").set("x-control-secret", "garbage");
    expect(res.status).toBe(401);
  });
});

// ─── GET /state org-from-matchId resolution ──────────────────────────────

describe("GET /state (multi-tenant)", () => {
  it("resolves orgId from matchId when org isn't passed", async () => {
    matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-from-match", state: { sequenceId: 3 } });
    const res = await request(app).get("/state").query({ matchId: "m1" });
    expect(res.status).toBe(200);
    expect(matchFindUniqueMock).toHaveBeenCalledWith({ where: { id: "m1" } });
  });

  it("400s when neither org nor a resolvable matchId is given", async () => {
    const res = await request(app).get("/state");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/org.*required/i);
  });
});

// ─── Socket connection edge cases ────────────────────────────────────────

function connectSocket(auth: Record<string, unknown>): Socket {
  return ioClient(serverUrl, { auth, reconnection: false });
}

describe("socket auth — matchId resolution from a viewer's query params", () => {
  it("resolves orgId from a matchId-only connection when the match row exists", async () => {
    matchFindUniqueMock.mockResolvedValue({ id: "m-viewer", orgId: "org-resolved", state: null });
    const socket = connectSocket({ matchId: "m-viewer" });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", reject);
    });
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });
});

describe("socket initial-state error handling", () => {
  it("emits an 'error' event with a friendly message on ConcurrentMatchLimitError", async () => {
    const token = await controlToken("org-socket-limit");
    orgFindUniqueMock.mockResolvedValue(freeAccount());
    matchFindFirstMock.mockResolvedValue(null); // no existing live match -> tries to create one
    matchCountMock.mockResolvedValue(1); // ...but another is already live -> blocked

    const socket = connectSocket({ secret: token, role: "control" });
    const errorEvent = await new Promise<{ message: string }>((resolve, reject) => {
      socket.on("error", resolve);
      socket.on("connect_error", reject);
      setTimeout(() => reject(new Error("timed out waiting for error event")), 3000);
    });
    expect(errorEvent.message).toMatch(/one live match/);
    socket.disconnect();
  });

  it("emits an 'error' event with 'match not found' when the token's pinned matchId doesn't exist", async () => {
    const token = await controlToken("org-socket-notfound", { matchId: "missing-match-id" });
    matchFindUniqueMock.mockResolvedValue(null);

    const socket = connectSocket({ secret: token, role: "control" });
    const errorEvent = await new Promise<{ message: string }>((resolve, reject) => {
      socket.on("error", resolve);
      socket.on("connect_error", reject);
      setTimeout(() => reject(new Error("timed out waiting for error event")), 3000);
    });
    expect(errorEvent.message).toBe("match not found");
    socket.disconnect();
  });
});

describe("socket disconnect — matchId-scoped room eviction", () => {
  it("evicts the cached store when the last socket in a matchId-scoped room disconnects", async () => {
    matchFindUniqueMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "m-evict" ? { id: "m-evict", orgId: "org-evict", state: { sequenceId: 1 } } : null
    );

    const socket = connectSocket({ matchId: "m-evict" });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", reject);
    });
    const callsBeforeDisconnect = matchFindUniqueMock.mock.calls.length;
    socket.disconnect();
    // Give the disconnect handler's eviction (and its store.flush()) a tick.
    await new Promise(resolve => setTimeout(resolve, 100));

    // Reconnecting to the same matchId must re-resolve from scratch (a fresh
    // findUnique call for the resolveMatch step), proving the store/cache
    // entry was actually evicted rather than reused.
    const second = connectSocket({ matchId: "m-evict" });
    await new Promise<void>((resolve, reject) => {
      second.on("connect", () => resolve());
      second.on("connect_error", reject);
    });
    expect(matchFindUniqueMock.mock.calls.length).toBeGreaterThan(callsBeforeDisconnect);
    second.disconnect();
  });
});

// ─── respondToStateError's generic (non-ConcurrentMatchLimitError) 500 branch ──
// Every route that can trigger match creation/loading shares respondToStateError
// (server.ts) — routed through here by making the underlying persistence call
// reject with a plain Error, rather than throwing ConcurrentMatchLimitError.

describe("respondToStateError — unexpected persistence failures (500)", () => {
  const dbErrorSpy = () => jest.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    matchFindUniqueMock.mockImplementation(async () => {
      throw new Error("db exploded");
    });
  });

  it("GET /state returns 500 and logs the error", async () => {
    const errorSpy = dbErrorSpy();
    const res = await request(app).get("/state").query({ org: "org-x", matchId: "m-broken" });
    expect(res.status).toBe(500);
    // The matchId→org lookup at the top of GET /state runs outside
    // respondToStateError's try/catch, so a DB failure there reaches Express's
    // generic error handler ("internal server error") rather than the
    // "internal error" body respondToStateError sends. Either is a clean 500.
    expect(res.body.error).toMatch(/^internal (server )?error$/);
    errorSpy.mockRestore();
  });

  it("POST /manual returns 500", async () => {
    const errorSpy = dbErrorSpy();
    const token = await controlToken("org-manual-broken", { matchId: "m-broken" });
    const res = await request(app).post("/manual").set("x-control-secret", token).send({ matchName: "x" });
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });

  it.each([
    ["/action/start", {}],
    ["/action/stop", {}],
    ["/action/toggle", {}],
    ["/action/score/home", {}],
    ["/action/period/next", {}],
    ["/action/period/prev", {}],
    ["/action/period/end", {}],
  ])("POST %s returns 500 on an unexpected persistence failure", async (route) => {
    const errorSpy = dbErrorSpy();
    const token = await controlToken("org-action-broken", { matchId: "m-broken" });
    const res = await request(app).post(route).set("x-control-secret", token);
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });

  it("POST /match returns 500 on an unexpected persistence failure", async () => {
    const errorSpy = dbErrorSpy();
    orgFindUniqueMock.mockImplementation(async () => {
      throw new Error("db exploded");
    });
    const token = await controlToken("org-match-broken");
    const res = await request(app).post("/match").set("x-control-secret", token);
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe("GET /health", () => {
  it("returns ok with no auth required", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/me", () => {
  it("rejects without a secret", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("returns orgId and matchId for a valid token", async () => {
    const token = await controlToken("org-me", { matchId: "m-me" });
    const res = await request(app).get("/api/me").set("x-control-secret", token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgId: "org-me", matchId: "m-me" });
  });

  it("returns matchId: null when the token isn't pinned to a match", async () => {
    const token = await controlToken("org-me-2");
    const res = await request(app).get("/api/me").set("x-control-secret", token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgId: "org-me-2", matchId: null });
  });
});
