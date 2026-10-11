import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import type { MatchEvent } from "@scorehub/types";
import { createServer } from "../server";
import { diffMatchEvents, createMatchEventBuffer } from "../matchEvents";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";

// The match event log: the pure state diff, the legacy-mode buffer, and the
// GET /api/data-feed/events route end to end in legacy mode (no DATABASE_URL).
// The database-backed half is covered in data-feed.test.ts.

const AT = new Date("2026-10-11T02:00:00.000Z");

function state(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

function withScores(home: number, visitor: number, overrides: Partial<MatchState> = {}): MatchState {
  const base = state(overrides);
  return { ...base, home: { ...base.home, score: home }, visitor: { ...base.visitor, score: visitor } };
}

describe("diffMatchEvents", () => {
  it("returns nothing for a clock tick", () => {
    const prev = withScores(3, 2, { isRunning: true, clockSeconds: 100 });
    const next = { ...prev, clockSeconds: 99, sequenceId: prev.sequenceId + 1 };
    expect(diffMatchEvents(prev, next, AT)).toEqual([]);
  });

  it("logs a score with its side, delta and the scores after it", () => {
    const prev = withScores(3, 2, { clockSeconds: 480, period: "2" });
    const next = withScores(3, 5, { clockSeconds: 480, period: "2" });
    expect(diffMatchEvents(prev, next, AT)).toEqual([
      { type: "score", at: AT.toISOString(), clockSeconds: 480, period: "2", home: 3, visitor: 5, side: "visitor", delta: 3 },
    ]);
  });

  it("logs both sides when one change moves both scores", () => {
    const events = diffMatchEvents(withScores(0, 0), withScores(1, 2), AT);
    expect(events.map(e => [e.side, e.delta])).toEqual([["home", 1], ["visitor", 2]]);
  });

  it("logs a score going down as a negative delta", () => {
    const [event] = diffMatchEvents(withScores(4, 0), withScores(3, 0), AT);
    expect(event).toMatchObject({ type: "score", side: "home", delta: -1, home: 3 });
    expect(event.correction).toBeUndefined();
  });

  it("logs a period change with the period left and the scores it finished on", () => {
    const prev = withScores(12, 9, { period: "1" });
    const next = withScores(12, 9, { period: "2" });
    expect(diffMatchEvents(prev, next, AT)).toEqual([
      expect.objectContaining({ type: "period", period: "2", fromPeriod: "1", previous: { home: 12, visitor: 9 } }),
    ]);
  });

  it("treats scores zeroed with a period change as the between-sets reset, not play", () => {
    const prev = withScores(25, 21, { period: "1", sport: "volleyball" });
    const next = withScores(0, 0, { period: "2", sport: "volleyball" });
    const events = diffMatchEvents(prev, next, AT);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "period", home: 0, visitor: 0, previous: { home: 25, visitor: 21 } });
  });

  it("keeps a score that goes up in the same change as the period", () => {
    const events = diffMatchEvents(withScores(1, 0, { period: "1" }), withScores(2, 0, { period: "2" }), AT);
    expect(events.map(e => e.type)).toEqual(["score", "period"]);
  });

  it("logs clock and break transitions", () => {
    const stopped = state({ isRunning: false, periodBreak: false });
    expect(diffMatchEvents(stopped, { ...stopped, isRunning: true }, AT).map(e => e.type)).toEqual(["clock_start"]);
    expect(diffMatchEvents({ ...stopped, isRunning: true }, stopped, AT).map(e => e.type)).toEqual(["clock_stop"]);
    expect(diffMatchEvents(stopped, { ...stopped, periodBreak: true }, AT).map(e => e.type)).toEqual(["break_start"]);
    // Starting the clock out of a break is one change: the break ends, then play resumes.
    expect(
      diffMatchEvents({ ...stopped, periodBreak: true }, { ...stopped, isRunning: true }, AT).map(e => e.type),
    ).toEqual(["break_end", "clock_start"]);
  });

  it("reads fields missing from an older stored state as their defaults, not as changes", () => {
    const sparse = { sequenceId: 1, home: { score: 3 }, visitor: {} } as unknown as MatchState;
    const next = withScores(3, 0, { isRunning: false, periodBreak: false, period: "1" });
    expect(diffMatchEvents(sparse, next, AT)).toEqual([]);
    expect(diffMatchEvents(sparse, withScores(4, 0), AT)).toEqual([
      expect.objectContaining({ type: "score", side: "home", delta: 1, home: 4, visitor: 0 }),
    ]);
  });

  it("logs a reset as a single event rather than as scores going down", () => {
    const events = diffMatchEvents(withScores(7, 4, { period: "3", isRunning: true }), withScores(0, 0), AT, "reset");
    expect(events).toEqual([expect.objectContaining({ type: "reset", home: 0, visitor: 0, period: "1" })]);
  });

  it("marks everything an undo produces as a correction", () => {
    const events = diffMatchEvents(withScores(5, 0, { period: "2" }), withScores(4, 0, { period: "1" }), AT, "undo");
    expect(events.map(e => e.type)).toEqual(["score", "period"]);
    expect(events.every(e => e.correction === true)).toBe(true);
    expect(events[0]).toMatchObject({ side: "home", delta: -1 });
  });

  it("logs nothing for an undo that restores no loggable field", () => {
    const prev = withScores(1, 1, { matchName: "Final" });
    const next: MatchState = { ...prev, matchName: "Semi" };
    expect(diffMatchEvents(prev, next, AT, "undo")).toEqual([]);
  });
});

