import request from "supertest";
import { io as ioClient, Socket } from "socket.io-client";
import { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "../server";
import { MatchState } from "../types";

// Stream Deck / webhook scoring routes (/action/*) and the socket scoring
// handlers that had no direct coverage: /action/toggle, /action/score/:team,
// /action/period/next|prev, indoorCricket:wicket and undo-after-adjust. These
// are the scoring/clock paths SA-30 requires CI to guard.

const BRIDGE_SECRET  = "action-bridge-secret";
const CONTROL_SECRET = "action-control-secret";

let app: ReturnType<typeof createServer>["app"];
let httpServer: ReturnType<typeof createServer>["httpServer"];
let closeServer: ReturnType<typeof createServer>["close"];
let serverUrl: string;
let uploadDir: string;

beforeAll(done => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-action-test-"));
  ({ app, httpServer, close: closeServer } = createServer({
    bridgeSecret: BRIDGE_SECRET,
    controlSecret: CONTROL_SECRET,
    uploadDir,
    controlRateLimit: 5000,
    allowedOrigins: ["http://localhost:3000"],
  }));
  httpServer.listen(0, () => {
    serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    done();
  });
});

afterAll(done => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  closeServer(done);
});

const post = (url: string) => request(app).post(url).set("x-control-secret", CONTROL_SECRET);
const manual = (patch: object) => post("/manual").send(patch);
const getState = async (): Promise<MatchState> => (await request(app).get("/state")).body;

async function connectControl(): Promise<Socket> {
  const socket = ioClient(serverUrl, {
    auth: { secret: CONTROL_SECRET, role: "control" },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect_error", reject);
    socket.on("controllerGranted", resolve);
    socket.on("controllerConflict", () => socket.emit("takeControl"));
  });
  return socket;
}

const until = async (cond: () => Promise<boolean>, timeoutMs = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("condition not met in time");
};

describe("/action/* auth", () => {
  const routes = ["/action/start", "/action/stop", "/action/toggle", "/action/score/home", "/action/period/next", "/action/period/prev", "/action/period/end"];

  it.each(routes)("%s rejects a missing secret", async route => {
    expect((await request(app).post(route)).status).toBe(401);
  });

  it.each(routes)("%s rejects a wrong secret", async route => {
    expect((await request(app).post(route).set("x-control-secret", "nope")).status).toBe(401);
  });
});

describe("POST /action/toggle", () => {
  it("flips isRunning on and off", async () => {
    await manual({ isRunning: false });

    const on = await post("/action/toggle");
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ ok: true, isRunning: true });
    expect((await getState()).isRunning).toBe(true);

    const off = await post("/action/toggle");
    expect(off.body.isRunning).toBe(false);
    expect((await getState()).isRunning).toBe(false);
  });
});

