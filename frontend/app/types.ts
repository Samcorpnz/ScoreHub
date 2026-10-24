export type {
  TeamPlayer,
  TeamState,
  Possession,
  SportType,
  NetballPlayerStats,
  NetballTeamStats,
  NetballMatchStats,
  DisplayTheme,
  DisplayOutputKey,
  OutputStyle,
  MatchState,
  IndoorCricketState,
  SoftballState,
  SoftballFormat,
  CricketState,
  CricketFormat,
  CricketInningsState,
  CricketBatter,
  CricketBowler,
  WicketType,
  CricketBallEvent,
  CricketSession,
  GraphicsFeed,
  GraphicsStatBag,
  GraphicsPlayerStats,
  ScoreAdjustEvent,
  IndoorCricketWicketEvent,
  ShootoutState,
} from "@scorehub/types";

import type { MatchState, CricketState } from "@scorehub/types";

export { DEFAULT_DISPLAY_THEME, DISPLAY_OUTPUT_KEYS } from "@scorehub/types";

export const DEFAULT_MATCH_STATE = {
  sequenceId: -1,
  clockSeconds: 0,
  clockCarryMs: 0,
  countDown: false,
  period: "1",
  periodBreak: false,
  matchName: "",
  isRunning: false,
  possession: "none" as const,
  hornActive: false,
  sport: "netball" as const,
  inputSource: "none",
  home:    { name: "Home",    score: 0, faults: 0, timeouts: 0, players: [], color: "#F59E0B", logoUrl: "" },
  visitor: { name: "Visitor", score: 0, faults: 0, timeouts: 0, players: [], color: "#818CF8", logoUrl: "" },
  displayTheme: { primaryColor: "#00C8FF", backgroundColor: "#07090F", font: "", textScale: 1, competitionLogoUrl: "" },
};

export function formatClock(totalSeconds: number): string {
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const sign = totalSeconds < 0 ? "-" : "";
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatClockDisplay(seconds: number): string {
  if (seconds >= 60) return formatClock(Math.floor(seconds));
  const s = Math.floor(seconds);
  const tenths = Math.floor((seconds - s) * 10);
  return `${String(s).padStart(2, "0")}.${tenths}`;
}

// Indoor cricket displays "runs/wickets" (e.g. "87/6") instead of a plain score.
export function formatScore(state: MatchState, side: "home" | "visitor"): string {
  const score = state[side].score;
  if (state.sport === "indoor_cricket") {
    const sportState = state.sportState as { homeWickets?: number; visitorWickets?: number } | undefined;
    const wickets = side === "home" ? sportState?.homeWickets ?? 0 : sportState?.visitorWickets ?? 0;
    return `${score}/${wickets}`;
  }
  if (state.sport === "cricket") {
    const cricket = state.sportState as CricketState | undefined;
    const innings = cricket?.innings.filter(i => i.battingTeam === side);
    const current = innings?.[innings.length - 1];
    if (!current) return "0/0";
    return `${current.runs}/${current.wickets}`;
  }
  return String(score);
}
