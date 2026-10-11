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
// a spreadsheet, so a value that would be read as a formula is prefixed with
// an apostrophe. Spreadsheets skip leading whitespace before deciding, and
// some accept the full-width forms of the trigger characters, so both are
// checked. Quoting follows RFC 4180.
const FORMULA_START = /^[\s\u00A0\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
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
