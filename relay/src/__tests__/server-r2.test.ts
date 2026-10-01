import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

// Exercises the r2Enabled branches of server.ts's upload/delete routes
// (storeImage's putObject path, and the deleteByPrefix path on every DELETE
// route) by mocking ../storage wholesale — the real R2 path is already unit
// tested against a fake S3Client in storage.test.ts, so here we only need to
// confirm server.ts calls through to it instead of touching local disk.
const putObjectMock = jest.fn();
const deleteByPrefixMock = jest.fn();

jest.mock("../storage", () => ({
  r2Enabled: true,
  putObject: (...a: unknown[]) => putObjectMock(...a),
  deleteByPrefix: (...a: unknown[]) => deleteByPrefixMock(...a),
}));

import { createServer } from "../server";

const CONTROL_SECRET = "r2-test-control-secret";
const BRIDGE_SECRET = "r2-test-bridge-secret";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let uploadDir: string;

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-r2-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: BRIDGE_SECRET,
    controlSecret: CONTROL_SECRET,
    uploadDir,
    controlRateLimit: 1000,
    allowedOrigins: ["http://localhost:3000"],
  }));
  httpServer.listen(0, done);
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

beforeEach(() => {
  putObjectMock.mockReset().mockResolvedValue("https://cdn.example.com/stored-key.png");
  deleteByPrefixMock.mockReset().mockResolvedValue(undefined);
});

describe("uploads route through R2 (r2Enabled)", () => {
  it("POST /api/logo/:team stores via putObject instead of local disk", async () => {
    const res = await request(app)
      .post("/api/logo/home")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "home.png");
    expect(res.status).toBe(200);
    expect(putObjectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^logos\/.+\/home\.png$/),
      expect.any(Buffer),
      "image/png",
    );
    expect(res.body.logoUrl).toMatch(/^https:\/\/cdn\.example\.com\/stored-key\.png/);
  });

  it("DELETE /api/logo/:team deletes via deleteByPrefix", async () => {
    const res = await request(app).delete("/api/logo/home").set("x-control-secret", CONTROL_SECRET);
    expect(res.status).toBe(200);
    expect(deleteByPrefixMock).toHaveBeenCalledWith(expect.stringMatching(/^logos\/.+\/home\.$/));
  });

  it("POST /api/competition-logo stores via putObject", async () => {
    const res = await request(app)
      .post("/api/competition-logo")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "comp.png");
    expect(res.status).toBe(200);
    expect(putObjectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^logos\/.+\/competition\.png$/),
      expect.any(Buffer),
      "image/png",
    );
  });

  it("DELETE /api/competition-logo deletes via deleteByPrefix", async () => {
    const res = await request(app).delete("/api/competition-logo").set("x-control-secret", CONTROL_SECRET);
    expect(res.status).toBe(200);
    expect(deleteByPrefixMock).toHaveBeenCalledWith(expect.stringMatching(/^logos\/.+\/competition\.$/));
  });

  it("POST /api/player-photo/:playerId stores via putObject", async () => {
    const res = await request(app)
      .post("/api/player-photo/abcDEF123")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("photo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "p.png");
    expect(res.status).toBe(200);
    expect(putObjectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^player-photos\/.+\/abcDEF123\.png$/),
      expect.any(Buffer),
      "image/png",
    );
  });

  it("DELETE /api/player-photo/:playerId deletes via deleteByPrefix", async () => {
    const res = await request(app).delete("/api/player-photo/abcDEF123").set("x-control-secret", CONTROL_SECRET);
    expect(res.status).toBe(200);
    expect(deleteByPrefixMock).toHaveBeenCalledWith(expect.stringMatching(/^player-photos\/.+\/abcDEF123\.$/));
  });

  it("POST /api/sound stores via putObject with a generated filename", async () => {
    const res = await request(app)
      .post("/api/sound")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("sound", Buffer.from([0, 1, 2, 3]), "buzzer.mp3");
    expect(res.status).toBe(200);
    expect(putObjectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^sounds\/.+\/\d+-[a-f0-9]{8}\.mp3$/),
      expect.any(Buffer),
      "audio/mpeg",
    );
    expect(res.body.url).toBe("https://cdn.example.com/stored-key.png");
  });

  it("DELETE /api/sound/:filename deletes via deleteByPrefix", async () => {
    const res = await request(app)
      .delete("/api/sound/buzzer.mp3")
      .set("x-control-secret", CONTROL_SECRET);
    expect(res.status).toBe(200);
    expect(deleteByPrefixMock).toHaveBeenCalledWith(expect.stringMatching(/^sounds\/.+\/buzzer\.mp3$/));
  });
});
