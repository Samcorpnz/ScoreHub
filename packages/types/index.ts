export interface TeamPlayer {
  number: number;
  name: string;
  onCourt: boolean;
  faults: number;
  points: number;
}

export interface TeamState {
  name: string;
  score: number;
  faults: number;
  timeouts: number;
  players: TeamPlayer[];
  color: string;
  logoUrl: string;
}

export type Possession = "home" | "visitor" | "both" | "none";

// Delta-based score mutation events — the relay applies these against its
// own authoritative current state rather than trusting a client-computed
// absolute value, so rapid-fire clicks/keypresses can't coalesce into fewer
// net increments than were actually performed.
export interface ScoreAdjustEvent {
  side: "home" | "visitor";
  delta: number;
}

export interface IndoorCricketWicketEvent {
  side: "home" | "visitor";
}

// One entry in a match's event log — what happened and when, as opposed to
// MatchState's "what is true right now". The relay derives these by diffing
// consecutive states (relay/src/matchEvents.ts), so every source of change
// (control panel, bridge, Stream Deck, undo) is logged the same way.
export type MatchEventType =
  | "score"
  | "period"
  | "clock_start"
  | "clock_stop"
  | "break_start"
  | "break_end"
  | "reset"
  // Always the last entry of a log that hit its size limit: what follows it
  // in the match was not logged.
  | "log_full";

export interface MatchEvent {
  // Position in the match's log. Assigned when the event is stored, so it is
  // what a consumer passes back as `since` to fetch only newer events.
  seq?: number;
  type: MatchEventType;
  at: string; // ISO 8601, relay wall-clock time
  // Match clock, period and both scores immediately after the event.
  clockSeconds: number;
  period: string;
  home: number;
  visitor: number;
  // score events only
  side?: "home" | "visitor";
  delta?: number;
  // period events only: the period just left, and the scores it finished on
  // (sports that zero the score between sets would otherwise lose them).
  fromPeriod?: string;
  previous?: { home: number; visitor: number };
  // Set when the event came from an Undo, so a consumer can treat it as a
  // correction to what it already received rather than new play.
  correction?: boolean;
}

export type SportType =
  | "netball" | "basketball"
  | "rugby_union" | "rugby_league"
  | "volleyball" | "football"
  | "handball" | "hockey" | "waterpolo" | "tennis"
  | "touch_rugby" | "futsal" | "pickleball" | "badminton"
  | "table_tennis" | "floorball" | "squash" | "lawn_bowls"
  | "indoor_cricket" | "softball" | "cricket"
  | "custom";

export interface NetballPlayerStats {
  playerId: number;
  playerName: string;
  playerFirstname: string;
  playerSurname: string;
  currentPosition: string;
  startingPositionCode: string;
  goals: number;
  goalAttempts: number;
  goalMisses: number;
  shootingPercentage: number;
  goalAssists: number;
  feeds: number;
  centrePassReceives: number;
  secondPhaseReceives: number;
  penalties: number;
  obstructionPenalties: number;
  contactPenalties: number;
  intercepts: number;
  deflections: number;
  pickups: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  turnovers: number;
  gain: number;
  blocked: number;
  blocks: number;
  badPasses: number;
  badHands: number;
  offsides: number;
  breaks: number;
}

export interface NetballTeamStats {
  squadId: number;
  squadName: string;
  goals: number;
  goalAttempts: number;
  shootingPercentage: number;
  goalsFromCentrePass: number;
  goalsFromTurnovers: number;
  goalsFromGains: number;
  centrePassReceives: number;
  secondPhaseReceives: number;
  feeds: number;
  penalties: number;
  turnovers: number;
  gain: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  intercepts: number;
  deflections: number;
  pickups: number;
  blocks: number;
  timeInPossession: number;
  players: NetballPlayerStats[];
}

export interface NetballMatchStats {
  matchId: number;
  matchStatus: string;
  period: number;
  periodCompleted: number;
  roundNumber: number;
  home: NetballTeamStats;
  visitor: NetballTeamStats;
}

