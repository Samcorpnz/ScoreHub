import type { MatchState } from "./types";

// What the clock starts a period on, mirroring the frontend's
// sport-templates.ts (getPeriodClockSeconds) so the Stream Deck/Control API
// routes and Reset Match agree with the control panel's own buttons.

type FormatState = Pick<MatchState, "sport" | "sportConfig">;

// Default clock duration per sport.
const SPORT_DEFAULT_CLOCK: Record<string, number> = {
  netball: 900, basketball: 600, rugby_union: 0, rugby_league: 0,
  volleyball: 0, football: 0, handball: 1800, hockey: 900, waterpolo: 480,
  tennis: 0, touch_rugby: 2400, futsal: 1200, pickleball: 0, badminton: 0,
  table_tennis: 0, floorball: 1200, squash: 0, lawn_bowls: 0,
  indoor_cricket: 0, softball: 0, cricket: 0, custom: 600,
};

// Sports that can go to extra time: how many regulation periods they have
// (any period after that is extra time), and how long an extra-time period
// is where that differs from a regulation one.
const SPORT_EXTRA_TIME: Record<string, { periods: number; seconds?: number }> = {
  netball: { periods: 4, seconds: 420 }, basketball: { periods: 4, seconds: 300 },
  rugby_union: { periods: 2 }, rugby_league: { periods: 2 }, football: { periods: 2 },
  handball: { periods: 2, seconds: 300 }, hockey: { periods: 4, seconds: 450 },
  waterpolo: { periods: 4, seconds: 180 }, touch_rugby: { periods: 2, seconds: 120 },
  futsal: { periods: 2, seconds: 300 }, floorball: { periods: 3, seconds: 600 },
};

// Fast5 is netball played to a different template (sportConfig.format).
const FAST5_CLOCK = 360;
const FAST5_EXTRA_TIME = 60;

function isFast5(state: FormatState): boolean {
  return state.sport === "netball" && state.sportConfig?.format === "fast5";
}

export function regulationClock(state: FormatState): number {
  return isFast5(state) ? FAST5_CLOCK : SPORT_DEFAULT_CLOCK[state.sport] ?? 0;
}

export function periodClock(state: FormatState, period: number): number {
  const extraTime = SPORT_EXTRA_TIME[state.sport];
  if (!extraTime || period <= extraTime.periods) return regulationClock(state);
  // The length the operator set for this match wins over the sport's default
  const chosen = state.sportConfig?.extraTimeSeconds;
  if (typeof chosen === "number" && Number.isInteger(chosen) && chosen >= 0) return chosen;
  return isFast5(state) ? FAST5_EXTRA_TIME : extraTime.seconds ?? regulationClock(state);
}
