import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";

// GET /health/deep (SA-109) — internal-only Postgres/Redis reachability +
// active-match-count check, gated by a shared secret. DATABASE_URL/REDIS_URL
// are unset in this suite, so both dependency checks should report
// "skipped" rather than "error" (mirrors the no-op pattern in
// persistence.ts/redis.ts — see server.ts's DEEP_HEALTH_SECRET comment).

const DEEP_HEALTH_SECRET = "test-deep-health-secret";

describe("GET /health/deep with a configured secret", () => {
  let app: ReturnType<typeof createServer>["app"];
  let httpServer: ReturnType<typeof createServer>["httpServer"];
  let closeServer: ReturnType<typeof createServer>["close"];
  let uploadDir: string;

  beforeAll(done => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-deep-health-test-"));
    ({ app, httpServer, close: closeServer } = createServer({
      bridgeSecret: "test-bridge-secret",
      controlSecret: "test-control-secret",
      deepHealthSecret: DEEP_HEALTH_SECRET,
      uploadDir,
      allowedOrigins: ["http://localhost:3000"],
    }));
    httpServer.listen(0, done);
  });

  afterAll(done => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    closeServer(done);
  });

  it("401s with no secret header", async () => {
    const res = await request(app).get("/health/deep");
    expect(res.status).toBe(401);
  });

  it("401s with the wrong secret", async () => {
    const res = await request(app).get("/health/deep").set("x-deep-health-secret", "wrong");
    expect(res.status).toBe(401);
  });

  it("200s with the correct secret, skipping unset dependencies", async () => {
    const res = await request(app).get("/health/deep").set("x-deep-health-secret", DEEP_HEALTH_SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      postgres: "skipped",
      redis: "skipped",
      activeMatches: 0,
      connectedSockets: 0,
    });
  });
});

describe("GET /health/deep with no secret configured", () => {
  let app: ReturnType<typeof createServer>["app"];
  let httpServer: ReturnType<typeof createServer>["httpServer"];
  let closeServer: ReturnType<typeof createServer>["close"];
  let uploadDir: string;

  beforeAll(done => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-deep-health-unset-test-"));
    ({ app, httpServer, close: closeServer } = createServer({
      bridgeSecret: "test-bridge-secret",
      controlSecret: "test-control-secret",
      uploadDir,
      allowedOrigins: ["http://localhost:3000"],
    }));
    httpServer.listen(0, done);
  });

  afterAll(done => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    closeServer(done);
  });

  // Fails closed rather than becoming a public info-leak/DoS surface when an
  // operator hasn't opted in by setting DEEP_HEALTH_SECRET.
  it("401s even with a header present", async () => {
    const res = await request(app).get("/health/deep").set("x-deep-health-secret", "anything");
    expect(res.status).toBe(401);
  });
});
