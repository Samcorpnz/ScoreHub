import type { MatchState } from "./types.js";

// What the period key shows, e.g. "QTR 3", "SET 2" or "ET 1". Mirrors the
// period labels in frontend/app/sport-templates.ts — the plugin is bundled on
// its own, so it can't import them. `periods` is set for sports that can go
// to extra time: anything past it is numbered from 1 again under `extra`.
const PERIODS: Record<string, { label: string; periods?: number; extra?: string }> = {
  netball: { label: "QTR", periods: 4 }, basketball: { label: "QTR", periods: 4, extra: "OT" },
  rugby_union: { label: "HALF", periods: 2 }, rugby_league: { label: "HALF", periods: 2, extra: "GP" },
  football: { label: "HALF", periods: 2 }, handball: { label: "HALF", periods: 2 },
  hockey: { label: "QTR", periods: 4 }, waterpolo: { label: "QTR", periods: 4 },
  touch_rugby: { label: "HALF", periods: 2, extra: "DROP" }, futsal: { label: "HALF", periods: 2 },
  floorball: { label: "PERIOD", periods: 3 },
  volleyball: { label: "SET" }, tennis: { label: "SET" },
  pickleball: { label: "GAME" }, badminton: { label: "GAME" }, table_tennis: { label: "GAME" }, squash: { label: "GAME" },
  lawn_bowls: { label: "END" }, indoor_cricket: { label: "INN" }, softball: { label: "INN" }, cricket: { label: "INN" },
};

export function periodTitle(state: Pick<MatchState, "sport" | "period">): string {
  const sport = PERIODS[state.sport ?? ""] ?? { label: "PERIOD" };
  const n = Number.parseInt(state.period, 10);
  if (state.period === "E") return "EXTRA";
  if (sport.periods && n > sport.periods) return `${sport.extra ?? "ET"} ${n - sport.periods}`;
  return `${sport.label} ${state.period}`;
}
