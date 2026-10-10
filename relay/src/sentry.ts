import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
let initialized = false;

// GET /state takes the display token as ?token=, so it shows up in the request
// URL and span attributes of every event from that route. Sentry's own
// scrubber filters it on arrival; this strips it before the event is sent.
// Mirrors frontend/lib/sentryScrub.ts.
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

export function scrubTokens<T>(event: T): T {
  return scrub(event, new WeakSet()) as T;
}

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
    beforeSend: scrubTokens,
    beforeSendTransaction: scrubTokens,
  });
  initialized = true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
