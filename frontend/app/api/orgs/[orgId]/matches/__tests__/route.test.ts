// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const matchFindManyMock = vi.fn();
const matchUpdateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: {
      findMany: (...a: unknown[]) => matchFindManyMock(...a),
      update: (...a: unknown[]) => matchUpdateMock(...a),
    },
  },
  MatchStatus: {},
}));

function makePostRequest(body?: unknown) {
  return new NextRequest("http://localhost/api/orgs/org-1/matches", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function makeGetRequest(qs = "") {
  return new NextRequest(`http://localhost/api/orgs/org-1/matches${qs}`);
}

const params = Promise.resolve({ orgId: "org-1" });

const originalFetch = global.fetch;

describe("/api/orgs/[orgId]/matches", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    matchFindManyMock.mockReset();
    matchUpdateMock.mockReset();
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    process.env.AUTH_SECRET = "test-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_SECRET;
    delete process.env.RELAY_INTERNAL_URL;
    delete process.env.NEXT_PUBLIC_RELAY_URL;
  });

  describe("POST", () => {
    it("401s when there's no session", async () => {
      authMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(401);
    });

    it("401s when the session's activeOrgId doesn't match the route param", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-2", activeRole: "ADMIN" } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(401);
    });

    it("403s for a role outside ADMIN/MANAGER/OPERATOR", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "VIEWER" } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(403);
    });

    it("500s when AUTH_SECRET isn't configured", async () => {
      delete process.env.AUTH_SECRET;
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(500);
    });

    it("propagates a failure response from the relay", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "too many live matches" }),
      });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("too many live matches");
    });

    it("handles an unparseable relay response body as failure with a default error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => { throw new Error("not json"); },
      });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("failed to create match");
    });

    it("creates a match via the relay and returns its id", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "match-1" }),
      });
      global.fetch = fetchMock;
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "match-1" });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4000/match",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "x-control-secret": expect.any(String) }),
        }),
      );
    });

    it("saves the match's date and time on the new row", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "match-1" }) });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ scheduledAt: "2026-10-17T06:30:00.000Z" }), { params });
      expect(res.status).toBe(200);
      expect(matchUpdateMock).toHaveBeenCalledWith({
        where: { id: "match-1" },
        data: { scheduledAt: new Date("2026-10-17T06:30:00.000Z") },
      });
    });

    it("rejects a date and time without a timezone, before creating anything", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ scheduledAt: "2026-10-17T19:30" }), { params });
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses RELAY_INTERNAL_URL over NEXT_PUBLIC_RELAY_URL when both are set", async () => {
      process.env.RELAY_INTERNAL_URL = "http://relay:4000";
      process.env.NEXT_PUBLIC_RELAY_URL = "https://public-relay.example.com";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "match-1" }),
      });
      global.fetch = fetchMock;
      const { POST } = await import("../route");
      await POST(makePostRequest(), { params });
      expect(fetchMock).toHaveBeenCalledWith("http://relay:4000/match", expect.anything());
    });
  });

  describe("GET", () => {
    it("401s when there's no session", async () => {
      authMock.mockResolvedValue(null);
      const { GET } = await import("../route");
      const res = await GET(makeGetRequest(), { params });
      expect(res.status).toBe(401);
    });

    it("401s when the session's activeOrgId doesn't match the route param", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-2", activeRole: "ADMIN" } });
      const { GET } = await import("../route");
      const res = await GET(makeGetRequest(), { params });
      expect(res.status).toBe(401);
    });

    it("returns all matches for the org with no filters", async () => {
      matchFindManyMock.mockResolvedValue([{ id: "m1", status: "LIVE", state: null }]);
      const { GET } = await import("../route");
      const res = await GET(makeGetRequest(), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ matches: [{ id: "m1", status: "LIVE", live: null }] });
      expect(matchFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: "org-1" } }),
      );
    });

    it("sends each row a small live summary instead of its whole saved state", async () => {
      matchFindManyMock.mockResolvedValue([{
        id: "m1", status: "LIVE",
        state: {
          home: { score: 14, players: ["x"] }, visitor: { score: 11 }, period: "2", periodBreak: false,
          isRunning: true, clockSeconds: 412, countDown: true, netballStats: { big: true },
        },
      }]);
      const { GET } = await import("../route");
      const body = await (await GET(makeGetRequest(), { params })).json();
      expect(body.matches[0]).toEqual({
        id: "m1", status: "LIVE",
        live: {
          homeScore: 14, visitorScore: 11, period: "2", periodBreak: false, isRunning: true,
          clockSeconds: 412, countDown: true, shootout: null,
        },
      });
    });

    it("lists history most recent first", async () => {
      matchFindManyMock.mockResolvedValue([]);
      const { GET } = await import("../route");
      await GET(makeGetRequest("?status=ended"), { params });
      expect(matchFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: [{ scheduledAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      }));
    });

    it("filters by a comma-separated, case-insensitive status list, dropping invalid values", async () => {
      matchFindManyMock.mockResolvedValue([]);
      const { GET } = await import("../route");
      await GET(makeGetRequest("?status=live,ended,bogus"), { params });
      expect(matchFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ["LIVE", "ENDED"] } }),
        }),
      );
    });

    it("filters by sport and competition", async () => {
      matchFindManyMock.mockResolvedValue([]);
      const { GET } = await import("../route");
      await GET(makeGetRequest("?sport=netball&competition=Premiership"), { params });
      expect(matchFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sport: "netball", competition: "Premiership" }),
        }),
      );
    });

    it("filters by a specific match id (used to fetch one match's displayToken)", async () => {
      matchFindManyMock.mockResolvedValue([]);
      const { GET } = await import("../route");
      await GET(makeGetRequest("?id=m1"), { params });
      expect(matchFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: "m1" }) }),
      );
    });

    it("adds a case-insensitive OR search on home/visitor names for q", async () => {
      matchFindManyMock.mockResolvedValue([]);
      const { GET } = await import("../route");
      await GET(makeGetRequest("?q=eagles"), { params });
      expect(matchFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { homeName: { contains: "eagles", mode: "insensitive" } },
              { visitorName: { contains: "eagles", mode: "insensitive" } },
            ],
          }),
        }),
      );
    });
  });
});
