import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";

// CORS headers are only sent for origins in ALLOWED_ORIGINS — never reflected
// for an arbitrary site, never a wildcard (SA code-scanning #14, #28).

const ALLOWED = "http://localhost:3000";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let uploadDir: string;

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-cors-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: "cors-bridge-secret",
    controlSecret: "cors-control-secret",
    uploadDir,
    allowedOrigins: [ALLOWED],
  }));
  httpServer.listen(0, done);
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

describe("CORS", () => {
  it("reflects an allowed origin", async () => {
    const res = await request(app).get("/health").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("sends no CORS header for an origin not on the list", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("refuses a preflight from an origin not on the list", async () => {
    const res = await request(app)
      .options("/manual")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends no CORS header when there is no Origin", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
