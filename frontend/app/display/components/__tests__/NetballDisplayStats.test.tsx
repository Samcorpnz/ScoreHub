import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NetballDisplayStats } from "../NetballDisplayStats";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState, NetballPlayerStats, NetballTeamStats } from "@scorehub/types";

function makePlayer(overrides: Partial<NetballPlayerStats> = {}): NetballPlayerStats {
  return {
    playerId: 1,
    playerName: "Jamie Lee",
    playerFirstname: "Jamie",
    playerSurname: "Lee",
    currentPosition: "GS",
    startingPositionCode: "GS",
    goals: 0,
    goalAttempts: 0,
    goalMisses: 0,
    shootingPercentage: 0,
    goalAssists: 0,
    feeds: 0,
    centrePassReceives: 0,
    secondPhaseReceives: 0,
    penalties: 0,
    obstructionPenalties: 0,
    contactPenalties: 0,
    intercepts: 0,
    deflections: 0,
    pickups: 0,
    rebounds: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    turnovers: 0,
    gain: 0,
    blocked: 0,
    blocks: 0,
    badPasses: 0,
    badHands: 0,
    offsides: 0,
    breaks: 0,
    ...overrides,
  };
}

function makeTeamStats(overrides: Partial<NetballTeamStats> = {}): NetballTeamStats {
  return {
    squadId: 1,
    squadName: "Home",
    goals: 0,
    goalAttempts: 0,
    shootingPercentage: 0,
    goalsFromCentrePass: 0,
    goalsFromTurnovers: 0,
    goalsFromGains: 0,
    centrePassReceives: 0,
    secondPhaseReceives: 0,
    feeds: 0,
    penalties: 0,
    turnovers: 0,
    gain: 0,
    rebounds: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    intercepts: 0,
    deflections: 0,
    pickups: 0,
    blocks: 0,
    timeInPossession: 0,
    players: [],
    ...overrides,
  };
}

function makeState(netballStats: MatchState["netballStats"]): MatchState {
  return { ...DEFAULT_MATCH_STATE, netballStats } as unknown as MatchState;
}

afterEach(() => cleanup());

describe("NetballDisplayStats", () => {
  it("renders nothing when the match has no netball stats", () => {
    const { container } = render(<NetballDisplayStats state={DEFAULT_MATCH_STATE as MatchState} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a compact summary line for both teams with a shooting percentage", () => {
    const state = makeState({
      matchId: 1,
      matchStatus: "in progress",
      period: 1,
      periodCompleted: 0,
      roundNumber: 1,
      home: makeTeamStats({ goalAttempts: 10, shootingPercentage: 80, gain: 3, turnovers: 2 }),
      visitor: makeTeamStats({ goalAttempts: 0, shootingPercentage: 0, gain: 1, turnovers: 4 }),
    });
    const { container } = render(<NetballDisplayStats state={state} variant="compact" />);
    expect(container.textContent).toContain("80.0%");
    // Visitor team has no goal attempts, so shooting shows the placeholder dash.
    expect(container.textContent).toContain("–");
  });

  it("renders the full player stats table filtered to on-court players by default", () => {
    const onCourt = makePlayer({ playerId: 1, currentPosition: "GS", goals: 5, goalAttempts: 6, shootingPercentage: 83, feeds: 2, goalAssists: 1, intercepts: 1, penalties: 1 });
    const bench = makePlayer({ playerId: 2, playerName: "Bench Player", playerSurname: "Bench", currentPosition: "I" });
    const state = makeState({
      matchId: 1,
      matchStatus: "in progress",
      period: 1,
      periodCompleted: 0,
      roundNumber: 1,
      home: makeTeamStats({ players: [onCourt, bench], goalAttempts: 6, shootingPercentage: 83, centrePassReceives: 4, goalsFromCentrePass: 2 }),
      visitor: makeTeamStats({ players: [] }),
    });
    render(<NetballDisplayStats state={state} />);

    expect(screen.getByText("Player Stats")).toBeInTheDocument();
    expect(screen.getByText("On Court (7)")).toBeInTheDocument();
    expect(screen.getByText(/Lee, J\./)).toBeInTheDocument();
    expect(screen.queryByText("Bench Player")).not.toBeInTheDocument();
    // Home team summary bar renders shooting % and CP efficiency.
    expect(screen.getByText("83.0%")).toBeInTheDocument();
    expect(screen.getByText("2/4")).toBeInTheDocument();
    // Visitor team is empty -> "No players" message.
    expect(screen.getByText("No players")).toBeInTheDocument();
  });

  it("toggles to show all players (including bench) when the filter button is clicked", () => {
    const onCourt = makePlayer({ playerId: 1, currentPosition: "GS" });
    const bench = makePlayer({ playerId: 2, playerName: "Bench Player", playerFirstname: "Bench", playerSurname: "Player", currentPosition: "I" });
    const state = makeState({
      matchId: 1,
      matchStatus: "in progress",
      period: 1,
      periodCompleted: 0,
      roundNumber: 1,
      home: makeTeamStats({ players: [onCourt, bench] }),
      visitor: makeTeamStats({ players: [] }),
    });
    render(<NetballDisplayStats state={state} />);

    fireEvent.click(screen.getByText("On Court (7)"));

    expect(screen.getByText("All Players")).toBeInTheDocument();
    expect(screen.getByText(/Player, B\./)).toBeInTheDocument();
  });

  it("renders a player row with a blank position and dashes when the player has no recorded stats", () => {
    const emptyPlayer = makePlayer({ playerId: 3, currentPosition: "", playerFirstname: "", playerSurname: "NoStats" });
    const state = makeState({
      matchId: 1,
      matchStatus: "in progress",
      period: 1,
      periodCompleted: 0,
      roundNumber: 1,
      home: makeTeamStats({ players: [emptyPlayer] }),
      visitor: makeTeamStats({ players: [] }),
    });
    render(<NetballDisplayStats state={state} />);

    // A blank currentPosition is filtered out of "on court" and falls back to the "–" glyph in the row.
    fireEvent.click(screen.getByText("On Court (7)"));
    expect(screen.getByText("NoStats")).toBeInTheDocument();
  });
});
