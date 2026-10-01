// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The route caches results and reads its config from env at import time, so
// every test loads a fresh copy of the module.
async function loadRoute() {
  vi.resetModules();
  return (await import("../route")).GET;
}

const fetchMock = vi.fn();
const ENV_KEYS = ["SENTRY_ERROR_MONITOR_TOKEN", "SENTRY_ERROR_RATE_PROJECTS", "SENTRY_ERROR_RATE_THRESHOLD", "SENTRY_ORG_SLUG"] as const;
const saved: Record<string, string | undefined> = {};

function sentryCount(n: number) {
  return { ok: true, status: 200, json: async () => ({ data: [{ "count()": n }] }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("GET /api/health/sentry-error-rate", () => {
  it("reports ok without calling Sentry when no token is configured", async () => {
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports ok (200) when total errors across projects are under the threshold", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockResolvedValue(sentryCount(5)); // 2 default projects x 5 = 10 < 20
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports degraded (503) when the summed count reaches the threshold", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockResolvedValue(sentryCount(10)); // 2 x 10 = 20 >= 20
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
  });

  it("honours SENTRY_ERROR_RATE_THRESHOLD and SENTRY_ERROR_RATE_PROJECTS", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    process.env.SENTRY_ERROR_RATE_THRESHOLD = "3";
    process.env.SENTRY_ERROR_RATE_PROJECTS = "only-one";
    fetchMock.mockResolvedValue(sentryCount(3));
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("project=only-one");
  });

  it("sends the bearer token and queries error-level events for the last 5 minutes", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "secret-tok";
    fetchMock.mockResolvedValue(sentryCount(0));
    const GET = await loadRoute();
    await GET();
    const [url, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret-tok" });
    const u = new URL(String(url));
    expect(u.searchParams.get("query")).toBe("level:error");
    expect(u.searchParams.get("statsPeriod")).toBe("5m");
  });

  it("fails open (200) when Sentry returns a non-OK response", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("fails open (200) when the Sentry request throws or times out", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockRejectedValue(new Error("timeout"));
    const GET = await loadRoute();
    expect((await GET()).status).toBe(200);
  });

  it("treats a response with no data rows as zero errors", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const GET = await loadRoute();
    expect((await GET()).status).toBe(200);
  });

  it("serves a repeat call from cache without re-querying Sentry", async () => {
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockResolvedValue(sentryCount(50));
    const GET = await loadRoute();
    expect((await GET()).status).toBe(503);
    expect((await GET()).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 2 projects, first call only
  });

  it("re-queries Sentry once the cache TTL has elapsed", async () => {
    vi.useFakeTimers();
    process.env.SENTRY_ERROR_MONITOR_TOKEN = "tok";
    fetchMock.mockResolvedValue(sentryCount(50));
    const GET = await loadRoute();
    expect((await GET()).status).toBe(503);
    fetchMock.mockResolvedValue(sentryCount(0));
    vi.advanceTimersByTime(21_000);
    expect((await GET()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