describe("createMatchEventBuffer", () => {
  const event = (delta: number): MatchEvent => ({
    type: "score", at: AT.toISOString(), clockSeconds: 0, period: "1", home: delta, visitor: 0, side: "home", delta,
  });

  it("numbers events per room from 1 and lists those after `since`", () => {
    const buffer = createMatchEventBuffer();
    buffer.append("a", [event(1), event(2)]);
    buffer.append("b", [event(9)]);
    buffer.append("a", [event(3)]);
    expect(buffer.list("a", 0, 10).map(e => e.seq)).toEqual([1, 2, 3]);
    expect(buffer.list("a", 2, 10).map(e => e.delta)).toEqual([3]);
    expect(buffer.list("b", 0, 10).map(e => e.seq)).toEqual([1]);
    expect(buffer.list("missing", 0, 10)).toEqual([]);
  });

  it("honours the limit, oldest first", () => {
    const buffer = createMatchEventBuffer();
    buffer.append("a", [event(1), event(2), event(3)]);
    expect(buffer.list("a", 0, 2).map(e => e.seq)).toEqual([1, 2]);
  });

  it("drops the oldest events past its cap but keeps numbering", () => {
    const buffer = createMatchEventBuffer();
    for (let i = 0; i < 510; i++) buffer.append("a", [event(i)]);
    const all = buffer.list("a", 0, 1000);
    expect(all).toHaveLength(500);
    expect(all[0].seq).toBe(11);
    expect(all.at(-1)?.seq).toBe(510);
  });
});

describe("GET /api/data-feed/events (legacy mode)", () => {
  const CONTROL_SECRET = "events-control-secret";
  const DATA_FEED_SECRET = "events-data-feed-secret";
  let app: ReturnType<typeof createServer>["app"];
  let httpServer: ReturnType<typeof createServer>["httpServer"];
  let closeServer: ReturnType<typeof createServer>["close"];
  let uploadDir: string;

  beforeAll(done => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-events-test-"));
    ({ app, httpServer, close: closeServer } = createServer({
      bridgeSecret: "events-bridge-secret",
      controlSecret: CONTROL_SECRET,
      dataFeedSecret: DATA_FEED_SECRET,
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

  const post = (url: string) => request(app).post(url).set("x-control-secret", CONTROL_SECRET);
  const events = (query = "") => request(app).get(`/api/data-feed/events${query}`).set("x-data-feed-secret", DATA_FEED_SECRET);

  it("401s without the data feed secret", async () => {
    expect((await request(app).get("/api/data-feed/events")).status).toBe(401);
    expect((await request(app).get("/api/data-feed/events").set("x-data-feed-secret", "wrong")).status).toBe(401);
  });

  it("400s for a `since` that is not a non-negative integer", async () => {
    expect((await events("?since=abc")).status).toBe(400);
    expect((await events("?since=-1")).status).toBe(400);
    expect((await events("?since=1.5")).status).toBe(400);
  });

  it("logs scoring, clock and period actions in order and pages with `since`", async () => {
    const before = await events();
    expect(before.status).toBe(200);
    const start = before.body.next as number;

    await post("/action/start");
    await post("/action/score/home?delta=2");
    await post("/action/score/visitor");
    await post("/action/stop");
    await post("/action/period/next");

    const res = await events(`?since=${start}`);
    expect(res.status).toBe(200);
    const log = res.body.events as MatchEvent[];
    expect(log.map(e => e.type)).toEqual(["clock_start", "score", "score", "clock_stop", "period"]);
    expect(log[1]).toMatchObject({ side: "home", delta: 2, home: 2, visitor: 0 });
    expect(log[2]).toMatchObject({ side: "visitor", delta: 1, home: 2, visitor: 1 });
    expect(log[4]).toMatchObject({ fromPeriod: "1", previous: { home: 2, visitor: 1 } });
    expect(log.map(e => e.seq)).toEqual([start + 1, start + 2, start + 3, start + 4, start + 5]);
    expect(res.body.next).toBe(start + 5);
    expect(Number.isNaN(Date.parse(log[0].at))).toBe(false);

    const later = await events(`?since=${start + 3}`);
    expect((later.body.events as MatchEvent[]).map(e => e.type)).toEqual(["clock_stop", "period"]);

    const caughtUp = await events(`?since=${res.body.next}`);
    expect(caughtUp.body).toEqual({ events: [], next: res.body.next });
  });
});
