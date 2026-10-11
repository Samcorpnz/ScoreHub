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
}

export const DEFAULT_DISPLAY_THEME: DisplayTheme = {
  primaryColor: "#00C8FF",
  backgroundColor: "#07090F",
  font: "",
  textScale: 1,
  competitionLogoUrl: "",
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
