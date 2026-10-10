import request from "supertest";
import { io as ioClient, Socket } from "socket.io-client";
import { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";
import { MatchState } from "../types";

// DISPLAY_ORIGIN_REQUIRED (SA-159): the display feed is only served to
// ScoreHub's own pages, so third-party graphics software can't read match
// state off a display link — plus the "monitor" role the Stream Deck plugin
// uses instead, since it has no browser origin to offer.

const CONTROL_SECRET = "origin-control-secret";
const APP_ORIGIN = "https://app.example.test";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let serverUrl: string;
let uploadDir: string;
const sockets: Socket[] = [];

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-display-origin-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: "origin-bridge-secret",
    controlSecret: CONTROL_SECRET,
    uploadDir,
    controlRateLimit: 5000,
    allowedOrigins: [APP_ORIGIN],
    displayOriginRequired: true,
  }));
  httpServer.listen(0, () => {
    serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    done();
  });
});

afterEach(() => {
  sockets.splice(0).forEach(socket => socket.disconnect());
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

function connect(auth: Record<string, unknown>, origin?: string): Socket {
  const socket = ioClient(serverUrl, {
    auth,
    reconnection: false,
    transports: ["websocket"],
    ...(origin ? { extraHeaders: { origin } } : {}),
  });
  sockets.push(socket);
  return socket;
}

// Resolves with the refusal message, or null when the socket connected.
const outcome = (socket: Socket) => new Promise<string | null>(resolve => {
  socket.on("connect", () => resolve(null));
  socket.on("connect_error", err => resolve(err.message));
});

describe("GET /state with DISPLAY_ORIGIN_REQUIRED", () => {
  it("is refused with no Origin, as a script or server-side fetch would send", async () => {
    const res = await request(app).get("/state");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Data Feed add-on/);
  });

  it("is refused for another site's Origin", async () => {
    const res = await request(app).get("/state").set("Origin", "https://graphics.example.com");
    expect(res.status).toBe(403);
  });

  it("is served to a ScoreHub page", async () => {
    const res = await request(app).get("/state").set("Origin", APP_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("home");
  });

  it("is served to a control-token holder with no Origin", async () => {
    const res = await request(app).get("/state").set("x-control-secret", CONTROL_SECRET);
    expect(res.status).toBe(200);
  });

  it("is refused for a wrong control token", async () => {
    const res = await request(app).get("/state").set("x-control-secret", "not-the-secret");
    expect(res.status).toBe(403);
  });
});

describe("viewer sockets with DISPLAY_ORIGIN_REQUIRED", () => {
  it("refuses a viewer with no Origin", async () => {
    expect(await outcome(connect({}))).toMatch(/Data Feed add-on/);
  });

  it("refuses a viewer from another site", async () => {
    expect(await outcome(connect({}, "https://graphics.example.com"))).toMatch(/Data Feed add-on/);
  });

  it("accepts a viewer from a ScoreHub page", async () => {
    expect(await outcome(connect({}, APP_ORIGIN))).toBeNull();
  });

  it("leaves an authenticated control panel alone, Origin or not", async () => {
    expect(await outcome(connect({ secret: CONTROL_SECRET, role: "control" }))).toBeNull();
  });

  it("treats a monitor with a bad token as an ordinary viewer, and refuses it", async () => {
    expect(await outcome(connect({ secret: "not-the-secret", role: "monitor" }))).toMatch(/Data Feed add-on/);
  });
});

describe("monitor role", () => {
  it("receives live state with only a control token", async () => {
    const monitor = connect({ secret: CONTROL_SECRET, role: "monitor" });
    const first = await new Promise<MatchState>(resolve => monitor.once("matchStateChange", resolve));

    const next = new Promise<MatchState>(resolve => monitor.once("matchStateChange", resolve));
    await request(app).post("/action/score/home?delta=2").set("x-control-secret", CONTROL_SECRET);
    expect((await next).home.score).toBe(first.home.score + 2);
  });

  it("doesn't take control from the operator and can't score", async () => {
    const monitor = connect({ secret: CONTROL_SECRET, role: "monitor" });
    const before = await new Promise<MatchState>(resolve => monitor.once("matchStateChange", resolve));

    const panel = connect({ secret: CONTROL_SECRET, role: "control" });
    // An earlier test's panel may still hold the controller token in its
    // post-disconnect grace period.
    panel.on("controllerConflict", () => panel.emit("takeControl"));
    await new Promise<void>(resolve => panel.on("controllerGranted", () => resolve()));

    monitor.emit("adjustScore", { side: "home", delta: 5 });
    monitor.emit("takeControl");
    await new Promise<void>(resolve => panel.emit("manualUpdate", { matchName: "still mine" }, () => resolve()));

    const state = (await request(app).get("/state").set("Origin", APP_ORIGIN)).body as MatchState;
    expect(state.home.score).toBe(before.home.score);
    expect(state.matchName).toBe("still mine");
  });
});
