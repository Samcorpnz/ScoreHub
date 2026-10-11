import type { MatchEvent, MatchEventType } from "@scorehub/types";
import type { MatchState } from "./types";

// Why a state change happened, where that can't be told from the states
// themselves: a reset and an undo both look like scores going down.
export type MatchEventCause = "reset" | "undo";

type Snapshot = Pick<MatchState, "clockSeconds" | "period" | "periodBreak" | "isRunning" | "home" | "visitor">;

// Derives the event log entries for one state change. Called for every
// setState, including the 1Hz clock tick, so it returns early when nothing
// loggable moved.
export function diffMatchEvents(prev: Snapshot, next: Snapshot, at: Date, cause?: MatchEventCause): MatchEvent[] {
  // A stored state can predate a field (older Match.state rows, a sparse
  // bridge frame), so a missing value is read as its default rather than as
  // a change from it.
  const homeDelta = (next.home?.score ?? 0) - (prev.home?.score ?? 0);
  const visitorDelta = (next.visitor?.score ?? 0) - (prev.visitor?.score ?? 0);
  const periodChanged = prev.period !== undefined && next.period !== undefined && next.period !== prev.period;
  const runningChanged = Boolean(next.isRunning) !== Boolean(prev.isRunning);
  const breakChanged = Boolean(next.periodBreak) !== Boolean(prev.periodBreak);
  if (!cause && homeDelta === 0 && visitorDelta === 0 && !periodChanged && !runningChanged && !breakChanged) {
    return [];
  }

  const base = {
    at: at.toISOString(),
    clockSeconds: next.clockSeconds,
    period: next.period,
    home: next.home?.score ?? 0,
    visitor: next.visitor?.score ?? 0,
  };
  const event = (type: MatchEventType, extra: Partial<MatchEvent> = {}): MatchEvent => ({
    type,
    ...base,
    ...extra,
    ...(cause === "undo" ? { correction: true } : {}),
  });

  if (cause === "reset") return [event("reset")];

  const events: MatchEvent[] = [];

  // A score that drops as the period changes is the between-sets reset
  // (volleyball, badminton, …), not play — the period event's `previous`
  // carries the scores the set finished on instead.
  const scoreEvent = (side: "home" | "visitor", delta: number) => {
    if (delta === 0) return;
    if (periodChanged && delta < 0 && cause !== "undo") return;
    events.push(event("score", { side, delta }));
  };
  scoreEvent("home", homeDelta);
  scoreEvent("visitor", visitorDelta);

  if (periodChanged) {
    events.push(
      event("period", {
        fromPeriod: prev.period,
        previous: { home: prev.home?.score ?? 0, visitor: prev.visitor?.score ?? 0 },
      }),
    );
  }
  if (breakChanged) events.push(event(next.periodBreak ? "break_start" : "break_end"));
  if (runningChanged) events.push(event(next.isRunning ? "clock_start" : "clock_stop"));

  return events;
}

// Legacy mode (no DATABASE_URL) has no table to write to, so the log for
// each room is kept here, newest last, capped so a long-running self-hosted
// relay doesn't grow without bound.
const BUFFER_SIZE = 500;

export interface MatchEventBuffer {
  append(room: string, events: MatchEvent[]): void;
  list(room: string, since: number, limit: number): MatchEvent[];
}

export function createMatchEventBuffer(): MatchEventBuffer {
  const rooms = new Map<string, { nextSeq: number; events: MatchEvent[] }>();
  return {
    append(room, events) {
      const entry = rooms.get(room) ?? { nextSeq: 1, events: [] };
      for (const e of events) entry.events.push({ ...e, seq: entry.nextSeq++ });
      if (entry.events.length > BUFFER_SIZE) entry.events.splice(0, entry.events.length - BUFFER_SIZE);
      rooms.set(room, entry);
    },
    list(room, since, limit) {
      const entry = rooms.get(room);
      if (!entry) return [];
      return entry.events.filter(e => (e.seq ?? 0) > since).slice(0, limit);
    },
  };
}
