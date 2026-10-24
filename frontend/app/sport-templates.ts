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
  // Set on sports that can go to extra time: any period after the last
  // regulation one is then an extra-time period. `seconds` is its default
  // length where that differs from a regulation period (the operator can set
  // their own per match — sportConfig.extraTimeSeconds); `label` replaces "ET".
  extraTime?: { seconds?: number; label?: string };
  // A late-period spell where some shots are worth more: for the last
  // `lastSeconds` of each regulation period the score buttons become
  // `scoreIncrements`. Never applies in extra time.
  powerPlay?: { label: string; lastSeconds: number; scoreIncrements: number[] };
  // Set on sports whose tied matches can be settled by a shoot-out, scored
  // apart from the match score (MatchState.shootout). `short` is for
  // one-line outputs such as the scorebug.
  shootout?: { label: string; short: string };
  // Other forms of the sport, chosen with the "format" match option
  // (sportConfig.format). Each lists only the fields that differ.
  formats?: Record<string, Partial<SportTemplate>>;
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
    // World Netball Rules 2.5–2.6: two halves of up to 7 minutes each
    extraTime: { seconds: 420 },
    matchConfig: [
      {
        key: "format",
        label: "Format",
        type: "select",
        options: [
          { value: "standard", label: "Standard", description: "7-a-side — 4 quarters of 15:00" },
          { value: "fast5", label: "Fast5", description: "5-a-side — 4 quarters of 6:00, 1/2/3-point shots, Power Play" },
        ],
        defaultValue: "standard",
      },
    ],
    formats: {
      // World Netball Rules of Fast5 (2024): F2 time, F9 scoring
      fast5: {
        label: "Fast5 Netball",
        structure: "4 quarters × 6:00",
        clockSeconds: 360,
        scoreIncrements: [1, 2, 3],
        scoreLabels: ["INNER", "OUTER", "SUPER"],
        powerPlay: { label: "POWER PLAY", lastSeconds: 120, scoreIncrements: [1, 4, 6] },
        extraTime: { seconds: 60 },
      },
    },
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
    // FIBA: overtime periods are 5 minutes, not 10
    extraTime: { seconds: 300, label: "OT" },
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
    // A conversion is its own +2 too, for a try entered before the kick is taken
    scoreIncrements: [2, 3, 5, 7],
    scoreLabels: ["CONV", "PEN/DG", "TRY", "CONV TRY"],
    // Knockout rugby plays 2 × 10:00; the clock counts up, so there's no length to set
    extraTime: {},
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
    // +1 is a field goal (drop goal)
    scoreIncrements: [1, 2, 4, 6],
    scoreLabels: ["FG", "CONV/PEN", "TRY", "CONV TRY"],
    // Golden point, 2 × 5:00 — first score wins. Counts up, so no length to set
    extraTime: { label: "GP" },
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
    // 2 × 15:00; the clock counts up, so there's no length to set
    extraTime: {},
    shootout: { label: "PENALTIES", short: "PENS" },
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
    // IHF: 2 × 5:00, repeated once if still level
    extraTime: { seconds: 300 },
    shootout: { label: "PENALTIES", short: "PENS" },
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
    // FIH now goes straight to a shoot-out; 2 × 7:30 was its last extra-time format
    extraTime: { seconds: 450 },
    shootout: { label: "SHOOT-OUT", short: "S/O" },
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
    // World Aquatics now goes straight to a shoot-out; 2 × 3:00 was its last extra-time format
    extraTime: { seconds: 180 },
    shootout: { label: "PENALTIES", short: "PENS" },
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
    // FIT drop-off: a player leaves each side every 2:00
    extraTime: { seconds: 120, label: "DROP-OFF" },
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
    // FIFA: 2 × 5:00 at most
    extraTime: { seconds: 300 },
    shootout: { label: "PENALTIES", short: "PENS" },
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
    // IFF: one 10:00 period, first goal wins
    extraTime: { seconds: 600 },
    shootout: { label: "PENALTIES", short: "PENS" },
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

type MatchFormatState = Pick<MatchState, "sport" | "sportConfig">;
type MatchPeriodState = Pick<MatchState, "sport" | "sportConfig" | "period">;

// The template for this match: the sport's, with the chosen format's
// differences applied (e.g. Fast5's 6:00 quarters and 1/2/3-point buttons).
// Use this, not getTemplate, wherever a match's own state is to hand.
// The match's sportConfig.format, when it has one. Stored as free-form JSON,
// so anything that isn't a string counts as unset.
export function matchFormat(state: MatchFormatState): string | undefined {
  const format = state.sportConfig?.format;
  return typeof format === "string" ? format : undefined;
}

export function getMatchTemplate(state: MatchFormatState): SportTemplate {
  const template = getTemplate(state.sport);
  const format = template.formats?.[matchFormat(state) ?? ""];
  return format ? { ...template, ...format } : template;
}

// Which extra-time period the match is in (1, 2, …), or 0 during regulation
// and for sports that don't have extra time.
export function getExtraTimePeriod(state: MatchPeriodState): number {
  const template = getMatchTemplate(state);
  const n = Number.parseInt(state.period, 10);
  if (!template.extraTime || Number.isNaN(n) || n <= template.periods) return 0;
  return n - template.periods;
}

