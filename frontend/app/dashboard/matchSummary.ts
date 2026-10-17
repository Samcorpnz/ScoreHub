import { DEFAULT_MATCH_STATE, type MatchState } from "../types";
import { getBreakLabel, getMatchTemplate, getPeriodLabel, getPeriodNumber, isFullTime } from "../sport-templates";

// What the matches list API sends for a row's live state (see liveSummary in
// app/api/orgs/[orgId]/matches/route.ts). Null for a row with no saved state.
export interface LiveSummary {
  homeScore: number;
  visitorScore: number;
  period: string;
  periodBreak: boolean;
  isRunning: boolean;
  clockSeconds: number;
  countDown: boolean;
  sportConfig?: Record<string, unknown>;
  shootout?: MatchState["shootout"] | null;
}

export type StatusTone = "live" | "break" | "idle" | "done";

export interface MatchSummary {
  status: string;
  tone: StatusTone;
  // Score and period only once there's something to show
  score?: string;
  period?: string;
}

// The sport rules work on a MatchState, so rebuild just enough of one
function asState(sport: string, live: LiveSummary): MatchState {
  return {
    ...DEFAULT_MATCH_STATE,
    sport,
    period: live.period,
    periodBreak: live.periodBreak,
    isRunning: live.isRunning,
    clockSeconds: live.clockSeconds,
    countDown: live.countDown,
    sportConfig: live.sportConfig,
    shootout: live.shootout ?? undefined,
    home: { ...DEFAULT_MATCH_STATE.home, score: live.homeScore },
    visitor: { ...DEFAULT_MATCH_STATE.visitor, score: live.visitorScore },
  } as MatchState;
}

export function summariseMatch(
  status: "SCHEDULED" | "LIVE" | "ENDED",
  sport: string | null,
  live: LiveSummary | null,
): MatchSummary {
  if (status === "SCHEDULED") return { status: "Scheduled", tone: "idle" };

  const score = live ? `${live.homeScore} – ${live.visitorScore}` : undefined;
  if (status === "ENDED") return { status: "Final", tone: "done", score };
  if (!live || !sport) return { status: "Live", tone: "live" };

  const state = asState(sport, live);
  if (isFullTime(state)) return { status: "Full time", tone: "break", score };
  if (state.periodBreak) return { status: titleCase(getBreakLabel(state)), tone: "break", score };

  const period = `${getPeriodLabel(state)} ${getPeriodNumber(state)}`;
  if (state.isRunning) return { status: "In play", tone: "live", score, period };

  // Never started: still on the opening period's untouched clock, 0–0
  const notStarted = live.period === "1" && live.homeScore === 0 && live.visitorScore === 0
    && live.clockSeconds === getMatchTemplate(state).clockSeconds;
  if (notStarted) return { status: "Not started", tone: "idle" };
  return { status: "Paused", tone: "idle", score, period };
}

// "HALF TIME" → "Half time", "QTR BREAK" → "Qtr break"
function titleCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}
