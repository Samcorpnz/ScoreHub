// Builds the results CSV downloaded from the dashboard's History tab
// (GET /api/orgs/[orgId]/matches/export). Column names line up with the
// fixture upload format where they overlap, so a results file reads like the
// fixture file that created the matches, with scores filled in.

export interface ResultRow {
  id: string;
  sport: string | null;
  competition: string | null;
  homeName: string | null;
  visitorName: string | null;
  scheduledAt: Date | null;
  endedAt: Date | null;
  // Match.state — only the two scores are read, and either may be missing
  // on a match that was ended without being scored.
  state: unknown;
}

export const RESULT_COLUMNS = [
  "sport", "competition", "home", "visitor", "homeScore", "visitorScore", "scheduledAt", "endedAt", "matchId",
] as const;

function score(state: unknown, side: "home" | "visitor"): string {
  const value = (state as Record<string, { score?: unknown } | undefined> | null)?.[side]?.score;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

// Team and competition names are typed in by users and the file is opened in
// a spreadsheet, so anything that could be read as a formula is defused with
// an apostrophe. Not every reader follows RFC 4180: some split on a line
// break or a separator even inside quotes, which would turn the middle of a
// name into the start of a cell. So line breaks and tabs are flattened to a
// space, and a formula sign is defused wherever a cell could begin — at the
// start of the value or after a comma, semicolon or quote — allowing for the
// whitespace spreadsheets skip and the full-width forms some accept.
const CELL_START_FORMULA = /(^|[,;"])([\s\u00A0\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/g;

function cell(value: string): string {
  const safe = value.replaceAll(/[\t\r\n]+/g, " ").replaceAll(CELL_START_FORMULA, "$1'$2");
  return /[",]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildResultsCsv(rows: ResultRow[]): string {
  const lines = [RESULT_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.sport ?? "",
        row.competition ?? "",
        row.homeName ?? "",
        row.visitorName ?? "",
        score(row.state, "home"),
        score(row.state, "visitor"),
        row.scheduledAt?.toISOString() ?? "",
        row.endedAt?.toISOString() ?? "",
        row.id,
      ].map(cell).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
