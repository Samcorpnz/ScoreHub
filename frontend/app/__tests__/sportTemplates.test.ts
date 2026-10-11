import { describe, it, expect } from "vitest";
import {
  SPORT_TEMPLATES, getTemplate, getMatchLength, getStructureLabel, getMatchTemplate, getExtraTimePeriod,
  getExtraTimeSeconds, getPeriodClockSeconds, getActivePowerPlay, getScoreIncrements, getPeriodLabel,
  getPeriodNumber, getBreakLabel, getShootout, getPeriodText,
} from "../sport-templates";
import { DEFAULT_MATCH_STATE } from "../types";
import type { MatchState, SportType } from "../types";

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

// Every value in the SportType union.
const DROP_IN_SPORT_TYPES: SportType[] = [
  "netball", "basketball", "rugby_union", "rugby_league",
  "volleyball", "football", "handball", "hockey", "waterpolo", "tennis",
  "touch_rugby", "futsal", "pickleball", "badminton",
  "table_tennis", "floorball", "squash", "lawn_bowls",
  "indoor_cricket", "softball", "cricket",
  "custom",
];

const RESET_SCORE_SPORTS: SportType[] = [
  "volleyball", "tennis", "pickleball", "badminton", "table_tennis", "squash",
];

describe("SPORT_TEMPLATES coverage", () => {
  it("every drop-in SportType has a matching template", () => {
    const keys = SPORT_TEMPLATES.map(t => t.sport);
    for (const sport of DROP_IN_SPORT_TYPES) {
      expect(keys).toContain(sport);
    }
  });

  it("no duplicate sport keys", () => {
    const keys = SPORT_TEMPLATES.map(t => t.sport);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("SportTemplate required fields", () => {
  it.each(SPORT_TEMPLATES)("$sport has scoreIncrements with at least one entry", (template) => {
    expect(Array.isArray(template.scoreIncrements)).toBe(true);
    expect(template.scoreIncrements.length).toBeGreaterThanOrEqual(1);
    for (const n of template.scoreIncrements) {
      expect(typeof n).toBe("number");
      expect(n).toBeGreaterThan(0);
    }
  });

  it.each(SPORT_TEMPLATES)("$sport has a non-empty label and periodLabel", (template) => {
    expect(template.label.length).toBeGreaterThan(0);
    expect(template.periodLabel.length).toBeGreaterThan(0);
  });

  it.each(SPORT_TEMPLATES)("$sport has periods >= 1", (template) => {
    expect(template.periods).toBeGreaterThanOrEqual(1);
  });

  it.each(SPORT_TEMPLATES)("$sport has clockSeconds >= 0", (template) => {
    expect(template.clockSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("resetScoreOnPeriod", () => {
  it.each(RESET_SCORE_SPORTS)("$s has resetScoreOnPeriod: true", (sport) => {
    const template = SPORT_TEMPLATES.find(t => t.sport === sport);
    expect(template?.resetScoreOnPeriod).toBe(true);
  });

  const NON_RESET_SPORTS: SportType[] = [
    "football", "touch_rugby", "futsal", "floorball", "lawn_bowls",
    "handball", "hockey", "waterpolo", "netball", "basketball",
    "rugby_union", "rugby_league",
  ];
  it.each(NON_RESET_SPORTS)("$s does NOT have resetScoreOnPeriod", (sport) => {
    const template = SPORT_TEMPLATES.find(t => t.sport === sport);
    expect(template?.resetScoreOnPeriod).toBeFalsy();
  });
});

describe("squash matchConfig", () => {
  const squash = SPORT_TEMPLATES.find(t => t.sport === "squash");

  it("squash template has matchConfig", () => {
    expect(squash?.matchConfig).toBeDefined();
    expect(squash?.matchConfig?.length).toBeGreaterThan(0);
  });

  it("squash matchConfig has a 'format' field", () => {
    const field = squash?.matchConfig?.find(f => f.key === "format");
    expect(field).toBeDefined();
    expect(field?.type).toBe("select");
    expect(field?.defaultValue).toBe("bo5");
  });

  it("squash format options include bo3 and bo5", () => {
    const field = squash?.matchConfig?.find(f => f.key === "format");
    const values = field?.options.map(o => o.value) ?? [];
    expect(values).toContain("bo3");
    expect(values).toContain("bo5");
  });
});

describe("indoor_cricket matchConfig", () => {
  const indoorCricket = SPORT_TEMPLATES.find(t => t.sport === "indoor_cricket");

  it("indoor_cricket template has matchConfig", () => {
    expect(indoorCricket?.matchConfig).toBeDefined();
    expect(indoorCricket?.matchConfig?.length).toBeGreaterThan(0);
  });

  it("indoor_cricket matchConfig has a 'wicketPenalty' field defaulting to -5", () => {
    const field = indoorCricket?.matchConfig?.find(f => f.key === "wicketPenalty");
    expect(field).toBeDefined();
    expect(field?.type).toBe("select");
    expect(field?.defaultValue).toBe("5");
  });

  it("wicketPenalty options include 2 and 5", () => {
    const field = indoorCricket?.matchConfig?.find(f => f.key === "wicketPenalty");
    const values = field?.options.map(o => o.value) ?? [];
    expect(values).toContain("2");
    expect(values).toContain("5");
  });
});

describe("softball matchConfig", () => {
  const softball = SPORT_TEMPLATES.find(t => t.sport === "softball");

  it("softball template has matchConfig and a controlPanel override", () => {
    expect(softball?.matchConfig).toBeDefined();
    expect(softball?.matchConfig?.length).toBeGreaterThan(0);
    expect(softball?.controlPanel).toBeDefined();
  });

  it("softball matchConfig has a 'format' field defaulting to fastpitch", () => {
    const field = softball?.matchConfig?.find(f => f.key === "format");
    expect(field).toBeDefined();
    expect(field?.type).toBe("select");
    expect(field?.defaultValue).toBe("fastpitch");
  });

  it("format options include fastpitch and slowpitch", () => {
    const field = softball?.matchConfig?.find(f => f.key === "format");
    const values = field?.options.map(o => o.value) ?? [];
    expect(values).toContain("fastpitch");
    expect(values).toContain("slowpitch");
  });
});

describe("cricket matchConfig", () => {
  const cricket = SPORT_TEMPLATES.find(t => t.sport === "cricket");

  it("cricket template has matchConfig and a controlPanel override", () => {
    expect(cricket?.matchConfig).toBeDefined();
    expect(cricket?.matchConfig?.length).toBeGreaterThan(0);
    expect(cricket?.controlPanel).toBeDefined();
  });

  it("cricket matchConfig has a 'format' field defaulting to t20", () => {
    const field = cricket?.matchConfig?.find(f => f.key === "format");
    expect(field).toBeDefined();
    expect(field?.type).toBe("select");
    expect(field?.defaultValue).toBe("t20");
  });

  it("format options include t20, odi and test", () => {
    const field = cricket?.matchConfig?.find(f => f.key === "format");
    const values = field?.options.map(o => o.value) ?? [];
    expect(values).toContain("t20");
    expect(values).toContain("odi");
    expect(values).toContain("test");
  });
});

describe("lawn_bowls scoreIncrements", () => {
  it("lawn_bowls has increments 1, 2, 3, 4", () => {
    const template = SPORT_TEMPLATES.find(t => t.sport === "lawn_bowls");
    expect(template?.scoreIncrements).toEqual([1, 2, 3, 4]);
  });
});

describe("displayStats overrides", () => {
  const SPORTS_WITH_DISPLAY_STATS: SportType[] = ["cricket", "netball", "softball", "indoor_cricket"];

  it.each(SPORTS_WITH_DISPLAY_STATS)("%s template has a displayStats override", (sport) => {
    const template = SPORT_TEMPLATES.find(t => t.sport === sport);
    expect(template?.displayStats).toBeDefined();
  });

  const SPORTS_WITHOUT_DISPLAY_STATS: SportType[] = [
    "basketball", "rugby_union", "rugby_league", "volleyball", "football",
    "handball", "hockey", "waterpolo", "tennis", "touch_rugby", "futsal",
    "pickleball", "badminton", "table_tennis", "floorball", "squash",
    "lawn_bowls", "custom",
  ];

  it.each(SPORTS_WITHOUT_DISPLAY_STATS)("%s template has no displayStats override", (sport) => {
    const template = SPORT_TEMPLATES.find(t => t.sport === sport);
    expect(template?.displayStats).toBeUndefined();
  });
});

describe("getTemplate fallback", () => {
  it("returns the custom template for an unknown sport string", () => {
    const result = getTemplate("underwater_hockey" as SportType);
    expect(result.sport).toBe("custom");
  });

  it("returns the correct template for a known sport", () => {
    const result = getTemplate("badminton");
    expect(result.sport).toBe("badminton");
    expect(result.periods).toBe(3);
  });
});

describe("best-of match length (SA-118)", () => {
  it("offers a best-of-3 / best-of-5 choice for squash and tennis", () => {
    for (const sport of ["squash", "tennis"] as const) {
      const field = getTemplate(sport).matchConfig?.find(f => f.key === "format");
      expect(field?.options.map(o => o.value).sort()).toEqual(["bo3", "bo5"]);
    }
  });

  it("returns the chosen length", () => {
    expect(getMatchLength({ sport: "squash", sportConfig: { format: "bo3" } })).toBe(3);
    expect(getMatchLength({ sport: "squash", sportConfig: { format: "bo5" } })).toBe(5);
    expect(getMatchLength({ sport: "tennis", sportConfig: { format: "bo5" } })).toBe(5);
  });

  it("is uncapped when no format was recorded or the sport isn't best-of", () => {
    expect(getMatchLength({ sport: "squash" })).toBeUndefined();
    expect(getMatchLength({ sport: "netball", sportConfig: { format: "bo3" } })).toBeUndefined();
    // cricket's "format" is t20/odi/test, not a match length
    expect(getMatchLength({ sport: "cricket", sportConfig: { format: "t20" } })).toBeUndefined();
  });

  it("describes the structure with the chosen length", () => {
    expect(getStructureLabel({ sport: "squash", sportConfig: { format: "bo3" } })).toBe("Best of 3 games to 11");
    expect(getStructureLabel({ sport: "tennis", sportConfig: { format: "bo5" } })).toBe("Best of 5 sets");
    expect(getStructureLabel({ sport: "tennis" })).toBe("Best of 3 or 5 sets");
  });
});

describe("Fast5 netball format", () => {
  const fast5 = { sport: "netball", sportConfig: { format: "fast5" } } as const;

  it("is offered as a netball format, defaulting to the standard game", () => {
    const field = getTemplate("netball").matchConfig?.find(f => f.key === "format");
    expect(field?.options.map(o => o.value)).toEqual(["standard", "fast5"]);
    expect(field?.defaultValue).toBe("standard");
  });

  it("plays four 6:00 quarters with 1, 2 and 3-point shots", () => {
    const template = getMatchTemplate(fast5);
    expect(template).toMatchObject({ periods: 4, periodLabel: "QTR", clockSeconds: 360, scoreIncrements: [1, 2, 3] });
    expect(getStructureLabel(fast5)).toBe("4 quarters × 6:00");
  });

  it("leaves standard netball, and matches with no format recorded, as they were", () => {
    for (const state of [{ sport: "netball" }, { sport: "netball", sportConfig: { format: "standard" } }] as const) {
      expect(getMatchTemplate(state)).toMatchObject({ clockSeconds: 900, scoreIncrements: [1, 2] });
      expect(getMatchTemplate(state).powerPlay).toBeUndefined();
    }
  });

  it("ignores a format the sport doesn't define", () => {
    expect(getMatchTemplate({ sport: "basketball", sportConfig: { format: "fast5" } })).toBe(getTemplate("basketball"));
  });

  describe("Power Play", () => {
    const live = (overrides: Partial<MatchState>) =>
      makeState({ ...fast5, countDown: true, period: "1", clockSeconds: 360, ...overrides });

    it("doubles outer and super shots for the last two minutes of a quarter", () => {
      expect(getScoreIncrements(live({ clockSeconds: 121 }))).toEqual([1, 2, 3]);
      expect(getScoreIncrements(live({ clockSeconds: 120 }))).toEqual([1, 4, 6]);
      expect(getScoreIncrements(live({ clockSeconds: 0 }))).toEqual([1, 4, 6]);
      expect(getActivePowerPlay(live({ clockSeconds: 90 }))?.label).toBe("POWER PLAY");
    });

    it("applies in every quarter but not in extra time", () => {
      expect(getActivePowerPlay(live({ period: "4", clockSeconds: 60 }))).toBeDefined();
      expect(getActivePowerPlay(live({ period: "5", clockSeconds: 30 }))).toBeUndefined();
      expect(getActivePowerPlay(live({ period: "E", clockSeconds: 30 }))).toBeUndefined();
    });

    it("prefers a more precise clock when given one", () => {
      expect(getScoreIncrements(live({ clockSeconds: 120 }), 120.4)).toEqual([1, 2, 3]);
    });

    it("can't be told from a clock that counts up", () => {
      expect(getActivePowerPlay(live({ countDown: false, clockSeconds: 60 }))).toBeUndefined();
    });

    it("never applies to standard netball", () => {
      expect(getActivePowerPlay(makeState({ sport: "netball", countDown: true, clockSeconds: 30 }))).toBeUndefined();
    });
  });
});

describe("extra time", () => {
  it("defaults to 7:00 periods for netball, 1:00 for Fast5 and 5:00 for basketball", () => {
    expect(getExtraTimeSeconds({ sport: "netball" })).toBe(420);
    expect(getExtraTimeSeconds({ sport: "netball", sportConfig: { format: "fast5" } })).toBe(60);
    expect(getExtraTimeSeconds({ sport: "basketball" })).toBe(300);
  });

  it.each([
    ["handball", 300], ["futsal", 300], ["floorball", 600], ["hockey", 450], ["waterpolo", 180], ["touch_rugby", 120],
  ] as const)("gives %s its own extra-time length", (sport, seconds) => {
    expect(getExtraTimeSeconds({ sport })).toBe(seconds);
    expect(getPeriodClockSeconds({ sport }, getTemplate(sport).periods + 1)).toBe(seconds);
  });

  it("keeps count-up sports counting up from zero in extra time", () => {
    for (const sport of ["football", "rugby_union", "rugby_league"] as const) {
      expect(getPeriodClockSeconds({ sport }, 3)).toBe(0);
    }
  });

  it("uses the length the operator set for the match", () => {
    expect(getExtraTimeSeconds({ sport: "netball", sportConfig: { extraTimeSeconds: 300 } })).toBe(300);
    expect(getExtraTimeSeconds({ sport: "netball", sportConfig: { format: "fast5", extraTimeSeconds: 120 } })).toBe(120);
    // anything that isn't a whole number of seconds is ignored
    expect(getExtraTimeSeconds({ sport: "netball", sportConfig: { extraTimeSeconds: "300" } })).toBe(420);
    expect(getExtraTimeSeconds({ sport: "netball", sportConfig: { extraTimeSeconds: -5 } })).toBe(420);
  });

  it("puts the extra-time length on the clock only after the last regulation period", () => {
    expect(getPeriodClockSeconds({ sport: "netball" }, 4)).toBe(900);
    expect(getPeriodClockSeconds({ sport: "netball" }, 5)).toBe(420);
    expect(getPeriodClockSeconds({ sport: "netball" }, 6)).toBe(420);
    expect(getPeriodClockSeconds({ sport: "basketball" }, 5)).toBe(300);
    expect(getPeriodClockSeconds({ sport: "netball", sportConfig: { format: "fast5" } }, 5)).toBe(60);
  });

  it("counts extra-time periods from 1", () => {
    expect(getExtraTimePeriod({ sport: "netball", period: "4" })).toBe(0);
    expect(getExtraTimePeriod({ sport: "netball", period: "5" })).toBe(1);
    expect(getExtraTimePeriod({ sport: "netball", period: "6" })).toBe(2);
    expect(getExtraTimePeriod({ sport: "football", period: "3" })).toBe(1);
    expect(getExtraTimePeriod({ sport: "netball", period: "E" })).toBe(0);
  });

  it("doesn't apply to set and innings sports, or to custom matches of unknown length", () => {
    for (const sport of ["volleyball", "tennis", "lawn_bowls", "indoor_cricket", "custom"] as const) {
      expect(getExtraTimePeriod({ sport, period: "30" })).toBe(0);
      expect(getPeriodClockSeconds({ sport }, 30)).toBe(getTemplate(sport).clockSeconds);
    }
  });

  it("labels extra-time periods on displays", () => {
    const netball = makeState({ sport: "netball", period: "6" });
    expect(`${getPeriodLabel(netball)} ${getPeriodNumber(netball)}`).toBe("ET 2");
    const basketball = makeState({ sport: "basketball", period: "5" });
    expect(`${getPeriodLabel(basketball)} ${getPeriodNumber(basketball)}`).toBe("OT 1");
    const league = makeState({ sport: "rugby_league", period: "3" });
    expect(`${getPeriodLabel(league)} ${getPeriodNumber(league)}`).toBe("GP 1");
    const touch = makeState({ sport: "touch_rugby", period: "4" });
    expect(`${getPeriodLabel(touch)} ${getPeriodNumber(touch)}`).toBe("DROP-OFF 2");
    const regulation = makeState({ sport: "netball", period: "3" });
    expect(`${getPeriodLabel(regulation)} ${getPeriodNumber(regulation)}`).toBe("QTR 3");
  });

  it("calls the break after the last regulation period full time", () => {
    expect(getBreakLabel(makeState({ sport: "netball", period: "2", periodBreak: true }))).toBe("QTR BREAK");
    expect(getBreakLabel(makeState({ sport: "football", period: "2", periodBreak: true }))).toBe("HALF TIME");
    expect(getBreakLabel(makeState({ sport: "netball", period: "5", periodBreak: true }))).toBe("FULL TIME");
    expect(getBreakLabel(makeState({ sport: "football", period: "3", periodBreak: true }))).toBe("FULL TIME");
    expect(getBreakLabel(makeState({ sport: "netball", period: "6", periodBreak: true }))).toBe("ET BREAK");
  });

  it("calls the middle break of a four-quarter match half time", () => {
    expect(getBreakLabel(makeState({ sport: "netball", period: "3", periodBreak: true }))).toBe("HALF TIME");
    expect(getBreakLabel(makeState({ sport: "basketball", period: "3", periodBreak: true }))).toBe("HALF TIME");
    expect(getBreakLabel(makeState({ sport: "netball", period: "4", periodBreak: true }))).toBe("QTR BREAK");
    expect(getBreakLabel(makeState({ sport: "floorball", period: "2", periodBreak: true }))).toBe("PERIOD BREAK");
    expect(getBreakLabel(makeState({ sport: "volleyball", period: "3", periodBreak: true }))).toBe("SET BREAK");
  });
});

describe("penalty shoot-outs", () => {
  it("is offered for the sports that settle ties with one", () => {
    const offered = SPORT_TEMPLATES.filter(t => t.shootout).map(t => t.sport).sort();
    expect(offered).toEqual(["floorball", "football", "futsal", "handball", "hockey", "waterpolo"]);
  });

  it("counts each side's goals from the attempts taken", () => {
    const state = makeState({ sport: "football", shootout: { home: [true, false, true], visitor: [true, true] } });
    expect(getShootout(state)).toMatchObject({ label: "PENALTIES", homeGoals: 2, visitorGoals: 2 });
  });

  it("is absent until one is started, once cleared, and for sports without one", () => {
    expect(getShootout(makeState({ sport: "football" }))).toBeUndefined();
    expect(getShootout(makeState({ sport: "football", shootout: null }))).toBeUndefined();
    expect(getShootout(makeState({ sport: "netball", shootout: { home: [true], visitor: [] } }))).toBeUndefined();
  });
});

describe("getPeriodText", () => {
  it("shows the shoot-out tally ahead of anything else", () => {
    const state = makeState({ sport: "hockey", period: "5", periodBreak: true, shootout: { home: [true, true], visitor: [false, true] } });
    expect(getPeriodText(state)).toBe("S/O 2–1");
  });

  it("otherwise shows the break, a power play, or the period", () => {
    expect(getPeriodText(makeState({ sport: "football", period: "3", periodBreak: true }))).toBe("FULL TIME");
    expect(getPeriodText(makeState({ sport: "netball", sportConfig: { format: "fast5" }, countDown: true, clockSeconds: 30 }))).toBe("POWER PLAY");
    expect(getPeriodText(makeState({ sport: "football", period: "3" }))).toBe("ET 1");
    expect(getPeriodText(makeState({ sport: "netball", period: "E" }))).toBe("EXTRA");
    expect(getPeriodText(makeState({ sport: "volleyball", period: "2" }))).toBe("SET 2");
  });
});