// Graphics Operator add-on — deliberately loose/generic (flattened key/value
// stat bags, not per-sport typed fields). See bridge/src/graphics/feedTransform.ts
// for the rationale: provider payload shape changes per sport/provider and
// must be adjustable via a config edit, not a shared-type change + redeploy.
export interface GraphicsPlayerStats {
  id: string;
  name: string;
  team: "home" | "visitor";
  stats: Record<string, number | string>;
}

export interface GraphicsStatBag {
  team: {
    home: Record<string, number | string>;
    visitor: Record<string, number | string>;
  };
  players: GraphicsPlayerStats[];
}

export interface GraphicsFeed {
  provider: string;
  sport: string;
  version: number;
  capturedAt: string;
  stats: GraphicsStatBag;
}

export interface DisplayTheme {
  primaryColor: string;
  backgroundColor: string;
  font: string;
  textScale: number;
  competitionLogoUrl: string;
  // Full-screen/basic/advanced displays only — the overlay, score bug and
  // graphics outputs stay transparent for OBS/vMix compositing. Optional
  // because matches saved before they existed don't carry them.
  backgroundImageUrl?: string;
  // Opacity of the score panels (0–1), so a background image shows through
  panelOpacity?: number;
  // Graphics add-on: per-output overrides on top of the fields above. The
  // relay drops changes to this from orgs without the add-on.
  outputs?: Partial<Record<DisplayOutputKey, OutputStyle>>;
}

export const DISPLAY_OUTPUT_KEYS = ["fullscreen", "basic", "advanced", "overlay", "scorebug"] as const;
export type DisplayOutputKey = typeof DISPLAY_OUTPUT_KEYS[number];

// Unset fields fall back to the match-wide theme. The four sizes are
// multipliers stacked on top of DisplayTheme.textScale.
export interface OutputStyle {
  font?: string;
  // Fullscreen, basic and advanced only — the overlay and score bug stay
  // transparent (or chroma-keyed via ?key=).
  backgroundColor?: string;
  backgroundImageUrl?: string;
  scoreScale?: number;
  clockScale?: number;
  nameScale?: number;
  periodScale?: number;
}

export const DEFAULT_DISPLAY_THEME: DisplayTheme = {
  primaryColor: "#00C8FF",
  backgroundColor: "#07090F",
  font: "",
  textScale: 1,
  competitionLogoUrl: "",
  backgroundImageUrl: "",
  panelOpacity: 1,
};

export type { IndoorCricketState } from "./sports/indoor_cricket";
export type { SoftballState, SoftballFormat } from "./sports/softball";
export type {
  CricketState,
  CricketFormat,
  CricketInningsState,
  CricketBatter,
  CricketBowler,
  WicketType,
  CricketBallEvent,
  CricketSession,
} from "./sports/cricket";

import type { IndoorCricketState } from "./sports/indoor_cricket";
import type { SoftballState } from "./sports/softball";
import type { CricketState } from "./sports/cricket";

export type SportState = IndoorCricketState | SoftballState | CricketState;

// A penalty shoot-out's tally, kept apart from the match score. One entry
// per attempt in the order taken: true = scored, false = missed or saved.
export interface ShootoutState {
  home: boolean[];
  visitor: boolean[];
}

export interface MatchState {
  sequenceId: number;
  clockSeconds: number;
  // Relay-internal clock precision bookkeeping, only used when the relay's
  // own 1Hz tick loop is driving the clock (i.e. no bridge connected).
  // Absent/undefined means "no anchor available" — legacy/bridge behavior.
  clockAnchorMs?: number; // epoch ms of the last instant clockSeconds was exactly correct
  clockCarryMs?: number; // signed leftover ms (< 1000 magnitude), never discarded, only banked
  countDown: boolean;
  period: string;
  periodBreak: boolean;
  matchName: string;
  isRunning: boolean;
  possession: Possession;
  hornActive: boolean;
  sport: SportType;
  inputSource: string;
  home: TeamState;
  visitor: TeamState;
  netballStats?: NetballMatchStats;
  sportState?: SportState;
  sportConfig?: Record<string, unknown>;
  // Present while a shoot-out is being (or has been) taken; null once cleared
  shootout?: ShootoutState | null;
  graphicsFeed?: GraphicsFeed;
  displayTheme: DisplayTheme;
}
