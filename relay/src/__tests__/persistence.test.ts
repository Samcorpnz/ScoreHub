const matchFindUniqueMock = jest.fn();
const matchFindFirstMock = jest.fn();
const matchCreateMock = jest.fn();
const matchUpdateMock = jest.fn();
const matchCountMock = jest.fn();
const eventCreateManyMock = jest.fn();
const eventFindManyMock = jest.fn();
const eventCountMock = jest.fn();
const recordAuditEventMock = jest.fn();

jest.mock("@scorehub/db", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
  prisma: {
    match: {
      findUnique: (...a: unknown[]) => matchFindUniqueMock(...a),
      findFirst: (...a: unknown[]) => matchFindFirstMock(...a),
      create: (...a: unknown[]) => matchCreateMock(...a),
      update: (...a: unknown[]) => matchUpdateMock(...a),
      count: (...a: unknown[]) => matchCountMock(...a),
    },
    matchEvent: {
      createMany: (...a: unknown[]) => eventCreateManyMock(...a),
      findMany: (...a: unknown[]) => eventFindManyMock(...a),
      count: (...a: unknown[]) => eventCountMock(...a),
    },
  },
}));

const getOrgAccountMock = jest.fn();
class FakeConcurrentMatchLimitError extends Error {}
jest.mock("../entitlements", () => ({
  getOrgAccount: (...a: unknown[]) => getOrgAccountMock(...a),
  ConcurrentMatchLimitError: FakeConcurrentMatchLimitError,
}));

import type { MatchEvent } from "@scorehub/types";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";

