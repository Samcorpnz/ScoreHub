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

export type SportType =
  | "netball"
  | "basketball"
  | "rugby_union"
  | "rugby_league"
  | "volleyball"
  | "football"
  | "handball"
  | "hockey"
  | "waterpolo"
  | "tennis"
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

export interface GraphicsStatBag {
  team: {
    home: Record<string, number | string>;
    visitor: Record<string, number | string>;
  };
  players: Array<{
    id: string;
    name: string;
    team: "home" | "visitor";
    stats: Record<string, number | string>;
  }>;
}

// Graphics-only stats feed (Graphics Operator add-on). Deliberately loose
// (flattened key/value bags, not per-sport typed fields) — see
// bridge/src/graphics/feedTransform.ts for why. Must never gate or block
// score-critical state above; a missing/stale graphicsFeed only affects the
// separate graphics scene output, not the scoreboard.
export interface GraphicsFeed {
  provider: string;
  sport: string;
  version: number;
  capturedAt: string;
  stats: GraphicsStatBag;
}

export interface MatchState {
  sequenceId: number;
  clockSeconds: number;
  countDown: boolean;
  period: string;
  // Required by the relay's stateUpdate schema (relay/src/schemas.ts) — a
  // state without it is rejected wholesale. Bridges never set it themselves.
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
  graphicsFeed?: GraphicsFeed;
  displayTheme: DisplayTheme;
}

export const DEFAULT_MATCH_STATE: MatchState = {
  sequenceId: 0,
  clockSeconds: 0,
  countDown: false,
  period: "1",
  periodBreak: false,
  matchName: "",
  isRunning: false,
  possession: "none",
  hornActive: false,
  sport: "netball",
  inputSource: "none",
  home:    { name: "Home",    score: 0, faults: 0, timeouts: 0, players: [], color: "#F59E0B", logoUrl: "" },
  visitor: { name: "Visitor", score: 0, faults: 0, timeouts: 0, players: [], color: "#818CF8", logoUrl: "" },
  displayTheme: { ...DEFAULT_DISPLAY_THEME },
};
