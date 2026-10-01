import request from "supertest";
import { io as ioClient, Socket } from "socket.io-client";
import { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";

const BRIDGE_SECRET  = "test-bridge-secret";
const CONTROL_SECRET = "test-control-secret";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let serverUrl: string;
let uploadDir: string;

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  // controlRateLimit is bumped well above the production default (20/min,
  // tested separately and in isolation in relay-ratelimit.test.ts) so this
  // file's growing number of route tests don't trip it incidentally.
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: BRIDGE_SECRET,
    controlSecret: CONTROL_SECRET,
    uploadDir,
    controlRateLimit: 1000,
    allowedOrigins: ["http://localhost:3000"],
  }));
  httpServer.listen(0, () => {
    const port = (httpServer.address() as AddressInfo).port;
    serverUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Connect a socket and wait for the initial matchStateChange that the server
// emits on connection. Both events may arrive in the same I/O tick so the
// listener must be registered before the connect handshake completes.
function connectAndWait(role?: "bridge" | "control"): Promise<{ socket: Socket; initialState: MatchState }> {
  const auth = role
    ? { secret: role === "bridge" ? BRIDGE_SECRET : CONTROL_SECRET, role }
    : undefined;
  const socket = ioClient(serverUrl, { auth, reconnection: false });
  return new Promise((resolve, reject) => {
    let connected = false;
    let initialState: MatchState | undefined;
    const tryResolve = () => {
      if (connected && initialState !== undefined) resolve({ socket, initialState: initialState! });
    };
    // Register matchStateChange BEFORE connect so we never miss it
    socket.once("matchStateChange", (s: MatchState) => { initialState = s; tryResolve(); });
    socket.on("connect", () => { connected = true; tryResolve(); });
    socket.on("connect_error", reject);
  });
}

function nextEvent<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>(resolve => socket.once(event, resolve));
}

// Resolves with the first `event` payload that satisfies `predicate`, ignoring
// earlier ones. Use when other broadcasts for the same room (e.g. a late
// initial-state emit on a slow CI runner) could otherwise be mistaken for the
// event under test.
function nextEventMatching<T = unknown>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean,
): Promise<T> {
  return new Promise<T>(resolve => {
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

// Connects as "control" and ensures the controller token is granted.
// If another controller already holds the token (30s TTL from a prior test's
// disconnect), we send takeControl immediately so the socket is always the
// active controller when this helper resolves.
async function connectControl(): Promise<Socket> {
  const socket = ioClient(serverUrl, {
    auth: { secret: CONTROL_SECRET, role: "control" },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect_error", reject);
    socket.on("controllerGranted", resolve);
    socket.on("controllerConflict", () => {
      socket.emit("takeControl");
      // controllerGranted will fire next and resolve the outer promise
    });
  });
  return socket;
}

// ─── REST API ─────────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("returns health check", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", version: "1.0.0" });
  });
});

describe("GET /state", () => {
  it("returns the current match state", async () => {
    const res = await request(app).get("/state");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sequenceId");
    expect(res.body).toHaveProperty("home");
    expect(res.body).toHaveProperty("visitor");
    expect(res.body.home).toHaveProperty("score");
  });
});

describe("GET /api/graphics/entitlement", () => {
  it("is unrestricted (entitled: true) in legacy single-tenant mode", async () => {
    const res = await request(app).get("/api/graphics/entitlement");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entitled: true });
  });
});

