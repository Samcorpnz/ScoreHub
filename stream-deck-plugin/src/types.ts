export interface TeamState {
  name: string;
  score: number;
  color: string;
}

export interface MatchState {
  isRunning: boolean;
  clockSeconds: number;
  period: string;
  home: TeamState;
  visitor: TeamState;
}

export interface GlobalSettings {
  relayUrl: string;
  token: string;
  orgId?: string;
  // The match chosen in the property inspector's picker. Ignored when the
  // token itself is pinned to a match (pinnedMatchId).
  matchId?: string | null;
  pinnedMatchId?: string | null;
  connected?: boolean;
}

export interface ScoreSettings {
  team?: "home" | "visitor";
  delta?: number;
}

export interface PeriodSettings {
  direction?: "next" | "prev";
}
