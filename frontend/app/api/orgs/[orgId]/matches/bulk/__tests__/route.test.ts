// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const matchCreateManyMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: { createMany: (...a: unknown[]) => matchCreateManyMock(...a) },
  },
}));

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orgs/org-1/matches/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ orgId: "org-1" });

const validFixture = { sport: "netball", home: "Home Team", visitor: "Visitor Team" };

describe("/api/orgs/[orgId]/matches/bulk", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    getAccountForOrgMock.mockReset();
    matchCreateManyMock.mockReset();
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    getAccountForOrgMock.mockResolvedValue({ plan: "pro" });
  });

  describe("POST", () => {
    it("401s when there's no session", async () => {
      authMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(401);
    });

    it("401s when the session's activeOrgId doesn't match the route param", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-2", activeRole: "ADMIN" } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(401);
    });

    it("403s for a role outside ADMIN/MANAGER/OPERATOR", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "VIEWER" } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(403);
    });

    it("403s when there's no account for the org", async () => {
      getAccountForOrgMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(403);
    });

    it("403s when the org's plan isn't pro or venue", async () => {
      getAccountForOrgMock.mockResolvedValue({ plan: "free" });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(403);
    });

    it("allows the venue plan", async () => {
      getAccountForOrgMock.mockResolvedValue({ plan: "venue" });
      matchCreateManyMock.mockResolvedValue({ count: 1 });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(200);
    });

    it("400s when no fixtures are provided", async () => {
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [] }), { params });
      expect(res.status).toBe(400);
    });

    it("400s when the body is unparseable JSON (treated as no fixtures)", async () => {
      const { POST } = await import("../route");
      const req = new NextRequest("http://localhost/api/orgs/org-1/matches/bulk", { method: "POST", body: "not json" });
      const res = await POST(req, { params });
      expect(res.status).toBe(400);
    });

    it("400s when more than 500 fixtures are provided", async () => {
      const fixtures = Array.from({ length: 501 }, () => validFixture);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures }), { params });
      expect(res.status).toBe(400);
    });

    it("400s with row-level errors for an unknown sport", async () => {
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [{ sport: "quidditch", home: "A", visitor: "B" }] }), { params });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toEqual([{ row: 0, error: 'unknown sport "quidditch"' }]);
    });

    it("400s with row-level errors for missing home/visitor", async () => {
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [{ sport: "netball", home: "", visitor: "" }] }), { params });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toEqual(
        expect.arrayContaining([
          { row: 0, error: "missing home team" },
          { row: 0, error: "missing visitor team" },
        ]),
      );
    });

    it("400s on an invalid scheduledAt", async () => {
      const { POST } = await import("../route");
      const res = await POST(
        makePostRequest({ fixtures: [{ ...validFixture, scheduledAt: "not-a-date" }] }),
        { params },
      );
      expect(res.status).toBe(400);
    });

    it("400s on a scheduledAt with no timezone offset, rather than guessing one", async () => {
      const { POST } = await import("../route");
      const res = await POST(
        makePostRequest({ fixtures: [{ ...validFixture, scheduledAt: "2026-10-17T18:30" }] }),
        { params },
      );
      expect(res.status).toBe(400);
      expect(matchCreateManyMock).not.toHaveBeenCalled();
    });

    it("stores a scheduledAt given with an offset as the matching UTC instant", async () => {
      matchCreateManyMock.mockResolvedValue({ count: 1 });
      const { POST } = await import("../route");
      await POST(makePostRequest({ fixtures: [{ ...validFixture, scheduledAt: "2026-10-17T18:30+13:00" }] }), { params });
      expect(matchCreateManyMock.mock.calls[0][0].data[0].scheduledAt).toEqual(new Date("2026-10-17T05:30:00.000Z"));
    });

    it("400s when a field exceeds its max length", async () => {
      const { POST } = await import("../route");
      const res = await POST(
        makePostRequest({ fixtures: [{ ...validFixture, home: "A".repeat(101) }] }),
        { params },
      );
      expect(res.status).toBe(400);
    });

    it("creates matches and returns the created count", async () => {
      matchCreateManyMock.mockResolvedValue({ count: 1 });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ created: 1 });
      expect(matchCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            orgId: "org-1",
            status: "SCHEDULED",
            sport: "netball",
            homeName: "Home Team",
            visitorName: "Visitor Team",
            scheduledAt: null,
          }),
        ],
      });
    });

    it("defaults matchName to 'home v visitor' when not provided", async () => {
      matchCreateManyMock.mockResolvedValue({ count: 1 });
      const { POST } = await import("../route");
      await POST(makePostRequest({ fixtures: [validFixture] }), { params });
      const call = matchCreateManyMock.mock.calls[0][0];
      expect(call.data[0].state.matchName).toBe("Home Team v Visitor Team");
    });

    it("parses scheduledAt into a Date when provided", async () => {
      matchCreateManyMock.mockResolvedValue({ count: 1 });
      const { POST } = await import("../route");
      await POST(makePostRequest({ fixtures: [{ ...validFixture, scheduledAt: "2026-09-01T10:00:00.000Z" }] }), { params });
      const call = matchCreateManyMock.mock.calls[0][0];
      expect(call.data[0].scheduledAt).toEqual(new Date("2026-09-01T10:00:00.000Z"));
    });
  });
});