// Length of an extra-time period: what the operator set for this match, else
// the sport's default, else the same as a regulation period.
// Mirrored by periodClock in relay/src/periodClock.ts for Stream Deck/the Control API.
export function getExtraTimeSeconds(state: MatchFormatState): number {
  const template = getMatchTemplate(state);
  const chosen = state.sportConfig?.extraTimeSeconds;
  if (typeof chosen === "number" && Number.isInteger(chosen) && chosen >= 0) return chosen;
  return template.extraTime?.seconds ?? template.clockSeconds;
}

// The clock a given period starts on.
export function getPeriodClockSeconds(state: MatchFormatState, period: number): number {
  const template = getMatchTemplate(state);
  return template.extraTime && period > template.periods ? getExtraTimeSeconds(state) : template.clockSeconds;
}

// The power play in force right now, if any. Pass the interpolated clock where
// one is to hand, so the score buttons change on the dot rather than on the
// relay's next whole-second tick.
export function getActivePowerPlay(
  state: MatchPeriodState & Pick<MatchState, "countDown" | "clockSeconds">,
  clockSeconds: number = state.clockSeconds,
): SportTemplate["powerPlay"] {
  const { powerPlay, periods } = getMatchTemplate(state);
  if (!powerPlay || !state.countDown) return undefined;
  const n = Number.parseInt(state.period, 10);
  if (Number.isNaN(n) || n < 1 || n > periods) return undefined;
  return clockSeconds <= powerPlay.lastSeconds ? powerPlay : undefined;
}

// The values the score buttons add right now.
export function getScoreIncrements(
  state: MatchPeriodState & Pick<MatchState, "countDown" | "clockSeconds">,
  clockSeconds?: number,
): number[] {
  return getActivePowerPlay(state, clockSeconds)?.scoreIncrements ?? getMatchTemplate(state).scoreIncrements;
}

// Best-of sports (squash, tennis) let the operator choose the match length at
// setup (sportConfig.format: "bo3" | "bo5"). Returns how many games/sets the
// match can run to, or undefined when there's no cap: every other sport
// (timed sports can go to extra time), and matches with no format recorded
// (fixtures uploaded in bulk, or created before the option existed).
// Mirrored by bestOfLength in relay/src/server.ts for Stream Deck/the Control API.
export function getMatchLength(state: Pick<MatchState, "sport" | "sportConfig">): number | undefined {
  const formatField = getTemplate(state.sport).matchConfig?.find(f => f.key === "format");
  const format = matchFormat(state) ?? "";
  if (!formatField?.options.some(o => o.value === format)) return undefined;
  const match = /^bo(\d+)$/.exec(format);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

// The template's structure line with the chosen match length filled in,
// e.g. "Best of 3 games to 11" rather than the template's default.
export function getStructureLabel(state: Pick<MatchState, "sport" | "sportConfig">): string {
  const template = getMatchTemplate(state);
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
  const template = getMatchTemplate(state);
  return getExtraTimePeriod(state) > 0 ? template.extraTime?.label ?? "ET" : template.periodLabel;
}

// The number shown beside getPeriodLabel: extra-time periods count from 1
// again ("ET 1"), whatever state.period has reached.
export function getPeriodNumber(state: MatchPeriodState): string {
  const extraTimePeriod = getExtraTimePeriod(state);
  return extraTimePeriod > 0 ? String(extraTimePeriod) : state.period;
}

// The shoot-out under way (or finished) in this match, with each side's goals.
export function getShootout(state: Pick<MatchState, "sport" | "sportConfig" | "shootout">) {
  const config = getMatchTemplate(state).shootout;
  if (!config || !state.shootout) return undefined;
  const { home, visitor } = state.shootout;
  return {
    ...config, home, visitor,
    homeGoals: home.filter(Boolean).length,
    visitorGoals: visitor.filter(Boolean).length,
  };
}

// What's shown in place of the period while state.periodBreak is set. Ending
// the last regulation period is full time, whether or not extra time follows.
// Regulation's over: END on the last half/quarter puts the match in a break
// one period past the template's count. Every sport calls that full time —
// from there it either finishes, or (where the sport has it) goes to extra time.
export function isFullTime(state: Pick<MatchState, "sport" | "sportConfig" | "period" | "periodBreak">): boolean {
  return state.periodBreak && Number.parseInt(state.period, 10) === getMatchTemplate(state).periods + 1;
}

export function getBreakLabel(state: MatchState): string {
  if (isFullTime(state)) return "FULL TIME";
  const label = getPeriodLabel(state);
  // The break before the third of four quarters is half time too
  const { periods } = getMatchTemplate(state);
  const midway = label === "QTR" && periods % 2 === 0 && Number.parseInt(state.period, 10) === periods / 2 + 1;
  return label === "HALF" || midway ? "HALF TIME" : `${label} BREAK`;
}

// The match's stage on one line, for outputs with no room for more (stream
// overlay, scorebug): a shoot-out's tally, the break, a power play, or the period.
export function getPeriodText(state: MatchState): string {
  const shootout = getShootout(state);
  if (shootout) return `${shootout.short} ${shootout.homeGoals}–${shootout.visitorGoals}`;
  if (state.periodBreak) return getBreakLabel(state);
  const powerPlay = getActivePowerPlay(state);
  if (powerPlay) return powerPlay.label;
  return state.period === "E" ? "EXTRA" : `${getPeriodLabel(state)} ${getPeriodNumber(state)}`;
}
