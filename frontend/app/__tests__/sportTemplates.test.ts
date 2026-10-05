import { describe, it, expect } from "vitest";
import { SPORT_TEMPLATES, getTemplate, getMatchLength, getStructureLabel } from "../sport-templates";
import type { SportType } from "../types";

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