describe("POST /manual", () => {
  it("rejects requests without a secret header", async () => {
    const res = await request(app).post("/manual").send({ home: { score: 99 } });
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong secret", async () => {
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", "wrong-secret")
      .send({ home: { score: 99 } });
    expect(res.status).toBe(401);
  });

  it("applies a patch and returns updated state", async () => {
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ matchName: "Test Match" });
    expect(res.status).toBe(200);
    expect(res.body.matchName).toBe("Test Match");
  });

  it("deep-merges team fields without wiping unrelated properties", async () => {
    await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ home: { name: "Eagles" } });

    const { body } = await request(app).get("/state");
    expect(body.home.name).toBe("Eagles");
    expect(body.home).toHaveProperty("score");
    expect(body.home).toHaveProperty("color");
  });

  it("rejects a patch with a field of the wrong type (SA-5)", async () => {
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ home: { score: "not-a-number" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid match state patch/);
  });

  it("rejects a patch with an out-of-range clockSeconds (SA-5)", async () => {
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ clockSeconds: 999_999_999 });
    expect(res.status).toBe(400);
  });

  it("rejects a patch with an unknown possession value (SA-5)", async () => {
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ possession: "everyone" });
    expect(res.status).toBe(400);
  });
});

describe("POST /action/start, /action/stop — clock precision (SA clock-accuracy fix)", () => {
  const start = () => request(app).post("/action/start").set("x-control-secret", CONTROL_SECRET);
  const stop  = () => request(app).post("/action/stop").set("x-control-secret", CONTROL_SECRET);
  const wait  = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  it("banks a sub-second hold into clockCarryMs instead of discarding it", async () => {
    await start();
    await wait(300);
    await stop();

    const { body } = await request(app).get("/state");
    // Real-timer test — allow generous tolerance for CI/event-loop jitter.
    // The bug this guards against would leave clockCarryMs undefined/0 and
    // clockSeconds completely unchanged for any hold under 1000ms.
    expect(body.clockCarryMs).toBeGreaterThan(150);
    expect(body.clockCarryMs).toBeLessThan(900);
  });

  // The no-cumulative-drift-across-cycles guarantee is covered deterministically
  // (with simulated timestamps, no real waits) in clock.test.ts's
  // "never discards elapsed time across a chain of stop/start cycles" test —
  // a real-timer version here would be vulnerable to a pre-existing race
  // between this suite's always-on background tick loop (relay/src/server.ts's
  // 1s setInterval) and concurrent manual actions whenever a wait happens to
  // straddle a tick boundary, unrelated to the precision fix itself.

  it("ignores a clientEventMs wildly outside the skew tolerance, falling back to receive-time", async () => {
    const controlSocket = await connectControl();
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ isRunning: false });

    const ackPromise = new Promise<void>(resolve => {
      controlSocket.timeout(3000).emit(
        "manualUpdate",
        { isRunning: true, clientEventMs: Date.now() - 60_000 }, // 60s stale — well outside tolerance
        () => resolve()
      );
    });
    await ackPromise;

    const { body } = await request(app).get("/state");
    expect(body.isRunning).toBe(true);
    // A trusted 60s-stale anchor would make the clock appear to have been
    // running for a full minute already — assert that didn't happen.
    expect(Math.abs((body.clockAnchorMs ?? Date.now()) - Date.now())).toBeLessThan(2000);
    controlSocket.disconnect();
    await stop(); // leave the clock paused for subsequent test blocks
  });
});

describe("POST /api/logo/:team", () => {
  it("rejects logo upload without secret", async () => {
    const res = await request(app)
      .post("/api/logo/home")
      .attach("logo", Buffer.from(""), "test.png");
    expect(res.status).toBe(401);
  });

  it("rejects logo delete without secret", async () => {
    const res = await request(app).delete("/api/logo/home");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid team name", async () => {
    const res = await request(app)
      .post("/api/logo/referee")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "test.png");
    expect(res.status).toBe(400);
  });

  it("uploads a logo and reflects it in match state, then removes it", async () => {
    const upload = await request(app)
      .post("/api/logo/visitor")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "logo.png");
    expect(upload.status).toBe(200);
    expect(upload.body.logoUrl).toMatch(/visitor/);

    const { body: stateAfterUpload } = await request(app).get("/state");
    expect(stateAfterUpload.visitor.logoUrl).toBe(upload.body.logoUrl);

    const del = await request(app)
      .delete("/api/logo/visitor")
      .set("x-control-secret", CONTROL_SECRET);
    expect(del.status).toBe(200);

    const { body: stateAfterDelete } = await request(app).get("/state");
    expect(stateAfterDelete.visitor.logoUrl).toBe("");
  });
});

