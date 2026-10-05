import type { Env } from "./worker";

// Structured events for the help assistant: what people ask, what it
// answers, and whether that settled it. Always written to Workers Logs
// (console); also shipped to Better Stack when its source token is set —
// the same BETTER_STACK_* names the relay and frontend use.
export function logEvent(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  message: string,
  fields: Record<string, unknown>,
): void {
  const entry = { message, service: "help", dt: new Date().toISOString(), ...fields };
  console.log(JSON.stringify(entry));

  if (!env.BETTER_STACK_SOURCE_TOKEN || !env.BETTER_STACK_INGESTING_URL) return;
  ctx.waitUntil(
    fetch(env.BETTER_STACK_INGESTING_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.BETTER_STACK_SOURCE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(entry),
    }).catch(() => {
      // Logging must never break or delay an answer.
    }),
  );
}