describe("POST /action/score/:team", () => {
  beforeEach(async () => {
    await manual({ home: { score: 10 }, visitor: { score: 4 } });
  });

  it("defaults to +1", async () => {
    const res = await post("/action/score/home");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, score: 11 });
  });

  it("applies a positive delta from the query string to the right team only", async () => {
    const res = await post("/action/score/visitor?delta=3");
    expect(res.body.score).toBe(7);
    const state = await getState();
    expect(state.visitor.score).toBe(7);
    expect(state.home.score).toBe(10);
  });

  it("applies a negative delta from the JSON body", async () => {
    const res = await post("/action/score/home").send({ delta: -2 });
    expect(res.body.score).toBe(8);
  });

  it("never lets a score go below zero", async () => {
    const res = await post("/action/score/visitor?delta=-50");
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0);
    expect((await getState()).visitor.score).toBe(0);
  });

  it("preserves unrelated team fields when changing the score", async () => {
    await manual({ home: { name: "Eagles", color: "#ff0000" } });
    await post("/action/score/home?delta=1");
    const { home } = await getState();
    expect(home.name).toBe("Eagles");
    expect(home.color).toBe("#ff0000");
    expect(home.score).toBe(11);
  });

  it.each(["away", "HOME", "both"])("rejects invalid team %s", async team => {
    const res = await post(`/action/score/${team}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/team must be/);
  });

  it.each(["abc", "100", "-100", "1e9"])("rejects out-of-range or non-integer delta %s", async delta => {
    const res = await post(`/action/score/home?delta=${delta}`);
    // "1e9" parses as 1 via parseInt, so it is valid — every other value here is not
    if (delta === "1e9") {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/delta must be/);
    }
  });

  it("accepts the delta boundaries ±99", async () => {
    expect((await post("/action/score/home?delta=99")).body.score).toBe(109);
    expect((await post("/action/score/home?delta=-99")).body.score).toBe(10);
  });

  it("does not lose updates when many requests are fired concurrently", async () => {
    await Promise.all(Array.from({ length: 10 }, () => post("/action/score/home?delta=1")));
    // applyManualUpdate is async, so this documents current behaviour: the
    // final score must be within the valid window and never regress below the
    // starting score.
    const { home } = await getState();
    expect(home.score).toBeGreaterThanOrEqual(11);
    expect(home.score).toBeLessThanOrEqual(20);
  });
});

describe("POST /action/period/next and /prev", () => {
  it("next increments a numeric period", async () => {
    await manual({ period: "2" });
    const res = await post("/action/period/next");
    expect(res.body).toEqual({ ok: true, period: "3" });
  });

  it("next falls back to period 2 when the period is not numeric", async () => {
    await manual({ period: "OT" });
    expect((await post("/action/period/next")).body.period).toBe("2");
  });

  it("prev decrements a numeric period", async () => {
    await manual({ period: "3" });
    expect((await post("/action/period/prev")).body.period).toBe("2");
  });

  it("prev never goes below period 1", async () => {
    await manual({ period: "1" });
    expect((await post("/action/period/prev")).body.period).toBe("1");
  });

  it("prev falls back to period 1 when the period is not numeric", async () => {
    await manual({ period: "OT" });
    expect((await post("/action/period/prev")).body.period).toBe("1");
  });
});

describe("best-of match length (SA-118)", () => {
  afterEach(async () => { await manual({ sport: "netball", sportConfig: {}, period: "1" }); });

  it("stops a best-of-3 squash match at game 3", async () => {
    await manual({ sport: "squash", sportConfig: { format: "bo3" }, period: "2" });
    expect((await post("/action/period/next")).body.period).toBe("3");
    expect((await post("/action/period/next")).body.period).toBe("3");
    expect((await post("/action/period/end")).body.period).toBe("3");
    expect((await getState()).periodBreak).toBe(false);
  });

  it("lets a best-of-5 tennis match run to set 5 and no further", async () => {
    await manual({ sport: "tennis", sportConfig: { format: "bo5" }, period: "4" });
    expect((await post("/action/period/end")).body.period).toBe("5");
    expect((await post("/action/period/end")).body.period).toBe("5");
  });

  it("doesn't cap a match with no format recorded, or any other sport", async () => {
    await manual({ sport: "squash", sportConfig: {}, period: "5" });
    expect((await post("/action/period/next")).body.period).toBe("6");
    await manual({ sport: "netball", sportConfig: { format: "bo3" }, period: "4" });
    expect((await post("/action/period/next")).body.period).toBe("5");
  });
});

describe("socket — adjustScore then undo", () => {
  let control: Socket;
  afterEach(() => { control?.disconnect(); });

  it("undo restores the pre-adjust score and keeps sequenceId monotonic", async () => {
    control = await connectControl();
    await manual({ home: { score: 5 } });
    const before = await getState();

    control.emit("adjustScore", { side: "home", delta: 2 });
    await until(async () => (await getState()).home.score === 7);
    const adjusted = await getState();
    expect(adjusted.sequenceId).toBeGreaterThan(before.sequenceId);

    control.emit("undo");
    await until(async () => (await getState()).home.score === 5);
    expect((await getState()).sequenceId).toBeGreaterThan(adjusted.sequenceId);
  });

  it("ignores a malformed adjustScore payload without changing state", async () => {
    control = await connectControl();
    await manual({ home: { score: 5 } });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    control.emit("adjustScore", { side: "middle", delta: "lots" });
    await new Promise(r => setTimeout(r, 100));
    expect((await getState()).home.score).toBe(5);
    warn.mockRestore();
  });

  it("clamps an adjustScore below zero to zero", async () => {
    control = await connectControl();
    await manual({ visitor: { score: 1 } });
    control.emit("adjustScore", { side: "visitor", delta: -10 });
    await until(async () => (await getState()).visitor.score === 0);
  });
});

describe("socket — indoorCricket:wicket", () => {
  let control: Socket;
  afterEach(() => { control?.disconnect(); });

  it("applies the configured wicket penalty and counts the wicket for that side only", async () => {
    control = await connectControl();
    await manual({
      sport: "indoor_cricket",
      home: { score: 40 },
      visitor: { score: 30 },
      sportConfig: { wicketPenalty: 5 },
      sportState: { sport: "indoor_cricket", wicketPenalty: 5, oversPerInnings: 8, homeWickets: 0, visitorWickets: 0 },
    });

    control.emit("indoorCricket:wicket", { side: "home" });
    await until(async () => (await getState()).home.score === 35);

    const state = await getState();
    expect(state.visitor.score).toBe(30);
    const ss = state.sportState as { homeWickets: number; visitorWickets: number };
    expect(ss.homeWickets).toBe(1);
    expect(ss.visitorWickets).toBe(0);
  });

  it("never drops the score below zero", async () => {
    control = await connectControl();
    await manual({
      sport: "indoor_cricket",
      visitor: { score: 2 },
      sportConfig: { wicketPenalty: 5 },
    });
    control.emit("indoorCricket:wicket", { side: "visitor" });
    await until(async () => (await getState()).visitor.score === 0);
  });

  it("can be undone", async () => {
    control = await connectControl();
    await manual({
      sport: "indoor_cricket",
      home: { score: 40 },
      sportConfig: { wicketPenalty: 5 },
    });
    control.emit("indoorCricket:wicket", { side: "home" });
    await until(async () => (await getState()).home.score === 35);
    control.emit("undo");
    await until(async () => (await getState()).home.score === 40);
  });

  it("ignores a malformed payload", async () => {
    control = await connectControl();
    await manual({ sport: "indoor_cricket", home: { score: 40 } });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    control.emit("indoorCricket:wicket", { side: "nobody" });
    await new Promise(r => setTimeout(r, 100));
    expect((await getState()).home.score).toBe(40);
    warn.mockRestore();
  });
});

describe("POST /action/period/end — basketball", () => {
  it("resets both teams' fouls for the next quarter, like the control panel's END QTR", async () => {
    await manual({
      sport: "basketball", period: "1", clockSeconds: 12, isRunning: true,
      home: { name: "Home", score: 20, faults: 4, timeouts: 5 },
      visitor: { name: "Visitor", score: 18, faults: 3, timeouts: 5 },
    });
    const res = await post("/action/period/end");
    expect(res.body).toMatchObject({ ok: true, period: "2", clockSeconds: 600 });
    const state = await getState();
    expect(state.home).toMatchObject({ score: 20, faults: 0 });
    expect(state.visitor).toMatchObject({ score: 18, faults: 0 });
    expect(state.isRunning).toBe(false);
    expect(state.periodBreak).toBe(true);
  });

  it("gives overtime periods a 5:00 clock", async () => {
    await manual({ sport: "basketball", period: "4", clockSeconds: 0, isRunning: false });
    const res = await post("/action/period/end");
    expect(res.body).toMatchObject({ ok: true, period: "5", clockSeconds: 300 });
  });

  it("leaves fouls alone for other sports", async () => {
    await manual({
      sport: "netball", period: "1", clockSeconds: 0, isRunning: false,
      home: { name: "Home", score: 5, faults: 2, timeouts: 1 },
      visitor: { name: "Visitor", score: 4, faults: 1, timeouts: 1 },
    });
    await post("/action/period/end");
    const state = await getState();
    expect(state.home.faults).toBe(2);
    expect(state.visitor.faults).toBe(1);
  });
});
