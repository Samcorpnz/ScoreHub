import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer, probeWithRetry } from "../server";

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

  it("sends security headers on every response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["strict-transport-security"]).toBe("max-age=63072000");
    expect(res.headers["x-powered-by"]).toBeUndefined();
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

// The Postgres half of /health/deep — DATABASE_URL is unset above, so the
// retry logic is exercised directly rather than through the route.
describe("probeWithRetry", () => {
  const never = () => new Promise<never>(() => {});

  it("reports ok when the first attempt succeeds", async () => {
    const probe = jest.fn().mockResolvedValue([{ "?column?": 1 }]);
    await expect(probeWithRetry(probe, [20, 50])).resolves.toBe("ok");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports ok when a cold start fails the first attempt but the retry succeeds", async () => {
    const probe = jest.fn()
      .mockRejectedValueOnce(new Error("Can't reach database server"))
      .mockResolvedValueOnce([{ "?column?": 1 }]);
    await expect(probeWithRetry(probe, [20, 50])).resolves.toBe("ok");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("reports ok when the first attempt times out but the slower retry succeeds", async () => {
    const probe = jest.fn()
      .mockImplementationOnce(never)
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 30)));
    await expect(probeWithRetry(probe, [10, 100])).resolves.toBe("ok");
  });

  it("reports error when every attempt fails", async () => {
    const probe = jest.fn().mockImplementation(never);
    await expect(probeWithRetry(probe, [10, 20])).resolves.toBe("error");
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
