import { io as ioClient, Socket } from "socket.io-client";
import request from "supertest";
import { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";
import { CricketState } from "@scorehub/types";
import { MatchState } from "../types";

// Socket.io edge-case coverage not exercised by relay.test.ts / cricket.test.ts /
// graphics.test.ts: malformed-payload rejection branches, the bridge-replaces-
// bridge path, timeSync, and the always-on clock tick loop.

const BRIDGE_SECRET  = "sockets-edge-bridge-secret";
const CONTROL_SECRET = "sockets-edge-control-secret";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let serverUrl: string;
let uploadDir: string;

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-sockets-edge-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: BRIDGE_SECRET,
    controlSecret: CONTROL_SECRET,
    uploadDir,
    controlRateLimit: 5000,
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

function connectAndWait(role?: "bridge" | "control"): Promise<{ socket: Socket; initialState: MatchState }> {
  const auth = role ? { secret: role === "bridge" ? BRIDGE_SECRET : CONTROL_SECRET, role } : undefined;
  const socket = ioClient(serverUrl, { auth, reconnection: false });
  return new Promise((resolve, reject) => {
    let connected = false;
    let initialState: MatchState | undefined;
    const tryResolve = () => {
      if (connected && initialState !== undefined) resolve({ socket, initialState: initialState! });
    };
    socket.once("matchStateChange", (s: MatchState) => { initialState = s; tryResolve(); });
    socket.on("connect", () => { connected = true; tryResolve(); });
    socket.on("connect_error", reject);
  });
}

function nextEvent<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>(resolve => socket.once(event, resolve));
}

async function connectControl(): Promise<Socket> {
  const socket = ioClient(serverUrl, { auth: { secret: CONTROL_SECRET, role: "control" }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect_error", reject);
    socket.on("controllerGranted", resolve);
    socket.on("controllerConflict", () => socket.emit("takeControl"));
  });
  return socket;
}

describe("socket — bridge replaces an existing bridge connection", () => {
  it("disconnects the prior bridge socket for the same room when a new one connects", async () => {
    const { socket: firstBridge } = await connectAndWait("bridge");
    const disconnectPromise = new Promise<void>(resolve => firstBridge.once("disconnect", () => resolve()));

    const { socket: secondBridge } = await connectAndWait("bridge");
    await disconnectPromise;

    expect(firstBridge.connected).toBe(false);
    expect(secondBridge.connected).toBe(true);
    secondBridge.disconnect();
  });
});

