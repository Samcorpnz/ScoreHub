import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { SignJWT } from "jose";

// `@scorehub/db` is mocked here because, unlike the rest of the relay test
// suite, entitlement checks only run when DATABASE_URL is set — and we need
// to control org/account/match state precisely rather than hit a real DB.
jest.mock("@scorehub/db", () => {
  const orgs = new Map<string, { accountId: string }>();
  const accounts = new Map<string, { plan: string }>();
  const matches: { id: string; orgId: string; status: string; state: unknown }[] = [];
  let nextId = 1;

  return {
    recordAuditEvent: jest.fn(),
    __seed(orgId: string, accountId: string, plan: string) {
      orgs.set(orgId, { accountId });
      accounts.set(accountId, { plan });
    },
    __reset() {
      orgs.clear();
      accounts.clear();
      matches.length = 0;
      nextId = 1;
    },
    prisma: {
      org: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const org = orgs.get(where.id);
          if (!org) return null;
          return { accountId: org.accountId, account: { plan: accounts.get(org.accountId)?.plan ?? "free" } };
        }),
      },
      match: {
        findFirst: jest.fn(async ({ where }: { where: { orgId: string; status: string } }) =>
          matches.find(m => m.orgId === where.orgId && m.status === where.status) ?? null
        ),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          matches.find(m => m.id === where.id) ?? null
        ),
        create: jest.fn(async ({ data }: { data: { orgId: string; state: unknown } }) => {
          const match = { id: `match-${nextId++}`, status: "LIVE", ...data };
          matches.push(match);
          return match;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const match = matches.find(m => m.id === where.id);
          Object.assign(match as object, data);
          return match;
        }),
        count: jest.fn(async ({ where }: { where: { status: string; org: { accountId: string } } }) =>
          matches.filter(m => m.status === where.status && orgs.get(m.orgId)?.accountId === where.org.accountId).length
        ),
      },
    },
  };
});

import { createServer } from "../server";
import * as db from "@scorehub/db";
const seed = (db as unknown as { __seed: (orgId: string, accountId: string, plan: string) => void }).__seed;
const resetSeed = (db as unknown as { __reset: () => void }).__reset;

const BRIDGE_SECRET = "test-bridge-secret";
const CONTROL_SECRET = "test-control-secret";
const AUTH_SECRET = "test-auth-secret-for-entitlements";
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let uploadDir: string;

beforeAll(done => {
  process.env.DATABASE_URL = "postgresql://fake-for-tests";
  process.env.AUTH_SECRET = AUTH_SECRET;
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-entitlements-test-"));
  ({ app, httpServer, close: closeServer } = createServer({ bridgeSecret: BRIDGE_SECRET, controlSecret: CONTROL_SECRET, uploadDir, allowedOrigins: ["http://localhost:3000"] }));
  httpServer.listen(0, () => done());
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  closeServer(done);
});

beforeEach(() => {
  resetSeed();
});

