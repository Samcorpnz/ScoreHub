import { MatchState } from "./types";

// Graphics add-on "straight data out": one flat record of the match for
// vMix/OBS data sources, spreadsheets and the like. Flat on purpose — those
// tools bind a text field to a column name and can't walk nested JSON.
//
// The clock is sent two ways. Tools that only display text bind to
// clockDisplay, which is worked out when the request arrives, so a 1s poll
// ticks correctly. Tools that can run their own timer use clockSeconds +
// clockAnchorMs + clockDirection and count locally between polls.

export const GRAPHICS_DATA_FORMATS = ["json", "xml", "csv"] as const;
export type GraphicsDataFormat = typeof GRAPHICS_DATA_FORMATS[number];

export interface GraphicsDataRecord {
  matchName: string;
  sport: string;
  period: string;
  inBreak: boolean;
  clockDisplay: string;
  // Live value at serverTimeMs, to the tenth
  clockSeconds: number;
  clockRunning: boolean;
  clockDirection: "up" | "down";
  // When clockSeconds was exactly right — equals serverTimeMs, since
  // clockSeconds is already brought up to date for this response
  clockAnchorMs: number;
  serverTimeMs: number;
  possession: string;
  homeName: string;
  homeScore: number;
  homeColor: string;
  homeTimeouts: number;
  homeFouls: number;
  visitorName: string;
  visitorScore: number;
  visitorColor: string;
  visitorTimeouts: number;
  visitorFouls: number;
}

// How far past the last known clock value this will count on its own. The
// relay re-anchors every second and a bridge sends several times a second,
// so anything beyond this means the source has gone quiet — better to hold
// than to run the clock on with nothing behind it.
const MAX_EXTRAPOLATE_S = 2;

// Same rule as the display pages (formatClockDisplay in the frontend):
// MM:SS from a minute up, SS.t under a minute.
export function formatFeedClock(seconds: number): string {
  if (seconds >= 60) {
    const whole = Math.floor(seconds);
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }
  const s = Math.floor(seconds);
  const tenths = Math.floor((seconds - s) * 10);
  return `${String(s).padStart(2, "0")}.${tenths}`;
}

// receivedAtMs is when the relay last took in this state. It stands in as
// the anchor when the state has none of its own (a console bridge drives the
// clock, so the relay's tick loop isn't stamping clockAnchorMs).
export function liveClockSeconds(state: MatchState, nowMs: number, receivedAtMs?: number): number {
  if (state.clockSeconds < 0) return state.clockSeconds;
  const direction = state.countDown ? -1 : 1;
  let seconds = state.clockSeconds + direction * ((state.clockCarryMs ?? 0) / 1000);
  const anchor = state.clockAnchorMs ?? receivedAtMs;
  if (state.isRunning && anchor !== undefined) {
    const elapsed = Math.min(Math.max(0, (nowMs - anchor) / 1000), MAX_EXTRAPOLATE_S);
    seconds += direction * elapsed;
  }
  return Math.max(0, seconds);
}

export function buildGraphicsDataRecord(state: MatchState, nowMs: number, receivedAtMs?: number): GraphicsDataRecord {
  const seconds = liveClockSeconds(state, nowMs, receivedAtMs);
  return {
    matchName: state.matchName,
    sport: state.sport,
    period: state.period,
    inBreak: state.periodBreak,
    // -1 is "no clock" for sports that don't run one
    clockDisplay: seconds < 0 ? "" : formatFeedClock(seconds),
    clockSeconds: Math.round(seconds * 10) / 10,
    clockRunning: state.isRunning,
    clockDirection: state.countDown ? "down" : "up",
    clockAnchorMs: nowMs,
    serverTimeMs: nowMs,
    possession: state.possession,
    homeName: state.home.name,
    homeScore: state.home.score,
    homeColor: state.home.color,
    homeTimeouts: state.home.timeouts,
    homeFouls: state.home.faults,
    visitorName: state.visitor.name,
    visitorScore: state.visitor.score,
    visitorColor: state.visitor.color,
    visitorTimeouts: state.visitor.timeouts,
    visitorFouls: state.visitor.faults,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// RFC 4180 quoting, plus a leading ' on anything a spreadsheet would read as
// a formula — team and match names are operator-typed.
function escapeCsv(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function serializeGraphicsData(record: GraphicsDataRecord, format: GraphicsDataFormat): string {
  const entries = Object.entries(record) as [string, string | number | boolean][];
  if (format === "json") return JSON.stringify(record);
  if (format === "xml") {
    const fields = entries.map(([key, value]) => `  <${key}>${escapeXml(String(value))}</${key}>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<match>\n${fields}\n</match>\n`;
  }
  const header = entries.map(([key]) => key).join(",");
  const row = entries.map(([, value]) => (typeof value === "string" ? escapeCsv(value) : String(value))).join(",");
  return `${header}\r\n${row}\r\n`;
}

export const GRAPHICS_DATA_CONTENT_TYPES: Record<GraphicsDataFormat, string> = {
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};
