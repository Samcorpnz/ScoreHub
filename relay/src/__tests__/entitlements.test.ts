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
  const accounts = new Map<string, { plan: string; addOns: string[] }>();
  const matches: { id: string; orgId: string; status: string; state: unknown }[] = [];
  let nextId = 1;

  return {
    recordAuditEvent: jest.fn(),
    __seed(orgId: string, accountId: string, plan: string, addOns: string[] = []) {
      orgs.set(orgId, { accountId });
      accounts.set(accountId, { plan, addOns });
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
          const account = accounts.get(org.accountId);
          return { accountId: org.accountId, account: { plan: account?.plan ?? "free", addOns: account?.addOns ?? [] } };
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
import { DEFAULT_MATCH_STATE } from "../types";
import * as db from "@scorehub/db";
const seed = (db as unknown as { __seed: (orgId: string, accountId: string, plan: string, addOns?: string[]) => void }).__seed;
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
  ({ app, httpServer, close: closeServer } = createServer({ bridgeSecret: BRIDGE_SECRET, controlSecret: CONTROL_SECRET, uploadDir, allowedOrigins: ["http://localhost:3000"], controlRateLimit: 1000 }));
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

describe("per-output styling (Graphics add-on)", () => {
  const outputs = { scorebug: { font: "Anton", scoreScale: 1.5 } };

  it("keeps a Pro org's theme change but holds outputs without the add-on", async () => {
    seed("org-outputs-pro", "account-outputs-pro", "pro");
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-outputs-pro"))
      .send({ displayTheme: { primaryColor: "#ff0000", outputs } });
    expect(res.status).toBe(200);
    expect(res.body.displayTheme.primaryColor).toBe("#ff0000");
    expect(res.body.displayTheme.outputs ?? {}).toEqual({});
  });

  it("applies outputs for an org with the add-on", async () => {
    seed("org-outputs-gfx", "account-outputs-gfx", "pro", ["graphics-operator"]);
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-outputs-gfx"))
      .send({ displayTheme: { outputs } });
    expect(res.status).toBe(200);
    expect(res.body.displayTheme.outputs).toEqual(outputs);
  });

  // Lapsed add-on (or plan): the display pages keep applying stored styles,
  // so clearing them must still go through.
  it.each([
    ["pro", "org-outputs-lapsed-pro"],
    ["free", "org-outputs-lapsed-free"],
  ])("lets a %s org without the add-on clear its per-output styles", async (plan, orgId) => {
    seed(orgId, `account-${orgId}`, "pro", ["graphics-operator"]);
    const token = await controlToken(orgId);
    await request(app).post("/manual").set("x-control-secret", token).send({ displayTheme: { outputs } });

    seed(orgId, `account-${orgId}`, plan);
    const blocked = await request(app).post("/manual").set("x-control-secret", token)
      .send({ displayTheme: { outputs: { scorebug: { font: "Oswald" } } } });
    expect(blocked.body.displayTheme.outputs).toEqual(outputs);

    const cleared = await request(app).post("/manual").set("x-control-secret", token)
      .send({ displayTheme: { outputs: {} } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.displayTheme.outputs).toEqual({});
  });

  it("rejects an out-of-range size", async () => {
    seed("org-outputs-range", "account-outputs-range", "pro", ["graphics-operator"]);
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-outputs-range"))
      .send({ displayTheme: { outputs: { overlay: { clockScale: 40 } } } });
    expect(res.status).toBe(400);
  });
});

describe("sport is fixed once a match is set up", () => {
  async function matchToken(orgId: string, matchId: string): Promise<string> {
    return new SignJWT({ orgId, role: "ADMIN", matchId })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(AUTH_SECRET));
  }

  it("drops a sport change for a set-up match but applies the rest of the patch", async () => {
    seed("org-sport-fixed", "account-sport-fixed", "pro");
    const { prisma } = db as unknown as { prisma: { match: { create: (q: unknown) => Promise<{ id: string }> } } };
    const match = await prisma.match.create({ data: { orgId: "org-sport-fixed", state: { ...DEFAULT_MATCH_STATE, sport: "netball" } } });
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await matchToken("org-sport-fixed", match.id))
      .send({ sport: "rugby_union", matchName: "Final" });
    expect(res.status).toBe(200);
    expect(res.body.sport).toBe("netball");
    expect(res.body.matchName).toBe("Final");
  });

  it("still lets the org's default room pick a sport", async () => {
    seed("org-sport-default", "account-sport-default", "pro");
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-sport-default"))
      .send({ sport: "rugby_union" });
    expect(res.status).toBe(200);
    expect(res.body.sport).toBe("rugby_union");
  });
});

describe("display background image", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  async function matchToken(orgId: string, matchId: string): Promise<string> {
    return new SignJWT({ orgId, role: "ADMIN", matchId })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(AUTH_SECRET));
  }
  async function newMatch(orgId: string): Promise<string> {
    const { prisma } = db as unknown as { prisma: { match: { create: (q: unknown) => Promise<{ id: string }> } } };
    return (await prisma.match.create({ data: { orgId, state: { ...DEFAULT_MATCH_STATE } } })).id;
  }

  it("blocks a free-tier org from uploading one", async () => {
    seed("org-bg-free", "account-bg-free", "free");
    const res = await request(app)
      .post("/api/display-background")
      .set("x-control-secret", await controlToken("org-bg-free"))
      .attach("background", PNG, "bg.png");
    expect(res.status).toBe(403);
  });

  it("stores it per match and sets it on that match's theme only", async () => {
    seed("org-bg-pro", "account-bg-pro", "pro");
    const [a, b] = [await newMatch("org-bg-pro"), await newMatch("org-bg-pro")];
    const tokenA = await matchToken("org-bg-pro", a);
    const res = await request(app).post("/api/display-background").set("x-control-secret", tokenA).attach("background", PNG, "bg.png");
    expect(res.status).toBe(200);
    expect(res.body.backgroundImageUrl).toMatch(new RegExp(`^/logos/org-bg-pro/background-${a}\\.png\\?t=`));

    const stateA = await request(app).post("/manual").set("x-control-secret", tokenA).send({});
    expect(stateA.body.displayTheme.backgroundImageUrl).toBe(res.body.backgroundImageUrl);
    const stateB = await request(app).post("/manual").set("x-control-secret", await matchToken("org-bg-pro", b)).send({});
    expect(stateB.body.displayTheme.backgroundImageUrl ?? "").toBe("");

    const removed = await request(app).delete("/api/display-background").set("x-control-secret", tokenA);
    expect(removed.status).toBe(200);
    const after = await request(app).post("/manual").set("x-control-secret", tokenA).send({});
    expect(after.body.displayTheme.backgroundImageUrl).toBe("");
  });

  it("needs the Graphics add-on for a per-output background", async () => {
    seed("org-bg-out-pro", "account-bg-out-pro", "pro");
    const res = await request(app)
      .post("/api/display-background?output=fullscreen")
      .set("x-control-secret", await controlToken("org-bg-out-pro"))
      .attach("background", PNG, "bg.png");
    expect(res.status).toBe(403);
  });

  it("stores a per-output background on that output only", async () => {
    seed("org-bg-out-gfx", "account-bg-out-gfx", "pro", ["graphics-operator"]);
    const match = await newMatch("org-bg-out-gfx");
    const token = await matchToken("org-bg-out-gfx", match);
    const res = await request(app)
      .post("/api/display-background?output=fullscreen")
      .set("x-control-secret", token)
      .attach("background", PNG, "bg.png");
    expect(res.status).toBe(200);
    expect(res.body.backgroundImageUrl).toMatch(new RegExp(`^/logos/org-bg-out-gfx/background-${match}-fullscreen\\.png\\?t=`));
    const state = await request(app).post("/manual").set("x-control-secret", token).send({});
    expect(state.body.displayTheme.outputs.fullscreen.backgroundImageUrl).toBe(res.body.backgroundImageUrl);
    expect(state.body.displayTheme.backgroundImageUrl ?? "").toBe("");

    await request(app).delete("/api/display-background?output=fullscreen").set("x-control-secret", token);
    const after = await request(app).post("/manual").set("x-control-secret", token).send({});
    expect(after.body.displayTheme.outputs.fullscreen.backgroundImageUrl).toBe("");
  });

  it("rejects a per-output background for an output that has none", async () => {
    seed("org-bg-out-bad", "account-bg-out-bad", "pro", ["graphics-operator"]);
    const res = await request(app)
      .post("/api/display-background?output=scorebug")
      .set("x-control-secret", await controlToken("org-bg-out-bad"))
      .attach("background", PNG, "bg.png");
    expect(res.status).toBe(400);
  });

  it("rejects a panel opacity outside 0–1", async () => {
    seed("org-bg-opacity", "account-bg-opacity", "pro");
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", await controlToken("org-bg-opacity"))
      .send({ displayTheme: { panelOpacity: 1.5 } });
    expect(res.status).toBe(400);
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
