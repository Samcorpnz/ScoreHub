import type { ComponentType } from "react";
import type { SportType, Possession, MatchState, SoftballState, CricketState, CricketBallEvent, ScoreAdjustEvent, IndoorCricketWicketEvent } from "./types";
import { SoftballTab } from "./control/components/SoftballTab";
import { CricketTab } from "./control/components/CricketTab";
import { CricketDisplayStats } from "./display/components/CricketDisplayStats";
import { NetballDisplayStats } from "./display/components/NetballDisplayStats";
import { SoftballDisplayStats } from "./display/components/SoftballDisplayStats";
import { IndoorCricketDisplayStats } from "./display/components/IndoorCricketDisplayStats";

export interface ControlPanelProps {
  readonly state: MatchState;
  readonly push: (p: Partial<MatchState>) => void;
  readonly sendReset: () => void;
  readonly sendUndo: () => void;
  readonly sendCricketBall: (payload: CricketBallEvent) => void;
  readonly sendCricketOverComplete: (payload: { nextBowlerIndex?: number }) => void;
  readonly sendCricketInningsChange: (payload: { battingTeam: "home" | "visitor"; target?: number }) => void;
  readonly sendCricketDeclare: (payload: { battingTeam: "home" | "visitor" }) => void;
  readonly sendScoreAdjust: (payload: ScoreAdjustEvent) => void;
  readonly sendIndoorCricketWicket: (payload: IndoorCricketWicketEvent) => void;
}

export interface DisplayStatsProps {
  state: MatchState;
  variant?: "full" | "compact";
}

export interface ConfigFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: "select";
  options: ConfigFieldOption[];
  defaultValue: string;
}

export interface SportTemplate {
  sport: SportType;
  label: string;
  structure: string;
  periods: number;
  periodLabel: string;
  clockSeconds: number;
  countDown: boolean;
  timeoutsPerTeam: number;
  defaultPossession: Possession;
  scoreIncrements: number[];
  scoreLabels?: string[];
  resetScoreOnPeriod?: boolean;
  controlPanel?: ComponentType<ControlPanelProps>;
  displayStats?: ComponentType<DisplayStatsProps>;
  matchConfig?: ConfigField[];
}

