import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

// jsdom pulls in an ESM-only transitive dependency this project's Jest config
// isn't set up to transform (see uploads.test.ts), so the SVG-sanitization
// path is stubbed here too — this file only needs the upload route's
// behavior around a *sanitized* SVG, not real DOMPurify sanitization.
jest.mock("jsdom", () => ({ JSDOM: jest.fn().mockImplementation(() => ({ window: {} })) }));
jest.mock("dompurify", () => () => ({ sanitize: (dirty: string) => dirty }));

import { createServer } from "../server";

// Coverage for the Stream Deck / webhook "action" endpoints
// (/action/toggle, /action/score/:team, /action/period/next, /action/period/prev)
// that relay.test.ts and capabilities.test.ts don't otherwise exercise, plus
// a handful of validation/edge-case branches on the upload and /match routes.

const CONTROL_SECRET = "actions-test-control-secret";
const BRIDGE_SECRET = "actions-test-bridge-secret";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let uploadDir: string;

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-actions-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: BRIDGE_SECRET,
    controlSecret: CONTROL_SECRET,
    uploadDir,
    controlRateLimit: 5000,
    allowedOrigins: ["http://localhost:3000"],
  }));
  httpServer.listen(0, done);
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

const authed = (method: "post" | "delete", url: string) =>
  (request(app) as any)[method](url).set("x-control-secret", CONTROL_SECRET);

describe("actionAuth", () => {
  it("rejects an action request without a secret", async () => {
    const res = await request(app).post("/action/start");
    expect(res.status).toBe(401);
  });

  it("rejects an action request with the wrong secret", async () => {
    const res = await request(app).post("/action/start").set("x-control-secret", "wrong");
    expect(res.status).toBe(401);
  });
});

describe("POST /action/toggle", () => {
  it("flips isRunning from false to true and back", async () => {
    await authed("post", "/action/stop"); // ensure known baseline
    const first = await authed("post", "/action/toggle");
    expect(first.status).toBe(200);
    expect(first.body.isRunning).toBe(true);

    const second = await authed("post", "/action/toggle");
    expect(second.status).toBe(200);
    expect(second.body.isRunning).toBe(false);
  });
});

describe("POST /action/score/:team", () => {
  it("rejects an invalid team name", async () => {
    const res = await authed("post", "/action/score/referee");
    expect(res.status).toBe(400);
  });

  it("rejects a delta outside the -99..99 range", async () => {
    const res = await authed("post", "/action/score/home?delta=1000");
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric delta", async () => {
    const res = await authed("post", "/action/score/home?delta=abc");
    expect(res.status).toBe(400);
  });

  it("defaults delta to 1 when omitted", async () => {
    const before = (await request(app).get("/state")).body.home.score;
    const res = await authed("post", "/action/score/home");
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(before + 1);
  });

  it("applies a negative delta, clamped at 0", async () => {
    await authed("post", "/action/score/visitor?delta=-99");
    const res = await authed("post", "/action/score/visitor?delta=-5");
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0);
  });
});

describe("POST /action/period/next and /action/period/prev", () => {
  it("advances the period by one from a numeric period", async () => {
    await authed("post", "/manual").send({ period: "2" }); // seed via /manual too
    const res = await authed("post", "/action/period/next");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("3");
  });

  it("defaults to period 2 when the current period isn't numeric", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ period: "Final" });
    const res = await authed("post", "/action/period/next");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("2");
  });

  it("decrements the period by one, floored at 1", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ period: "3" });
    const res = await authed("post", "/action/period/prev");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("2");
  });

  it("clamps at period 1 rather than going negative", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ period: "1" });
    const res = await authed("post", "/action/period/prev");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("1");
  });

  it("floors a non-numeric period to 1 on prev", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ period: "Final" });
    const res = await authed("post", "/action/period/prev");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("1");
  });
});

describe("POST /action/period/end resets score for score-resetting sports", () => {
  it("zeroes both scores when the sport resets score on period end", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({
      sport: "volleyball",
      period: "1",
      home: { score: 21 },
      visitor: { score: 18 },
    });
    const res = await authed("post", "/action/period/end");
    expect(res.status).toBe(200);
    const { body } = await request(app).get("/state");
    expect(body.home.score).toBe(0);
    expect(body.visitor.score).toBe(0);
  });
});

describe("POST /match", () => {
  it("rejects without a secret", async () => {
    const res = await request(app).post("/match");
    expect(res.status).toBe(401);
  });

  it("returns 501 in legacy (no-DATABASE_URL) mode", async () => {
    const res = await authed("post", "/match");
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/multi-tenant mode/);
  });
});

describe("upload validation-error branches (content doesn't match declared mimetype)", () => {
  const badPng = Buffer.from("this is not actually a png");

  it("POST /api/logo/:team returns 400 on a mismatched file", async () => {
    const res = await request(app)
      .post("/api/logo/home")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", badPng, "fake.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/);
  });

  it("POST /api/competition-logo returns 400 on a mismatched file", async () => {
    const res = await request(app)
      .post("/api/competition-logo")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", badPng, "fake.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/);
  });

  it("POST /api/player-photo/:playerId returns 400 on a mismatched file", async () => {
    const res = await request(app)
      .post("/api/player-photo/abc123")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("photo", badPng, "fake.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/);
  });

  it("POST /api/player-photo/:playerId returns 400 for an invalid playerId (path traversal guard)", async () => {
    const res = await request(app)
      .post("/api/player-photo/..%2f..%2fetc")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("photo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "p.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid playerId/);
  });

  it("DELETE /api/player-photo/:playerId returns 400 for an invalid playerId", async () => {
    const res = await authed("delete", "/api/player-photo/..%2f..%2fetc");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid playerId/);
  });
});

describe("multer error handling middleware (SA-10)", () => {
  it("returns 400 with the MulterError message when the logo exceeds the size limit", async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 0x89); // limit is 5MB
    const res = await request(app)
      .post("/api/logo/home")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", oversized, "big.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("DELETE /api/logo/:team with an invalid team", () => {
  it("returns 400", async () => {
    const res = await authed("delete", "/api/logo/referee");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/sound/:filename validation", () => {
  it("rejects a disallowed file extension", async () => {
    const res = await authed("delete", "/api/sound/malicious.exe");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid file type/);
  });

  it("is a no-op (200) for a well-formed filename that was never uploaded", async () => {
    const res = await authed("delete", "/api/sound/never-existed.mp3");
    expect(res.status).toBe(200);
  });
});

describe("static upload headers", () => {
  it("serves an uploaded SVG logo with a locked-down CSP and inline disposition", async () => {
    // A trivial (harmless) SVG passes magic-byte-free sanitization untouched.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
    const upload = await request(app)
      .post("/api/logo/home")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", svg, { filename: "home.svg", contentType: "image/svg+xml" });
    expect(upload.status).toBe(200);

    const urlPath = new URL(upload.body.logoUrl, "http://localhost").pathname;
    const res = await request(app).get(urlPath);
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(res.headers["content-disposition"]).toBe("inline");
  });
});