describe("POST /api/competition-logo", () => {
  it("rejects upload without secret", async () => {
    const res = await request(app)
      .post("/api/competition-logo")
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "comp.png");
    expect(res.status).toBe(401);
  });

  it("uploads and then removes the competition logo", async () => {
    const upload = await request(app)
      .post("/api/competition-logo")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "comp.png");
    expect(upload.status).toBe(200);
    expect(upload.body.competitionLogoUrl).toMatch(/competition/);

    const del = await request(app)
      .delete("/api/competition-logo")
      .set("x-control-secret", CONTROL_SECRET);
    expect(del.status).toBe(200);

    const { body } = await request(app).get("/state");
    expect(body.displayTheme.competitionLogoUrl).toBe("");
  });
});

describe("POST /api/sound", () => {
  it("rejects upload without secret", async () => {
    const res = await request(app)
      .post("/api/sound")
      .attach("sound", Buffer.from([0, 1, 2, 3]), "buzzer.mp3");
    expect(res.status).toBe(401);
  });

  it("uploads a sound and then deletes it by filename", async () => {
    const upload = await request(app)
      .post("/api/sound")
      .set("x-control-secret", CONTROL_SECRET)
      .attach("sound", Buffer.from([0, 1, 2, 3]), "buzzer.mp3");
    expect(upload.status).toBe(200);
    expect(upload.body).toHaveProperty("filename");

    const del = await request(app)
      .delete(`/api/sound/${upload.body.filename}`)
      .set("x-control-secret", CONTROL_SECRET);
    expect(del.status).toBe(200);
  });

  it("rejects sound delete without secret", async () => {
    const res = await request(app).delete("/api/sound/whatever.mp3");
    expect(res.status).toBe(401);
  });
});

// ─── Socket.io events ─────────────────────────────────────────────────────────

describe("socket — viewer", () => {
  it("receives matchStateChange immediately on connect", async () => {
    const { socket, initialState } = await connectAndWait();
    try {
      expect(initialState).toHaveProperty("sequenceId");
      expect(initialState).toHaveProperty("home");
      expect(initialState).toHaveProperty("visitor");
    } finally {
      socket.disconnect();
    }
  });
});