// Once DATABASE_URL is set, controlAuth requires a real ADMIN/OPERATOR JWT
// signed with AUTH_SECRET (the control panel's actual auth path) rather than
// the legacy shared CONTROL_SECRET — so each org under test needs its own token.
async function controlToken(orgId: string): Promise<string> {
  return new SignJWT({ orgId, role: "ADMIN" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(AUTH_SECRET));
}

describe("branding in MatchState patches (SA-32)", () => {
  const theme = { primaryColor: "#ff0000", backgroundColor: "#000000", font: "Anton", textScale: 1.5, competitionLogoUrl: "" };

  it("drops theme and logo changes from a free-tier patch but applies the rest", async () => {
    seed("org-free", "account-free", "free");
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-free"))
      .send({ matchName: "Final", displayTheme: theme, home: { score: 3, logoUrl: "https://example.com/logo.png" } });
    expect(res.status).toBe(200);
    expect(res.body.matchName).toBe("Final");
    expect(res.body.home.score).toBe(3);
    expect(res.body.home.logoUrl).toBe("");
    expect(res.body.displayTheme.primaryColor).not.toBe("#ff0000");
    expect(res.body.displayTheme.font).toBe("");
  });

  it("applies theme and logo changes for a pro-tier org", async () => {
    seed("org-pro", "account-pro", "pro");
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-pro"))
      .send({ displayTheme: theme, home: { logoUrl: "https://example.com/logo.png" } });
    expect(res.status).toBe(200);
    expect(res.body.displayTheme).toEqual(theme);
    expect(res.body.home.logoUrl).toBe("https://example.com/logo.png");
  });

  it("doesn't look up the plan for a patch that only echoes current branding", async () => {
    seed("org-free", "account-free", "free");
    const token = await controlToken("org-free");
    const first = await request(app).post("/manual").set("x-control-secret", token).send({ matchName: "Warm-up" });
    const findOrg = (db as unknown as { prisma: { org: { findUnique: jest.Mock } } }).prisma.org.findUnique;
    findOrg.mockClear();
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", token)
      .send({ home: { ...first.body.home, score: 7 }, displayTheme: first.body.displayTheme });
    expect(res.status).toBe(200);
    expect(res.body.home.score).toBe(7);
    expect(findOrg).not.toHaveBeenCalled();
  });
});

describe("GET /api/display/entitlement (SA-31)", () => {
  it("asks for the watermark on a free-tier org", async () => {
    seed("org-free", "account-free", "free");
    const res = await request(app).get("/api/display/entitlement?org=org-free");
    expect(res.body).toEqual({ watermark: true });
  });

  it("drops the watermark for pro and venue orgs", async () => {
    seed("org-pro", "account-pro", "pro");
    seed("org-venue", "account-venue", "venue");
    expect((await request(app).get("/api/display/entitlement?org=org-pro")).body).toEqual({ watermark: false });
    expect((await request(app).get("/api/display/entitlement?org=org-venue")).body).toEqual({ watermark: false });
  });

  it("uses the match's own org, not a paid org named in ?org=", async () => {
    // A fresh org id: the relay caches match state per room across tests, so a
    // reused one would never hit the (reset) mock DB to create its match row.
    seed("org-free-display", "account-free", "free");
    seed("org-pro", "account-pro", "pro");
    const state = await request(app).post("/manual").set("x-control-secret", await controlToken("org-free-display")).send({ matchName: "Mine" });
    expect(state.status).toBe(200);
    const match = await (db as unknown as { prisma: { match: { findFirst: (q: unknown) => Promise<{ id: string }> } } })
      .prisma.match.findFirst({ where: { orgId: "org-free-display", status: "LIVE" } });
    const res = await request(app).get(`/api/display/entitlement?org=org-pro&matchId=${match.id}`);
    expect(res.body).toEqual({ watermark: true });
  });
});

describe("requirePlan — branding routes", () => {
  it("blocks a free-tier org from uploading a competition logo", async () => {
    seed("org-free", "account-free", "free");
    const res = await request(app)
      .post("/api/competition-logo")
      .set("x-control-secret", await controlToken("org-free"))
      .attach("logo", Buffer.from("fake"), "logo.png");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Pro or Venue plan/);
  });

  it("allows a pro-tier org to upload a competition logo", async () => {
    seed("org-pro", "account-pro", "pro");
    const res = await request(app)
      .post("/api/competition-logo")
      .set("x-control-secret", await controlToken("org-pro"))
      // Valid PNG signature — the upload route now rejects files whose bytes
      // don't match their declared image type.
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "logo.png");
    expect(res.status).toBe(200);
    expect(res.body.competitionLogoUrl).toMatch(/^\/logos\/org-pro\/competition/);
  });

  it("blocks a free-tier org from deleting a sound", async () => {
    seed("org-free", "account-free", "free");
    const res = await request(app)
      .delete("/api/sound/test.mp3")
      .set("x-control-secret", await controlToken("org-free"));
    expect(res.status).toBe(403);
  });
});

describe("concurrent match limit", () => {
  // Every test uses org ids unique to itself — server.ts's in-process
  // matchStates cache (and persistence.ts's stores cache) are never reset
  // between tests, so reusing an org id across tests would serve a stale
  // cached match instead of re-running the entitlement check.
  it("lets a free-tier account run one live match", async () => {
    seed("solo-org-free", "account-solo-free", "free");
    const res = await request(app).get("/state?org=solo-org-free");
    expect(res.status).toBe(200);
  });

  it("blocks a free-tier account's second org from starting a concurrent live match", async () => {
    seed("org-a", "account-free", "free");
    seed("org-b", "account-free", "free");
    await request(app).get("/state?org=org-a"); // creates the account's one allowed live match
    const res = await request(app).get("/state?org=org-b");
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/one live match at a time/);
  });

  it("lets a pro-tier account run concurrent matches across orgs", async () => {
    seed("org-c", "account-pro", "pro");
    seed("org-d", "account-pro", "pro");
    await request(app).get("/state?org=org-c");
    const res = await request(app).get("/state?org=org-d");
    expect(res.status).toBe(200);
  });
});
