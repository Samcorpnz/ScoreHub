import { conversationId, handleAsk } from "./ask";
import { logEvent } from "./log";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ASK_LIMITER?: RateLimiter;
  ASK_GLOBAL_LIMITER?: RateLimiter;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_BASE_URL?: string;
  BETTER_STACK_SOURCE_TOKEN?: string;
  BETTER_STACK_INGESTING_URL?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The API is only for this site's own pages: browsers always send Origin on a
// cross-site POST, so a mismatch means another site is calling it.
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

// What happened after an answer: "resolved" / "unresolved" from the "did
// that answer your question?" buttons, "case_filed" when a support request
// followed. Logged so deflection can be measured.
const FEEDBACK_EVENTS = new Set(["resolved", "unresolved", "case_filed"]);

async function handleEvent(request: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { type?: unknown; key?: unknown } | null;
  if (typeof body?.type !== "string" || !FEEDBACK_EVENTS.has(body.type)) {
    return json({ error: "invalid_request" }, 400);
  }
  logEvent(env, ctx, "help.feedback", {
    conversationId: conversationId(body),
    type: body.type,
    key: typeof body.key === "string" ? body.key.slice(0, 20) : undefined,
  });
  return json({ ok: true });
}

async function handleApi(request: Request, env: Env, ctx: ExecutionCtx, pathname: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (pathname !== "/api/ask" && pathname !== "/api/event") return json({ error: "not_found" }, 404);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.ASK_LIMITER && !(await env.ASK_LIMITER.limit({ key: ip })).success) {
    return json({ error: "rate_limited" }, 429);
  }
  if (pathname === "/api/event") return handleEvent(request, env, ctx);

  // A ceiling across all visitors, so a distributed burst can't run up the
  // model bill. The OpenRouter key's own credit limit is the hard backstop.
  if (env.ASK_GLOBAL_LIMITER && !(await env.ASK_GLOBAL_LIMITER.limit({ key: "all" })).success) {
    logEvent(env, ctx, "help.global_limit_tripped", {});
    return json({ error: "rate_limited" }, 429);
  }
  return handleAsk(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env, ctx, pathname);
    return env.ASSETS.fetch(request);
  },
};
