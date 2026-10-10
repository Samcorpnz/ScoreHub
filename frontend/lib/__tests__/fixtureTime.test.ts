import { describe, it, expect } from "vitest";
import { hasExplicitOffset, localFixtureTimeToUtc, localTimeZoneLabel, formatFixtureTime } from "../fixtureTime";

describe("localFixtureTimeToUtc", () => {
  it("reads a time with no offset in the local timezone", () => {
    expect(localFixtureTimeToUtc("2026-10-17T18:30")).toBe(new Date(2026, 9, 17, 18, 30).toISOString());
  });

  it("accepts a space between the date and the time", () => {
    expect(localFixtureTimeToUtc("2026-10-17 18:30")).toBe(new Date(2026, 9, 17, 18, 30).toISOString());
  });

  it("reads a bare date as local midnight, not UTC midnight", () => {
    expect(localFixtureTimeToUtc("2026-10-17")).toBe(new Date(2026, 9, 17).toISOString());
  });

  it("takes a time with its own offset as written", () => {
    expect(localFixtureTimeToUtc("2026-10-17T18:30+13:00")).toBe("2026-10-17T05:30:00.000Z");
    expect(localFixtureTimeToUtc("2026-10-17T05:30:00Z")).toBe("2026-10-17T05:30:00.000Z");
  });

  it("returns null for something that isn't a date", () => {
    expect(localFixtureTimeToUtc("next Saturday")).toBeNull();
    expect(localFixtureTimeToUtc("  ")).toBeNull();
  });
});

describe("hasExplicitOffset", () => {
  it("is true only when the value names its own offset", () => {
    expect(hasExplicitOffset("2026-10-17T05:30:00.000Z")).toBe(true);
    expect(hasExplicitOffset("2026-10-17T18:30+13:00")).toBe(true);
    expect(hasExplicitOffset("2026-10-17T18:30-0500")).toBe(true);
    expect(hasExplicitOffset("2026-10-17T18:30")).toBe(false);
    expect(hasExplicitOffset("2026-10-17")).toBe(false);
  });
});

describe("timezone labels", () => {
  it("names the local timezone", () => {
    expect(localTimeZoneLabel()).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("formats a stored time with a zone name", () => {
    expect(formatFixtureTime("2026-10-17T05:30:00.000Z")).toMatch(/2026/);
  });
});
