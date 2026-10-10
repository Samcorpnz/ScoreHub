// Display links and the emailed reset/invite/verify links carry a secret in
// their ?token= query parameter, and Sentry events are full of URLs (the page,
// fetch spans, navigation breadcrumbs). Sentry's own scrubber filters these on
// arrival; this removes them before the event leaves the browser or server,
// so keeping them out doesn't depend on a Sentry project setting.
const TOKEN_PARAM = /((?:^|[?&])token=)[^&#\s]+/gi;

function scrub(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return value.replace(TOKEN_PARAM, "$1[Filtered]");
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    record[key] = scrub(record[key], seen);
  }
  return value;
}

// Rewrites every string in the event in place. Shaped for Sentry's beforeSend
// and beforeSendTransaction hooks.
export function scrubTokens<T>(event: T): T {
  return scrub(event, new WeakSet()) as T;
}