describe("socket — bridge stateUpdate", () => {
  it("broadcasts stateUpdate from bridge to all viewers", async () => {
    const { socket: bridge } = await connectAndWait("bridge");
    const { socket: viewer } = await connectAndWait();
    try {
      const { body: current } = await request(app).get("/state");

      // Register listener BEFORE emitting to avoid a race
      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      bridge.emit("stateUpdate", {
        ...DEFAULT_MATCH_STATE,
        sequenceId: current.sequenceId + 100,
        home:    { ...DEFAULT_MATCH_STATE.home,    score: 42 },
        visitor: { ...DEFAULT_MATCH_STATE.visitor, score: 17 },
      });

      const received = await broadcastPromise;
      expect(received.home.score).toBe(42);
      expect(received.visitor.score).toBe(17);
    } finally {
      bridge.disconnect();
      viewer.disconnect();
    }
  });

  it("preserves control-set logo when bridge sends stateUpdate", async () => {
    await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ home: { logoUrl: "/logos/home.png" } });

    const { socket: bridge } = await connectAndWait("bridge");
    const { socket: viewer } = await connectAndWait();
    try {
      const { body: current } = await request(app).get("/state");

      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      bridge.emit("stateUpdate", {
        ...DEFAULT_MATCH_STATE,
        sequenceId: current.sequenceId + 100,
        home: { ...DEFAULT_MATCH_STATE.home, logoUrl: "" }, // bridge sends empty logoUrl
      });

      const received = await broadcastPromise;
      // relay preserves the control-set logo, ignoring the bridge's blank value
      expect(received.home.logoUrl).toBe("/logos/home.png");
    } finally {
      bridge.disconnect();
      viewer.disconnect();
    }
  });

  it("a bridge stateUpdate never populates clockAnchorMs/clockCarryMs (bridge is its own precise clock source)", async () => {
    const { socket: bridge } = await connectAndWait("bridge");
    const { socket: viewer } = await connectAndWait();
    try {
      const { body: current } = await request(app).get("/state");
      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      bridge.emit("stateUpdate", {
        ...DEFAULT_MATCH_STATE,
        sequenceId: current.sequenceId + 100,
        isRunning: true,
        clockSeconds: 123,
      });
      const received = await broadcastPromise;
      expect(received.clockAnchorMs).toBeUndefined();
      expect(received.clockSeconds).toBe(123);
    } finally {
      bridge.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — control manualUpdate", () => {
  it("applies patch and broadcasts to all viewers", async () => {
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("manualUpdate", { period: "4" });

      const received = await broadcastPromise;
      expect(received.period).toBe("4");
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — control resetMatch", () => {
  it("resets scores to 0 but preserves team names and colors", async () => {
    await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({
        home:    { name: "Hawks", color: "#ff0000", score: 55 },
        visitor: { name: "Owls",  color: "#0000ff", score: 44 },
      });

    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      // Wait for the reset broadcast itself: the first matchStateChange the viewer
      // sees can be a stale (pre-reset) snapshot on a slow runner, which made this
      // test flaky in the coverage-instrumented SonarQube job.
      const broadcastPromise = nextEventMatching<MatchState>(
        viewer,
        "matchStateChange",
        state => state.home.score === 0 && state.visitor.score === 0,
      );
      control.emit("resetMatch");

      const received = await broadcastPromise;
      expect(received.home.score).toBe(0);
      expect(received.visitor.score).toBe(0);
      expect(received.home.name).toBe("Hawks");
      expect(received.visitor.name).toBe("Owls");
      expect(received.home.color).toBe("#ff0000");
      expect(received.visitor.color).toBe("#0000ff");
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — control adjustScore", () => {
  it("applies a single delta and broadcasts", async () => {
    const control = await connectControl();
    const { socket: viewer, initialState } = await connectAndWait();
    try {
      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("adjustScore", { side: "home", delta: 1 });
      const received = await broadcastPromise;
      expect(received.home.score).toBe(initialState.home.score + 1);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });

  // The scenario that broke both the old client-side computation AND would
  // break a naive server-side `await getState(...)`-based handler: two
  // adjustments fired back-to-back with zero `await` between them. Both
  // must apply — the relay's read-modify-write must stay fully synchronous
  // (see relay/src/server.ts's adjustScore handler comment).
  it("two adjustScore emits fired synchronously (no await between them) both apply", async () => {
    const control = await connectControl();
    const { initialState } = await connectAndWait();
    try {
      control.emit("adjustScore", { side: "home", delta: 1 });
      control.emit("adjustScore", { side: "home", delta: 1 });
      const { socket: viewer2, initialState: after } = await connectAndWait();
      viewer2.disconnect();
      expect(after.home.score).toBe(initialState.home.score + 2);
    } finally {
      control.disconnect();
    }
  });

  it("rejects an out-of-range delta without broadcasting", async () => {
    const control = await connectControl();
    const viewer = (await connectAndWait()).socket;
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      control.emit("adjustScore", { side: "home", delta: 1000 });
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(broadcast).toBe(false);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });

  it("rejects adjustScore from a non-controller socket", async () => {
    const control = await connectControl();
    const nonController = ioClient(serverUrl, { auth: { secret: CONTROL_SECRET, role: "control" }, reconnection: false });
    await nextEvent(nonController, "controllerConflict"); // connect-time conflict, since `control` already holds the token
    try {
      const conflictPromise = nextEvent(nonController, "controllerConflict");
      nonController.emit("adjustScore", { side: "home", delta: 1 });
      await conflictPromise;
    } finally {
      control.disconnect();
      nonController.disconnect();
    }
  });

  it("undo after adjustScore restores the pre-adjustment score", async () => {
    const control = await connectControl();
    const { socket: viewer, initialState } = await connectAndWait();
    try {
      const afterAdjust = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("adjustScore", { side: "home", delta: 3 });
      await afterAdjust;

      const afterUndo = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("undo");
      const restored = await afterUndo;
      expect(restored.home.score).toBe(initialState.home.score);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — control indoorCricket:wicket", () => {
  it("decrements score by wicketPenalty and increments the wicket counter atomically", async () => {
    await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({
        sport: "indoor_cricket",
        sportConfig: { wicketPenalty: 5 },
        home: { score: 20 },
        sportState: { sport: "indoor_cricket", wicketPenalty: 5, oversPerInnings: 8, homeWickets: 0, visitorWickets: 0 },
      });

    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("indoorCricket:wicket", { side: "home" });
      const received = await broadcastPromise;
      expect(received.home.score).toBe(15);
      expect((received.sportState as { homeWickets: number }).homeWickets).toBe(1);
      expect((received.sportState as { visitorWickets: number }).visitorWickets).toBe(0);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });

  it("two synchronous wicket emits for the same side both apply", async () => {
    const control = await connectControl();
    const { initialState } = await connectAndWait();
    const penalty = 5;
    try {
      control.emit("indoorCricket:wicket", { side: "home" });
      control.emit("indoorCricket:wicket", { side: "home" });
      const { socket: viewer2, initialState: after } = await connectAndWait();
      viewer2.disconnect();
      const startWickets = (initialState.sportState as { homeWickets?: number } | undefined)?.homeWickets ?? 0;
      expect(after.home.score).toBe(Math.max(0, initialState.home.score - 2 * penalty));
      expect((after.sportState as { homeWickets: number }).homeWickets).toBe(startWickets + 2);
    } finally {
      control.disconnect();
    }
  });

  it("undo after a wicket restores both score and wicket count", async () => {
    const control = await connectControl();
    const { socket: viewer, initialState } = await connectAndWait();
    const startWickets = (initialState.sportState as { homeWickets?: number } | undefined)?.homeWickets ?? 0;
    try {
      const afterWicket = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("indoorCricket:wicket", { side: "home" });
      await afterWicket;

      const afterUndo = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("undo");
      const restored = await afterUndo;
      expect(restored.home.score).toBe(initialState.home.score);
      expect((restored.sportState as { homeWickets: number }).homeWickets).toBe(startWickets);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — requestControl", () => {
  it("grants control on request when no other controller is active", async () => {
    const control = await connectControl();
    try {
      const grantedPromise = new Promise<void>(resolve => control.once("controllerGranted", resolve));
      const ackPromise = new Promise<void>(resolve => control.timeout(3000).emit("requestControl", resolve));
      await Promise.all([grantedPromise, ackPromise]);
    } finally {
      control.disconnect();
    }
  });

  it("responds with a conflict when another socket already holds the token", async () => {
    const first = await connectControl();
    const second = ioClient(serverUrl, { auth: { secret: CONTROL_SECRET, role: "control" }, reconnection: false });
    try {
      // The connect-time resolution already emits an initial conflict; wait
      // for it to settle before issuing the explicit requestControl so the
      // assertion below is unambiguously about the retry path.
      await nextEvent(second, "controllerConflict");
      const conflictPromise = new Promise<void>(resolve => second.once("controllerConflict", () => resolve()));
      const ackPromise = new Promise<void>(resolve => second.timeout(3000).emit("requestControl", resolve));
      await Promise.all([conflictPromise, ackPromise]);
    } finally {
      first.disconnect();
      second.disconnect();
    }
  });
});
