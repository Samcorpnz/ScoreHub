import { parseChampionDataJson } from "../protocol/championDataParser";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";
// The relay's own stateUpdate validator — see relayContract.test.ts for why.
import { matchStateSchema } from "../../../relay/src/schemas";

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    playerId: 7,
    playerName: "J. Smith",
    playerFirstname: "J",
    playerSurname: "Smith",
    currentPosition: "GS",
    startingPositionCode: "GS",
    goals: 10,
    goalAttempts: 12,
    goalMisses: 2,
    shootingPercentage: 83.3,
    goalAssists: 0,
    feeds: 5,
    centrePassReceives: 3,
    secondPhaseReceives: 1,
    penalties: 1,
    obstructionPenalties: 0,
    contactPenalties: 1,
    intercepts: 0,
    deflections: 1,
    pickups: 2,
    rebounds: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    turnovers: 1,
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

function makeTeam(overrides: Record<string, unknown> = {}) {
  return {
    squadId: 1,
    squadName: "Warriors",
    goals: 45,
    goalAttempts: 50,
    shootingPercentage: 90,
    goalsFromCentrePass: 20,
    goalsFromTurnovers: 5,
    goalsFromGains: 3,
    centrePassReceives: 25,
    secondPhaseReceives: 4,
    feeds: 30,
    penalties: 8,
    turnovers: 6,
    gain: 4,
    rebounds: 7,
    offensiveRebounds: 3,
    defensiveRebounds: 4,
    intercepts: 2,
    deflections: 5,
    pickups: 6,
    blocks: 1,
    timeInPossession: 600,
    player: [makePlayer()],
    ...overrides,
  };
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    sport: {
      netballMatchStats: {
        matchId: 12345,
        matchStatus: "inProgress",
        period: 2,
        periodCompleted: 1,
        roundNumber: 3,
        homeSquadId: 1,
        awaySquadId: 2,
        homeSquadName: "Warriors",
        awaySquadName: "Knights",
        periodSeconds: 720,
        team: [makeTeam(), makeTeam({ squadId: 2, squadName: "Knights", goals: 38 })],
        ...overrides,
      },
      venueName: "Arena",
      competitionName: "Premier League",
    },
  };
}

describe("parseChampionDataJson", () => {
  it("parses a well-formed payload into MatchState", () => {
    const next = parseChampionDataJson(makePayload());
    expect(next.sport).toBe("netball");
    expect(next.home.name).toBe("Warriors");
    expect(next.home.score).toBe(45);
    expect(next.visitor.name).toBe("Knights");
    expect(next.visitor.score).toBe(38);
    expect(next.isRunning).toBe(true);
    expect(next.netballStats?.matchId).toBe(12345);
  });

  it("includes the competition name in matchName when present", () => {
    const next = parseChampionDataJson(makePayload());
    expect(next.matchName).toBe("Warriors v Knights — Premier League");
  });

  it("omits the competition name when absent", () => {
    const payload = makePayload();
    delete (payload.sport as Record<string, unknown>).competitionName;
    const next = parseChampionDataJson(payload);
    expect(next.matchName).toBe("Warriors v Knights");
  });

  it("increments sequenceId relative to the existing state", () => {
    const existing: MatchState = { ...DEFAULT_MATCH_STATE, sequenceId: 41 };
    const next = parseChampionDataJson(makePayload(), existing);
    expect(next.sequenceId).toBe(42);
  });

  it("marks the match as not running when matchStatus isn't inProgress", () => {
    const next = parseChampionDataJson(makePayload({ matchStatus: "completed" }));
    expect(next.isRunning).toBe(false);
  });

  it("filters out an interchange player who never took the court", () => {
    const payload = makePayload();
    const homeTeam = payload.sport.netballMatchStats.team[0];
    homeTeam.player = [
      makePlayer({ startingPositionCode: "I", currentPosition: "I" }),
      makePlayer({ playerId: 9, startingPositionCode: "GA", currentPosition: "GA" }),
    ];
    const next = parseChampionDataJson(payload);
    expect(next.home.players).toHaveLength(1);
    expect(next.home.players[0].number).toBe(9);
  });

  it("throws a descriptive error when sport.netballMatchStats is missing", () => {
    expect(() => parseChampionDataJson({ sport: {} })).toThrow(/missing netballMatchStats/);
  });

  it("throws a descriptive error for a completely unrecognised payload", () => {
    expect(() => parseChampionDataJson({ unrelated: true })).toThrow(/Unrecognised ChampionData payload/);
  });

  it("throws when team is missing a required field (schema mismatch, SA-6)", () => {
    const payload = makePayload();
    delete (payload.sport.netballMatchStats.team[0] as Record<string, unknown>).squadName;
    expect(() => parseChampionDataJson(payload)).toThrow(/Unrecognised ChampionData payload/);
  });

  it("throws when a numeric field is sent as a string (schema mismatch, SA-6)", () => {
    const payload = makePayload();
    (payload.sport.netballMatchStats.team[0] as Record<string, unknown>).goals = "forty-five";
    expect(() => parseChampionDataJson(payload)).toThrow();
  });

  it("throws when only one team is present instead of exactly two", () => {
    const payload = makePayload();
    (payload.sport.netballMatchStats as Record<string, unknown>).team = [makeTeam()];
    expect(() => parseChampionDataJson(payload)).toThrow();
  });

  it("does not throw on null/undefined input — surfaces as the generic unrecognised-payload error", () => {
    expect(() => parseChampionDataJson(null)).toThrow(/Unrecognised ChampionData payload/);
    expect(() => parseChampionDataJson(undefined)).toThrow(/Unrecognised ChampionData payload/);
  });
});

describe("parseChampionDataJson -> relay stateUpdate contract", () => {
  it("produces a state the relay's schema accepts, after a JSON round trip over the socket", () => {
    const state = parseChampionDataJson(makePayload());
    const result = matchStateSchema.safeParse(JSON.parse(JSON.stringify(state)));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it("stays valid when the feed reports a completed match", () => {
    const state = parseChampionDataJson(makePayload({ matchStatus: "complete", period: 4 }));
    expect(state.isRunning).toBe(false);
    const result = matchStateSchema.safeParse(JSON.parse(JSON.stringify(state)));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});