export const SPORT_TEMPLATES: SportTemplate[] = [
  {
    sport: "netball",
    label: "Netball",
    structure: "4 quarters × 15:00",
    periods: 4,
    periodLabel: "QTR",
    clockSeconds: 900,
    countDown: true,
    timeoutsPerTeam: 1,
    defaultPossession: "none",
    scoreIncrements: [1, 2],
    displayStats: NetballDisplayStats,
  },
  {
    sport: "basketball",
    label: "Basketball",
    structure: "4 quarters × 10:00",
    periods: 4,
    periodLabel: "QTR",
    clockSeconds: 600,
    countDown: true,
    timeoutsPerTeam: 5,
    defaultPossession: "home",
    scoreIncrements: [1, 2, 3],
    scoreLabels: ["FT", "2PT", "3PT"],
  },
  {
    sport: "rugby_union",
    label: "Rugby Union",
    structure: "2 halves × 40:00",
    periods: 2,
    periodLabel: "HALF",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "home",
    scoreIncrements: [3, 5, 7],
    scoreLabels: ["PEN/DG", "TRY", "CONV TRY"],
  },
  {
    sport: "rugby_league",
    label: "Rugby League",
    structure: "2 halves × 40:00",
    periods: 2,
    periodLabel: "HALF",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "home",
    scoreIncrements: [2, 4, 6],
    scoreLabels: ["CONV/PEN", "TRY", "CONV TRY"],
  },
  {
    sport: "volleyball",
    label: "Volleyball",
    structure: "Best of 5 sets",
    periods: 5,
    periodLabel: "SET",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 2,
    defaultPossession: "none",
    scoreIncrements: [1],
    resetScoreOnPeriod: true,
  },
  {
    sport: "football",
    label: "Football",
    structure: "2 halves × 45:00",
    periods: 2,
    periodLabel: "HALF",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1],
  },
  {
    sport: "handball",
    label: "Handball",
    structure: "2 halves × 30:00",
    periods: 2,
    periodLabel: "HALF",
    clockSeconds: 1800,
    countDown: true,
    timeoutsPerTeam: 3,
    defaultPossession: "none",
    scoreIncrements: [1],
  },
  {
    sport: "hockey",
    label: "Hockey",
    structure: "4 quarters × 15:00",
    periods: 4,
    periodLabel: "QTR",
    clockSeconds: 900,
    countDown: true,
    timeoutsPerTeam: 1,
    defaultPossession: "none",
    scoreIncrements: [1],
  },
  {
    sport: "waterpolo",
    label: "Water Polo",
    structure: "4 quarters × 8:00",
    periods: 4,
    periodLabel: "QTR",
    clockSeconds: 480,
    countDown: true,
    timeoutsPerTeam: 2,
    defaultPossession: "home",
    scoreIncrements: [1],
  },
  {
    sport: "tennis",
    label: "Tennis",
    structure: "Best of 3 or 5 sets",
    periods: 5,
    periodLabel: "SET",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1],
    resetScoreOnPeriod: true,
    matchConfig: [
      {
        key: "format",
        label: "Match Format",
        type: "select",
        options: [
          { value: "bo3", label: "Best of 3", description: "Most tour, club and doubles matches" },
          { value: "bo5", label: "Best of 5", description: "Grand Slam men's singles" },
        ],
        defaultValue: "bo3",
      },
    ],
  },
  {
    sport: "touch_rugby",
    label: "Touch Rugby",
    structure: "2 halves × 40:00",
    periods: 2,
    periodLabel: "HALF",
    clockSeconds: 2400,
    countDown: true,
    timeoutsPerTeam: 0,
    defaultPossession: "home",
    scoreIncrements: [1],
  },
  {
    sport: "futsal",
    label: "Futsal",
    structure: "2 halves × 20:00",
    periods: 2,
    periodLabel: "HALF",
    clockSeconds: 1200,
    countDown: true,
    timeoutsPerTeam: 1,
    defaultPossession: "none",
    scoreIncrements: [1],
  },
  {
    sport: "pickleball",
    label: "Pickleball",
    structure: "Best of 3 games to 11",
    periods: 3,
    periodLabel: "GAME",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 2,
    defaultPossession: "none",
    scoreIncrements: [1],
    resetScoreOnPeriod: true,
  },
  {
    sport: "badminton",
    label: "Badminton",
    structure: "Best of 3 games to 21",
    periods: 3,
    periodLabel: "GAME",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 1,
    defaultPossession: "none",
    scoreIncrements: [1],
    resetScoreOnPeriod: true,
  },
  {
    sport: "table_tennis",
    label: "Table Tennis",
    structure: "Best of 7 games to 11",
    periods: 7,
    periodLabel: "GAME",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 1,
    defaultPossession: "none",
    scoreIncrements: [1],
    resetScoreOnPeriod: true,
  },
  {
    sport: "floorball",
    label: "Floorball",
    structure: "3 periods × 20:00",
    periods: 3,
    periodLabel: "PERIOD",
    clockSeconds: 1200,
    countDown: true,
    timeoutsPerTeam: 1,
    defaultPossession: "none",
    scoreIncrements: [1],
  },
  {
    sport: "squash",
    label: "Squash",
    structure: "Best of 5 games to 11",
    periods: 5,
    periodLabel: "GAME",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1],
    resetScoreOnPeriod: true,
    matchConfig: [
      {
        key: "format",
        label: "Match Format",
        type: "select",
        options: [
          { value: "bo5", label: "Best of 5", description: "WSF / PSA major events" },
          { value: "bo3", label: "Best of 3", description: "Circuit / club events" },
        ],
        defaultValue: "bo5",
      },
    ],
  },
  {
    sport: "lawn_bowls",
    label: "Lawn Bowls",
    structure: "21 ends",
    periods: 21,
    periodLabel: "END",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1, 2, 3, 4],
  },
  {
    sport: "indoor_cricket",
    label: "Indoor Cricket",
    structure: "2 × 8-over innings",
    periods: 2,
    periodLabel: "INNINGS",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1, 2, 4, 6],
    displayStats: IndoorCricketDisplayStats,
    matchConfig: [
      {
        key: "wicketPenalty",
        label: "Wicket Penalty",
        type: "select",
        options: [
          { value: "5", label: "-5 runs", description: "Cricket NZ standard" },
          { value: "2", label: "-2 runs", description: "ICF international" },
        ],
        defaultValue: "5",
      },
    ],
  },
  {
    sport: "softball",
    label: "Softball",
    structure: "7 innings (fastpitch)",
    periods: 7,
    periodLabel: "INNING",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1],
    controlPanel: SoftballTab,
    displayStats: SoftballDisplayStats,
    matchConfig: [
      {
        key: "format",
        label: "Format",
        type: "select",
        options: [
          { value: "fastpitch", label: "Fastpitch", description: "WBSC international — 7 innings" },
          { value: "slowpitch", label: "Slowpitch", description: "Community/social — 6 innings" },
        ],
        defaultValue: "fastpitch",
      },
    ],
  },
  {
    sport: "cricket",
    label: "Cricket",
    structure: "T20 / ODI / Test",
    periods: 1,
    periodLabel: "INNINGS",
    clockSeconds: 0,
    countDown: false,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1, 2, 3, 4, 6],
    controlPanel: CricketTab,
    displayStats: CricketDisplayStats,
    matchConfig: [
      {
        key: "format",
        label: "Format",
        type: "select",
        options: [
          { value: "t20", label: "T20", description: "20 overs per side" },
          { value: "odi", label: "ODI", description: "50 overs per side" },
          { value: "test", label: "Test", description: "Up to 2 innings per side, multi-day" },
        ],
        defaultValue: "t20",
      },
    ],
  },
  {
    sport: "custom",
    label: "Custom",
    structure: "2 periods × 10:00",
    periods: 2,
    periodLabel: "PERIOD",
    clockSeconds: 600,
    countDown: true,
    timeoutsPerTeam: 0,
    defaultPossession: "none",
    scoreIncrements: [1, 2, 3],
  },
];

