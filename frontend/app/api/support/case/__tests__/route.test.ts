// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const orgFindUniqueMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: { org: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) } },
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

const fetchMock = vi.fn();

const SIGNED_IN = {
  user: {
    id: "u1",
    name: "Ana",
    email: "ana@example.test",
    activeOrgId: "org-1",
    activeRole: "ADMIN",
    memberships: [{ orgId: "org-1", orgName: "First Club", role: "ADMIN" }],
  },
};

function makeRequest(body: unknown, origin = "https://help.scorehub.co.nz") {
  return new NextRequest("https://app.scorehub.co.nz/api/support/case", {
    method: "POST",
    headers: { origin, "x-real-ip": `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// The JSM request body sent for the "create request" call.
function createRequestBody() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/rest/servicedeskapi/request"));
  return JSON.parse(call![1].body);
}

describe("POST /api/support/case", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    orgFindUniqueMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("JSM_BASE_URL", "https://jsm.example.test");
    vi.stubEnv("JSM_EMAIL", "agent@example.test");
    vi.stubEnv("JSM_API_TOKEN", "test-token");
    orgFindUniqueMock.mockResolvedValue({ account: { plan: "pro", addOns: ["data-feed"] } });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/customer")
        ? jsonResponse({ accountId: "acc-1" }, 201)
        : jsonResponse({ issueKey: "SUP-7" }, 201),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("files a signed-in user's request under their session identity, ignoring any email in the body", async () => {
    authMock.mockResolvedValue(SIGNED_IN);
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        category: "billing",
        summary: "Charged twice",
        details: "Two invoices this month",
        email: "someone-else@example.test",
        transcript: [{ role: "user", content: "I was charged twice" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "SUP-7" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://help.scorehub.co.nz");

    const sent = createRequestBody();
    expect(sent.raiseOnBehalfOf).toBe("acc-1");
    expect(sent.requestTypeId).toBe("5");
    expect(sent.requestFieldValues.summary).toBe("[Billing] Charged twice");
    const description = sent.requestFieldValues.description;
    expect(description).toContain("Email: ana@example.test");
    expect(description).not.toContain("someone-else@example.test");
    expect(description).toContain("Organisation: First Club");
    expect(description).toContain("Role: ADMIN");
    expect(description).toContain("Plan: pro + data-feed");
    expect(description).toContain("Identity verified");
    expect(description).toContain("Customer: I was charged twice");
  });

  it("401s a signed-out caller for every category except login", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "billing", summary: "Refund", email: "x@example.test" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("files a signed-out login request as unverified and never on behalf of the typed email", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest(
        { category: "login", summary: "Can't sign in", email: "Locked@Example.test", name: "Lee" },
        "https://app.scorehub.co.nz",
      ),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = createRequestBody();
    expect(sent.raiseOnBehalfOf).toBeUndefined();
    expect(sent.requestFieldValues.description).toContain("Email: locked@example.test");
    expect(sent.requestFieldValues.description).toContain("Email NOT verified");
  });

  it("400s a signed-out login request that fails the Turnstile check, without filing anything", async () => {
    vi.stubEnv("TURNSTILE_SECRET", "test-secret");
    authMock.mockResolvedValue(null);
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("turnstile") ? jsonResponse({ success: false }) : jsonResponse({ issueKey: "SUP-9" }, 201),
    );
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "login", summary: "x", email: "a@b.test", turnstileToken: "bad" }));
    expect(res.status).toBe(400);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("turnstile"))).toBe(true);
  });

  it("does not ask signed-in users for a Turnstile token", async () => {
    vi.stubEnv("TURNSTILE_SECRET", "test-secret");
    authMock.mockResolvedValue(SIGNED_IN);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "setup", summary: "Help" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("turnstile"))).toBe(false);
  });

  it("400s a signed-out login request without a valid email", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "login", summary: "Can't sign in", email: "nope" }));
    expect(res.status).toBe(400);
  });

  it("400s an unknown category or a missing summary", async () => {
    authMock.mockResolvedValue(SIGNED_IN);
    const { POST } = await import("../route");
    expect((await POST(makeRequest({ category: "nonsense", summary: "x" }))).status).toBe(400);
    expect((await POST(makeRequest({ category: "billing", summary: "  " }))).status).toBe(400);
  });

  it("403s a request from an origin that isn't the app or its help site", async () => {
    authMock.mockResolvedValue(SIGNED_IN);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "billing", summary: "x" }, "https://evil.example"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently accepts a honeypot submission without filing anything", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "login", summary: "x", email: "a@b.test", website: "spam" }));
    expect(await res.json()).toEqual({ key: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503s when JSM credentials aren't configured", async () => {
    vi.stubEnv("JSM_API_TOKEN", "");
    authMock.mockResolvedValue(SIGNED_IN);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "setup", summary: "Help" }));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still files the request without raiseOnBehalfOf when JSM rejects the on-behalf-of call", async () => {
    authMock.mockResolvedValue(SIGNED_IN);
    let attempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/customer")) return jsonResponse({ accountId: "acc-1" }, 201);
      attempts += 1;
      return attempts === 1 ? jsonResponse({ errorMessage: "no" }, 400) : jsonResponse({ issueKey: "SUP-8" }, 201);
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "setup", summary: "Help" }));
    expect(await res.json()).toEqual({ key: "SUP-8" });
  });

  it("502s when JSM rejects the request outright", async () => {
    authMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(jsonResponse({ errorMessage: "down" }, 500));
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ category: "login", summary: "x", email: "a@b.test" }));
    expect(res.status).toBe(502);
  });

  it("rate-limits a signed-out caller after 3 requests from one IP", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const send = () =>
      POST(
        new NextRequest("https://app.scorehub.co.nz/api/support/case", {
          method: "POST",
          headers: { origin: "https://app.scorehub.co.nz", "x-real-ip": "203.0.113.9" },
          body: JSON.stringify({ category: "login", summary: "x", email: "a@b.test" }),
        }),
      );
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});
