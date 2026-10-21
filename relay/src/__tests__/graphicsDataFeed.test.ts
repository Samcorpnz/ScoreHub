import { buildGraphicsDataRecord, formatFeedClock, liveClockSeconds, serializeGraphicsData } from "../graphicsDataFeed";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";

const state = (patch: Partial<MatchState> = {}): MatchState => ({ ...DEFAULT_MATCH_STATE, ...patch } as MatchState);

describe("formatFeedClock", () => {
  it("shows MM:SS from a minute up and SS.t below", () => {
    expect(formatFeedClock(462)).toBe("07:42");
    expect(formatFeedClock(60)).toBe("01:00");
    expect(formatFeedClock(9.46)).toBe("09.4");
    expect(formatFeedClock(0)).toBe("00.0");
  });
});

describe("liveClockSeconds", () => {
  const now = 1_000_000;

  it("holds a stopped clock", () => {
    expect(liveClockSeconds(state({ clockSeconds: 300, isRunning: false, countDown: true, clockAnchorMs: now - 500 }), now)).toBe(300);
  });

  it("counts a running clock on from the relay's anchor", () => {
    expect(liveClockSeconds(state({ clockSeconds: 300, isRunning: true, countDown: true, clockAnchorMs: now - 500 }), now)).toBeCloseTo(299.5);
    expect(liveClockSeconds(state({ clockSeconds: 300, isRunning: true, countDown: false, clockAnchorMs: now - 500 }), now)).toBeCloseTo(300.5);
  });

  it("falls back to when the state arrived for a bridge-driven clock", () => {
    expect(liveClockSeconds(state({ clockSeconds: 300, isRunning: true, countDown: true }), now, now - 250)).toBeCloseTo(299.75);
  });

  it("stops counting on its own after two seconds without a new value", () => {
    expect(liveClockSeconds(state({ clockSeconds: 300, isRunning: true, countDown: true, clockAnchorMs: now - 60_000 }), now)).toBe(298);
  });

  it("never goes below zero", () => {
    expect(liveClockSeconds(state({ clockSeconds: 0, isRunning: true, countDown: true, clockAnchorMs: now - 1000 }), now)).toBe(0);
  });
});

describe("buildGraphicsDataRecord", () => {
  it("anchors the record at the response time", () => {
    const record = buildGraphicsDataRecord(state({ clockSeconds: 462, isRunning: true, countDown: true, clockAnchorMs: 9_000 }), 9_000);
    expect(record).toMatchObject({ clockDisplay: "07:42", clockSeconds: 462, clockRunning: true, clockDirection: "down", clockAnchorMs: 9_000, serverTimeMs: 9_000 });
  });

  it("leaves the clock blank for a sport with no clock", () => {
    expect(buildGraphicsDataRecord(state({ clockSeconds: -1 }), 0).clockDisplay).toBe("");
  });
});

describe("serializeGraphicsData", () => {
  const record = buildGraphicsDataRecord(state({
    matchName: 'Final, "A" <grade>',
    home: { ...DEFAULT_MATCH_STATE.home, name: "=HYPERLINK(1)" },
  }), 0);

  it("escapes XML", () => {
    expect(serializeGraphicsData(record, "xml")).toContain("<matchName>Final, &quot;A&quot; &lt;grade&gt;</matchName>");
  });

  it("quotes CSV and defuses spreadsheet formulas", () => {
    const [header, row] = serializeGraphicsData(record, "csv").split("\r\n");
    expect(header.split(",")).toHaveLength(Object.keys(record).length);
    expect(row.startsWith('"Final, ""A"" <grade>",')).toBe(true);
    expect(row).toContain(",'=HYPERLINK(1),");
  });
});