describe("socket — bridge stateUpdate rejects a malformed payload", () => {
  it("does not broadcast when the payload fails schema validation", async () => {
    const { socket: bridge } = await connectAndWait("bridge");
    const { socket: viewer } = await connectAndWait();
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      bridge.emit("stateUpdate", { not: "a valid match state" });
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(broadcast).toBe(false);
    } finally {
      bridge.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — control manualUpdate rejects a malformed payload", () => {
  it("acks without broadcasting when the patch fails schema validation", async () => {
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      const ackPromise = new Promise<void>(resolve =>
        control.timeout(3000).emit("manualUpdate", { home: { score: "not-a-number" } }, () => resolve())
      );
      await ackPromise;
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(broadcast).toBe(false);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — timeSync", () => {
  it("echoes t0 back with the server's current time", async () => {
    const control = await connectControl();
    try {
      const responsePromise = nextEvent<{ t0: number; serverNow: number }>(control, "timeSyncResponse");
      const t0 = Date.now();
      control.emit("timeSync", { t0 });
      const { t0: echoedT0, serverNow } = await responsePromise;
      expect(echoedT0).toBe(t0);
      expect(serverNow).toBeGreaterThanOrEqual(t0);
    } finally {
      control.disconnect();
    }
  });
});

describe("socket — cricket:overComplete", () => {
  async function seedCricketState() {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({
      sport: "cricket",
      sportState: {
        sport: "cricket", format: "t20", inningsNumber: 1,
        innings: [{
          battingTeam: "home", runs: 10, wickets: 0, oversComplete: 0, ballsThisOver: 6,
          extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0 },
          batters: [{ playerId: 0, name: "A", runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissed: false }],
          bowlers: [{ playerId: 10, name: "X", overs: 0, ballsThisOver: 6, maidens: 0, runs: 0, wickets: 0 }],
          currentBatter1Index: 0, currentBatter2Index: 0, currentBowlerIndex: 0, thisOverBalls: [],
        }],
        homeSquad: [], visitorSquad: [],
      },
    });
  }

  it("sets the next bowler and broadcasts the updated sportState", async () => {
    await seedCricketState();
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      const broadcastPromise = nextEvent<MatchState>(viewer, "matchStateChange");
      control.emit("cricket:overComplete", { nextBowlerIndex: 1 });
      const received = await broadcastPromise;
      const cs = received.sportState as CricketState;
      expect(cs.innings[0].currentBowlerIndex).toBe(1);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });

  it("rejects a malformed cricket:overComplete payload without broadcasting", async () => {
    await seedCricketState();
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      control.emit("cricket:overComplete", { nextBowlerIndex: 999 }); // out of the 0..10 range
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(broadcast).toBe(false);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — cricket:inningsChange / cricket:declare malformed payloads", () => {
  it("rejects a malformed cricket:inningsChange payload without broadcasting", async () => {
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      control.emit("cricket:inningsChange", { battingTeam: "not-a-team" });
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(broadcast).toBe(false);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });

  it("rejects a malformed cricket:declare payload without broadcasting", async () => {
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      control.emit("cricket:declare", { battingTeam: 12345 });
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(broadcast).toBe(false);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("socket — indoorCricket:wicket rejects a malformed payload", () => {
  it("does not broadcast when the payload fails schema validation", async () => {
    const control = await connectControl();
    const { socket: viewer } = await connectAndWait();
    try {
      let broadcast = false;
      viewer.once("matchStateChange", () => { broadcast = true; });
      control.emit("indoorCricket:wicket", { side: "not-a-side" });
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(broadcast).toBe(false);
    } finally {
      control.disconnect();
      viewer.disconnect();
    }
  });
});

describe("clock tick loop", () => {
  it("advances a running match's clock roughly once per second without any client action", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({
      isRunning: true,
      clockSeconds: 0,
    });
    // A viewer connection keeps the room warm (matchStates has an entry) for
    // the background setInterval tick loop to find and advance.
    const { socket: viewer } = await connectAndWait();
    try {
      const tickPromise = new Promise<MatchState>(resolve => {
        const handler = (s: MatchState) => {
          // Ignore the initial state / any interim echoes; wait for one where
          // the clock has visibly moved from where we set it above.
          if (s.clockSeconds !== 0 || (s.clockCarryMs ?? 0) > 0) {
            viewer.off("matchStateChange", handler);
            resolve(s);
          }
        };
        viewer.on("matchStateChange", handler);
      });
      let timeoutHandle: NodeJS.Timeout;
      const timeoutPromise = new Promise<MatchState>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("no tick observed")), 3000);
      });
      const ticked = await Promise.race([tickPromise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
      expect(ticked.isRunning).toBe(true);
    } finally {
      await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ isRunning: false });
      viewer.disconnect();
    }
  }, 10_000);
});

describe("applyManualUpdate clockPatch: stopping with an explicit clockSeconds override", () => {
  it("clears the clock anchor/carry instead of resyncing when clockSeconds is provided alongside isRunning:false", async () => {
    await request(app).post("/manual").set("x-control-secret", CONTROL_SECRET).send({ isRunning: true });
    const res = await request(app)
      .post("/manual")
      .set("x-control-secret", CONTROL_SECRET)
      .send({ isRunning: false, clockSeconds: 42 });
    expect(res.status).toBe(200);
    expect(res.body.clockSeconds).toBe(42);
    expect(res.body.clockAnchorMs).toBeUndefined();
    expect(res.body.clockCarryMs).toBe(0);
  });
});
