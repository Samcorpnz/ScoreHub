import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";

function tmpUploadDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "relay-startup-test-"));
}

// Coverage for createServer's startup-time validation (requireSecret /
// requireAllowedOrigins) — these throw synchronously inside createServer(),
// before any listener is bound, so no httpServer.listen()/close() lifecycle
// is needed here (unlike relay.test.ts's shared long-lived server).

describe("createServer startup validation", () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalBridgeSecret = process.env.BRIDGE_SECRET;
  const originalControlSecret = process.env.CONTROL_SECRET;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl; else delete process.env.DATABASE_URL;
    if (originalBridgeSecret) process.env.BRIDGE_SECRET = originalBridgeSecret; else delete process.env.BRIDGE_SECRET;
    if (originalControlSecret) process.env.CONTROL_SECRET = originalControlSecret; else delete process.env.CONTROL_SECRET;
    if (originalAllowedOrigins) process.env.ALLOWED_ORIGINS = originalAllowedOrigins; else delete process.env.ALLOWED_ORIGINS;
  });

  it("throws when BRIDGE_SECRET is missing and DATABASE_URL is unset", () => {
    delete process.env.DATABASE_URL;
    delete process.env.BRIDGE_SECRET;
    expect(() =>
      createServer({ controlSecret: "cs", allowedOrigins: ["http://localhost:3000"] })
    ).toThrow(/BRIDGE_SECRET must be set/);
  });

  it("throws when CONTROL_SECRET is missing and DATABASE_URL is unset", () => {
    delete process.env.DATABASE_URL;
    delete process.env.CONTROL_SECRET;
    expect(() =>
      createServer({ bridgeSecret: "bs", allowedOrigins: ["http://localhost:3000"] })
    ).toThrow(/CONTROL_SECRET must be set/);
  });

  it("does not require BRIDGE_SECRET/CONTROL_SECRET when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://fake-for-startup-test";
    delete process.env.BRIDGE_SECRET;
    delete process.env.CONTROL_SECRET;
    let result: ReturnType<typeof createServer> | undefined;
    expect(() => {
      result = createServer({ allowedOrigins: ["http://localhost:3000"], uploadDir: tmpUploadDir() });
    }).not.toThrow();
    await new Promise<void>(resolve => result?.close(() => resolve()));
  });

  it("throws when allowedOrigins is empty", () => {
    expect(() =>
      createServer({ bridgeSecret: "bs", controlSecret: "cs", allowedOrigins: [] })
    ).toThrow(/ALLOWED_ORIGINS must be set/);
  });

  it("throws when allowedOrigins includes a wildcard", () => {
    expect(() =>
      createServer({ bridgeSecret: "bs", controlSecret: "cs", allowedOrigins: ["*"] })
    ).toThrow(/ALLOWED_ORIGINS must be set/);
  });

  it("throws when allowedOrigins is entirely unset (no option, no env var)", () => {
    delete process.env.ALLOWED_ORIGINS;
    expect(() =>
      createServer({ bridgeSecret: "bs", controlSecret: "cs" })
    ).toThrow(/ALLOWED_ORIGINS must be set/);
  });

  it("accepts a single origin string (not wrapped in an array)", async () => {
    let result: ReturnType<typeof createServer> | undefined;
    expect(() => {
      result = createServer({ bridgeSecret: "bs", controlSecret: "cs", allowedOrigins: "http://localhost:3000", uploadDir: tmpUploadDir() });
    }).not.toThrow();
    await new Promise<void>(resolve => result?.close(() => resolve()));
  });

  it("reads ALLOWED_ORIGINS from the environment (comma-separated) when the option is omitted", async () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000, http://localhost:4000";
    let result: ReturnType<typeof createServer> | undefined;
    expect(() => {
      result = createServer({ bridgeSecret: "bs", controlSecret: "cs", uploadDir: tmpUploadDir() });
    }).not.toThrow();
    await new Promise<void>(resolve => result?.close(() => resolve()));
  });
});