function ordinalInningsLabel(n: number): string {
  if (n === 1) return "1ST";
  if (n === 2) return "2ND";
  if (n === 3) return "3RD";
  return `${n}TH`;
}

export function getTemplate(sport: SportType): SportTemplate {
  return SPORT_TEMPLATES.find(t => t.sport === sport) ?? SPORT_TEMPLATES.at(-1)!;
}

// Best-of sports (squash, tennis) let the operator choose the match length at
// setup (sportConfig.format: "bo3" | "bo5"). Returns how many games/sets the
// match can run to, or undefined when there's no cap: every other sport
// (timed sports can go to extra time), and matches with no format recorded
// (fixtures uploaded in bulk, or created before the option existed).
// Mirrored by bestOfLength in relay/src/server.ts for Stream Deck/webhooks.
export function getMatchLength(state: Pick<MatchState, "sport" | "sportConfig">): number | undefined {
  const formatField = getTemplate(state.sport).matchConfig?.find(f => f.key === "format");
  const format = String(state.sportConfig?.format ?? "");
  if (!formatField?.options.some(o => o.value === format)) return undefined;
  const match = /^bo(\d+)$/.exec(format);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

// The template's structure line with the chosen match length filled in,
// e.g. "Best of 3 games to 11" rather than the template's default.
export function getStructureLabel(state: Pick<MatchState, "sport" | "sportConfig">): string {
  const template = getTemplate(state.sport);
  const length = getMatchLength(state);
  if (length === undefined) return template.structure;
  return template.structure.replace(/Best of \d+( or \d+)?/, `Best of ${length}`);
}

// Softball shows "TOP n" / "BOT n" instead of the static periodLabel (e.g. "INNING")
// since which half of the inning it is matters more to viewers than the label itself.
export function getPeriodLabel(state: MatchState): string {
  if (state.sport === "softball") {
    const sportState = state.sportState as SoftballState | undefined;
    return sportState?.inningHalf === "bottom" ? "BOT" : "TOP";
  }
  if (state.sport === "cricket") {
    const cricket = state.sportState as CricketState | undefined;
    const n = cricket?.inningsNumber ?? 1;
    return `${ordinalInningsLabel(n)} INNINGS`;
  }
  return getTemplate(state.sport).periodLabel;
}