describe("persistence", () => {
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    matchFindUniqueMock.mockReset();
    matchFindFirstMock.mockReset();
    matchCreateMock.mockReset();
    matchUpdateMock.mockReset();
    matchCountMock.mockReset();
    eventCreateManyMock.mockReset();
    eventFindManyMock.mockReset();
    eventCountMock.mockReset();
    recordAuditEventMock.mockReset();
    eventCountMock.mockResolvedValue(0);
    getOrgAccountMock.mockReset();
    process.env.DATABASE_URL = "postgres://test";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
  });

  it("getMatchStore returns null when DATABASE_URL is unset (legacy mode)", async () => {
    delete process.env.DATABASE_URL;
    const { getMatchStore } = await import("../persistence");
    expect(getMatchStore("org-1")).toBeNull();
  });

  it("caches the same store instance per (org, matchId) pair", async () => {
    const { getMatchStore } = await import("../persistence");
    const a = getMatchStore("org-1", "m1");
    const b = getMatchStore("org-1", "m1");
    expect(a).toBe(b);
  });

  it("returns distinct stores for different matchIds under the same org", async () => {
    const { getMatchStore } = await import("../persistence");
    const a = getMatchStore("org-1", "m1");
    const b = getMatchStore("org-1", "m2");
    expect(a).not.toBe(b);
  });

  describe("createLiveMatch (also exercised via the org-singleton path)", () => {
    it("creates a match directly when the account isn't on the free plan", async () => {
      getOrgAccountMock.mockResolvedValue({ accountId: "acc-1", plan: "pro" });
      matchCreateMock.mockResolvedValue({ id: "new-match" });
      const { createLiveMatch } = await import("../persistence");

      await expect(createLiveMatch("org-1")).resolves.toBe("new-match");
      expect(matchCountMock).not.toHaveBeenCalled();
    });

    it("creates a match when free-plan but no other match is live", async () => {
      getOrgAccountMock.mockResolvedValue({ accountId: "acc-1", plan: "free" });
      matchCountMock.mockResolvedValue(0);
      matchCreateMock.mockResolvedValue({ id: "new-match" });
      const { createLiveMatch } = await import("../persistence");

      await expect(createLiveMatch("org-1")).resolves.toBe("new-match");
    });

    it("throws ConcurrentMatchLimitError on a free plan with a live match elsewhere", async () => {
      getOrgAccountMock.mockResolvedValue({ accountId: "acc-1", plan: "free" });
      matchCountMock.mockResolvedValue(1);
      const { createLiveMatch } = await import("../persistence");

      await expect(createLiveMatch("org-1")).rejects.toBeInstanceOf(FakeConcurrentMatchLimitError);
      expect(matchCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("MatchStore.load / resolveMatch", () => {
    it("resolves an explicit matchId belonging to the org and loads its state", async () => {
      const state: MatchState = { ...DEFAULT_MATCH_STATE, matchName: "Finals" };
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state });
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      await expect(store.load()).resolves.toEqual(state);
    });

    it("throws MatchNotFoundError when the match belongs to a different org", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-2", status: "LIVE" });
      const { getMatchStore, MatchNotFoundError } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      await expect(store.load()).rejects.toBeInstanceOf(MatchNotFoundError);
    });

    it("throws MatchNotFoundError when the match doesn't exist", async () => {
      matchFindUniqueMock.mockResolvedValue(null);
      const { getMatchStore, MatchNotFoundError } = await import("../persistence");

      const store = getMatchStore("org-1", "missing")!;
      await expect(store.load()).rejects.toBeInstanceOf(MatchNotFoundError);
    });

    it("transitions a SCHEDULED match to LIVE on first access", async () => {
      matchFindUniqueMock
        .mockResolvedValueOnce({ id: "m1", orgId: "org-1", status: "SCHEDULED" })
        .mockResolvedValueOnce({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      getOrgAccountMock.mockResolvedValue({ accountId: "acc-1", plan: "pro" });
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      await store.load();
      expect(matchUpdateMock).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "LIVE" } });
    });

    it("blocks a SCHEDULED->LIVE transition on the free plan when another match is already live", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "SCHEDULED" });
      getOrgAccountMock.mockResolvedValue({ accountId: "acc-1", plan: "free" });
      matchCountMock.mockResolvedValue(1);
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      await expect(store.load()).rejects.toBeInstanceOf(FakeConcurrentMatchLimitError);
      expect(matchUpdateMock).not.toHaveBeenCalled();
    });

    it("caches the resolved matchId so a second load() doesn't re-resolve", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      await store.load();
      await store.load();
      // One findUnique per load() call (state fetch) but resolveMatch's own
      // findUnique (status/org check) should only run once, on the first call.
      expect(matchFindUniqueMock).toHaveBeenCalledTimes(3);
    });

    it("falls back to the org's existing LIVE match when no matchId is given", async () => {
      matchFindFirstMock.mockResolvedValue({ id: "live-match" });
      matchFindUniqueMock.mockResolvedValue({ id: "live-match", state: DEFAULT_MATCH_STATE });
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1")!;
      await expect(store.load()).resolves.toEqual(DEFAULT_MATCH_STATE);
      expect(matchCreateMock).not.toHaveBeenCalled();
    });

    it("creates a new LIVE match when no matchId is given and none is live", async () => {
      matchFindFirstMock.mockResolvedValue(null);
      getOrgAccountMock.mockResolvedValue({ accountId: "acc-1", plan: "pro" });
      matchCreateMock.mockResolvedValue({ id: "brand-new" });
      matchFindUniqueMock.mockResolvedValue({ id: "brand-new", state: DEFAULT_MATCH_STATE });
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1")!;
      await store.load();
      expect(matchCreateMock).toHaveBeenCalled();
    });

    it("defaults to DEFAULT_MATCH_STATE when the row has no state", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: null });
      const { getMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      await expect(store.load()).resolves.toEqual(DEFAULT_MATCH_STATE);
    });
  });

  describe("MatchStore.save / flush (debounced write-through)", () => {
    it("debounces rapid save() calls into a single write", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.save({ ...DEFAULT_MATCH_STATE, matchName: "First" });
      store.save({ ...DEFAULT_MATCH_STATE, matchName: "Second" });

      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      expect(matchUpdateMock).toHaveBeenCalledTimes(1);
      expect(matchUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ homeName: "Home" }) }),
      );
      // Only the last of the two rapid save() calls should have been written.
      const [[{ data }]] = matchUpdateMock.mock.calls;
      expect((data.state as { matchName: string }).matchName).toBe("Second");
    });

    it("flush() writes immediately and cancels the pending timer", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.save({ ...DEFAULT_MATCH_STATE, matchName: "Flushed" });
      await store.flush();

      expect(matchUpdateMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(matchUpdateMock).toHaveBeenCalledTimes(1);
    });

    it("flush() is a no-op when there's nothing pending", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      await store.flush();
      expect(matchUpdateMock).not.toHaveBeenCalled();
    });

    it("logs but does not throw when the debounced write fails", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      matchUpdateMock.mockRejectedValue(new Error("db down"));
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.save({ ...DEFAULT_MATCH_STATE, matchName: "X" });
      jest.advanceTimersByTime(2000);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        "[relay] failed to persist match state for org:",
        "org-1",
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  describe("evictMatchStore / allActiveStores", () => {
    it("flushes and removes the store from the cache", async () => {
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      const { getMatchStore, evictMatchStore, allActiveStores } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      store.save({ ...DEFAULT_MATCH_STATE, matchName: "Evicting" });
      expect(allActiveStores()).toContain(store);

      await evictMatchStore("org-1", "m1");

      expect(matchUpdateMock).toHaveBeenCalledTimes(1);
      expect(allActiveStores()).not.toContain(store);
      expect(getMatchStore("org-1", "m1")).not.toBe(store);
    });

    it("is a no-op for a matchId that was never stored", async () => {
      const { evictMatchStore } = await import("../persistence");
      await expect(evictMatchStore("org-1", "never-existed")).resolves.toBeUndefined();
    });

    it("logs but does not throw when the flush-on-evict write fails", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
      matchUpdateMock.mockRejectedValue(new Error("db down"));
      const { getMatchStore, evictMatchStore } = await import("../persistence");

      const store = getMatchStore("org-1", "m1")!;
      store.save({ ...DEFAULT_MATCH_STATE, matchName: "X" });

      await evictMatchStore("org-1", "m1");
      expect(errorSpy).toHaveBeenCalledWith(
        "[relay] failed to flush match state on evict:",
        "org-1",
        "m1",
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  describe("event log", () => {
    const event = (type: "score" | "clock_start", at: string): MatchEvent => ({
      type, at, clockSeconds: 60, period: "1", home: 1, visitor: 0,
    });

    const liveMatch = () =>
      matchFindUniqueMock.mockResolvedValue({ id: "m1", orgId: "org-1", status: "LIVE", state: DEFAULT_MATCH_STATE });
    const writtenTypes = () =>
      eventCreateManyMock.mock.calls.flatMap(([arg]) => (arg as { data: { type: string }[] }).data.map(d => d.type));

    it("appendEvents batches events into one write per flush interval, in order", async () => {
      liveMatch();
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.appendEvents([event("clock_start", "2026-10-11T02:00:00.000Z"), event("score", "2026-10-11T02:00:05.000Z")]);
      store.appendEvents([event("score", "2026-10-11T02:00:09.000Z")]);
      store.appendEvents([]);
      expect(eventCreateManyMock).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1000);
      expect(eventCreateManyMock).toHaveBeenCalledTimes(1);
      expect(writtenTypes()).toEqual(["clock_start", "score", "score"]);
      expect(eventCreateManyMock.mock.calls[0][0].data[1]).toEqual({
        matchId: "m1",
        type: "score",
        at: new Date("2026-10-11T02:00:05.000Z"),
        data: event("score", "2026-10-11T02:00:05.000Z"),
      });

      store.appendEvents([event("clock_start", "2026-10-11T02:01:00.000Z")]);
      await jest.advanceTimersByTimeAsync(1000);
      expect(eventCreateManyMock).toHaveBeenCalledTimes(2);
    });

    it("a burst of events costs one write, however many arrive within the interval", async () => {
      liveMatch();
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      for (let i = 0; i < 300; i++) store.appendEvents([event("score", "2026-10-11T02:00:00.000Z")]);
      await jest.advanceTimersByTimeAsync(1000);

      expect(eventCreateManyMock).toHaveBeenCalledTimes(1);
      expect(eventCreateManyMock.mock.calls[0][0].data).toHaveLength(300);
    });

    it("flush writes waiting events without waiting for the timer", async () => {
      liveMatch();
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.appendEvents([event("score", "2026-10-11T02:00:00.000Z")]);
      await store.flush();
      expect(writtenTypes()).toEqual(["score"]);

      await jest.advanceTimersByTimeAsync(5000);
      expect(eventCreateManyMock).toHaveBeenCalledTimes(1);
    });

    it("ends a full log on a log_full marker, records it once, and logs nothing after", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      liveMatch();
      eventCountMock.mockResolvedValue(9_997);
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      // Room for two events plus the marker; the third event becomes the marker.
      store.appendEvents([
        { ...event("score", "2026-10-11T02:00:00.000Z"), side: "home", delta: 1 },
        event("clock_start", "2026-10-11T02:00:01.000Z"),
        { ...event("score", "2026-10-11T02:00:02.000Z"), side: "visitor", delta: 3, home: 7, visitor: 9 },
        event("score", "2026-10-11T02:00:03.000Z"),
      ]);
      await store.flush();
      expect(writtenTypes()).toEqual(["score", "clock_start", "log_full"]);
      const marker = eventCreateManyMock.mock.calls[0][0].data[2].data;
      expect(marker).toMatchObject({ type: "log_full", at: "2026-10-11T02:00:02.000Z", home: 7, visitor: 9 });
      expect(marker.side).toBeUndefined();
      expect(marker.delta).toBeUndefined();

      store.appendEvents([event("score", "2026-10-11T02:00:09.000Z")]);
      await store.flush();
      store.appendEvents([event("score", "2026-10-11T02:00:10.000Z")]);
      await store.flush();

      expect(eventCreateManyMock).toHaveBeenCalledTimes(1);
      expect(eventCountMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
      expect(recordAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
        eventType: "match.event_log_full", orgId: "org-1", metadata: { matchId: "m1" },
      }));
      warnSpy.mockRestore();
    });

    it("fills the log exactly to its limit without a marker when nothing is dropped", async () => {
      liveMatch();
      eventCountMock.mockResolvedValue(9_998);
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.appendEvents([event("score", "2026-10-11T02:00:00.000Z")]);
      await store.flush();

      expect(writtenTypes()).toEqual(["score"]);
      expect(recordAuditEventMock).not.toHaveBeenCalled();
    });

    it("writes nothing to a log that was already full when the relay started", async () => {
      liveMatch();
      eventCountMock.mockResolvedValue(10_000);
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.appendEvents([event("score", "2026-10-11T02:00:00.000Z")]);
      await store.flush();

      expect(eventCreateManyMock).not.toHaveBeenCalled();
    });

    it("drops events rather than hold more in memory than the cap", async () => {
      liveMatch();
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      const big = Array.from({ length: 10_000 }, () => event("score", "2026-10-11T02:00:00.000Z"));
      store.appendEvents(big);
      store.appendEvents([event("clock_start", "2026-10-11T02:00:01.000Z")]);
      await store.flush();

      // 9,999 events and the marker: the buffer never held more than the cap.
      expect(eventCreateManyMock.mock.calls[0][0].data).toHaveLength(10_000);
      expect(writtenTypes().at(-1)).toBe("log_full");
      expect(writtenTypes()).not.toContain("clock_start");
    });

    it("logs a failed event write and keeps writing later ones", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      liveMatch();
      eventCreateManyMock.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ count: 1 });
      const { getMatchStore } = await import("../persistence");
      const store = getMatchStore("org-1", "m1")!;

      store.appendEvents([event("score", "2026-10-11T02:00:00.000Z")]);
      await expect(store.flush()).resolves.toBeUndefined();
      store.appendEvents([event("score", "2026-10-11T02:00:01.000Z")]);
      await store.flush();

      expect(eventCreateManyMock).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith("[relay] failed to persist match events for org:", "org-1", expect.any(Error));
      errorSpy.mockRestore();
    });

    it("listMatchEvents returns stored events after `since` with seq as a number", async () => {
      matchFindUniqueMock.mockResolvedValue({ orgId: "org-1" });
      eventFindManyMock.mockResolvedValue([{ seq: BigInt(42), data: event("score", "2026-10-11T02:00:00.000Z") }]);
      const { listMatchEvents } = await import("../persistence");

      await expect(listMatchEvents("org-1", "m1", 41, 500)).resolves.toEqual([
        { ...event("score", "2026-10-11T02:00:00.000Z"), seq: 42 },
      ]);
      expect(eventFindManyMock).toHaveBeenCalledWith({ where: { matchId: "m1", seq: { gt: 41 } }, orderBy: { seq: "asc" }, take: 500 });
    });

    it("listMatchEvents rejects a match from another org", async () => {
      matchFindUniqueMock.mockResolvedValue({ orgId: "org-2" });
      const { listMatchEvents, MatchNotFoundError } = await import("../persistence");

      await expect(listMatchEvents("org-1", "m1", 0, 500)).rejects.toBeInstanceOf(MatchNotFoundError);
      expect(eventFindManyMock).not.toHaveBeenCalled();
    });

    it("listMatchEvents without a matchId reads the org's live match and never creates one", async () => {
      const { listMatchEvents } = await import("../persistence");

      matchFindFirstMock.mockResolvedValueOnce(null);
      await expect(listMatchEvents("org-1", undefined, 0, 500)).resolves.toEqual([]);
      expect(matchCreateMock).not.toHaveBeenCalled();

      matchFindFirstMock.mockResolvedValueOnce({ id: "live-1" });
      eventFindManyMock.mockResolvedValue([]);
      await listMatchEvents("org-1", undefined, 0, 500);
      expect(eventFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { matchId: "live-1", seq: { gt: 0 } } }));
    });
  });
});
