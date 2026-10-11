import { describe, it, expect } from "vitest";
import { buildResultsCsv, type ResultRow } from "../resultsCsv";

function row(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: "m-1",
    sport: "netball",
    competition: "Premier",
    homeName: "Sharks",
    visitorName: "Rays",
    scheduledAt: new Date("2026-10-10T01:00:00.000Z"),
    endedAt: new Date("2026-10-10T02:05:00.000Z"),
    state: { home: { score: 42 }, visitor: { score: 39 } },
    ...overrides,
  };
}

const dataLine = (csv: string) => csv.split("\r\n")[1];

describe("buildResultsCsv", () => {
  it("writes a header and one CRLF-terminated line per match", () => {
    const csv = buildResultsCsv([row(), row({ id: "m-2" })]);
    expect(csv.split("\r\n")).toEqual([
      "sport,competition,home,visitor,homeScore,visitorScore,scheduledAt,endedAt,matchId",
      "netball,Premier,Sharks,Rays,42,39,2026-10-10T01:00:00.000Z,2026-10-10T02:05:00.000Z,m-1",
      "netball,Premier,Sharks,Rays,42,39,2026-10-10T01:00:00.000Z,2026-10-10T02:05:00.000Z,m-2",
      "",
    ]);
  });

  it("leaves blanks for values a match doesn't have", () => {
    const csv = buildResultsCsv([row({ sport: null, competition: null, homeName: null, visitorName: null, scheduledAt: null, endedAt: null, state: null })]);
    expect(dataLine(csv)).toBe(",,,,,,,,m-1");
  });

  it("writes a zero score as 0, and a missing or non-numeric one as blank", () => {
    expect(dataLine(buildResultsCsv([row({ state: { home: { score: 0 }, visitor: {} } })]))).toContain("Rays,0,,");
    expect(dataLine(buildResultsCsv([row({ state: { home: { score: "7" }, visitor: { score: NaN } } })]))).toContain("Rays,,,");
  });

  it("quotes names containing commas, quotes or line breaks", () => {
    const csv = buildResultsCsv([row({ homeName: 'Sharks, "A" team', visitorName: "Rays\nReserves" })]);
    expect(csv).toContain('"Sharks, ""A"" team","Rays\nReserves"');
  });

  it("stops a name being read as a spreadsheet formula", () => {
    const csv = buildResultsCsv([row({ homeName: "=HYPERLINK(\"http://x\")", visitorName: "+1", competition: "@cup", sport: "-x" })]);
    expect(dataLine(csv)).toBe(`'-x,'@cup,"'=HYPERLINK(""http://x"")",'+1,42,39,2026-10-10T01:00:00.000Z,2026-10-10T02:05:00.000Z,m-1`);
  });

  it("catches a formula hidden behind leading whitespace, a control character or a full-width sign", () => {
    for (const name of [" =1+1", "\t=1+1", "\u00A0@SUM(A1)", "\uFF1D1+1", "\rplain", "  -2+3"]) {
      const line = buildResultsCsv([row({ homeName: name })]).split("\r\n").slice(1).join("\r\n");
      expect(line.split(",")[2].replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });

  it("leaves ordinary names alone, including ones with a sign after the first character", () => {
    const csv = buildResultsCsv([row({ homeName: "A-Team", visitorName: "U16 = Gold", competition: "Div 1 + 2" })]);
    expect(dataLine(csv)).toBe("netball,Div 1 + 2,A-Team,U16 = Gold,42,39,2026-10-10T01:00:00.000Z,2026-10-10T02:05:00.000Z,m-1");
  });
});
