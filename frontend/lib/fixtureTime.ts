// Fixture times are stored in UTC (Match.scheduledAt) and shown in whatever
// timezone the person looking at them is in. A time in an uploaded CSV has no
// timezone of its own, so it's read in the uploader's timezone — in the
// browser, the only place that timezone is known — and sent to the server as
// a UTC instant. The server refuses a time without an explicit offset (see
// hasExplicitOffset) so nothing ambiguous can reach the database.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

export function hasExplicitOffset(value: string): boolean {
  return EXPLICIT_OFFSET.test(value.trim());
}

// Returns the UTC ISO string for a CSV date/time, or null when it can't be
// read. A value with its own offset ("…+13:00", "…Z") is taken as written;
// anything else is local time, and a bare date is local midnight (JS would
// otherwise read "2026-10-17" as midnight UTC).
export function localFixtureTimeToUtc(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const dateOnly = DATE_ONLY.exec(text);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(hasExplicitOffset(text) ? text : text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// "Pacific/Auckland (GMT+13)" — named so an uploader can see which timezone
// their CSV's times are about to be read in.
export function localTimeZoneLabel(at: Date = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Intl.DateTimeFormat(undefined, { timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find(part => part.type === "timeZoneName")?.value;
  return offset ? `${zone} (${offset})` : zone;
}

// A stored UTC instant in the viewer's own timezone, with the zone named.
export function formatFixtureTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    + ` ${shortZoneName(new Date(iso))}`;
}

function shortZoneName(at: Date): string {
  return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(at)
    .find(part => part.type === "timeZoneName")?.value ?? "";
}
