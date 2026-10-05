// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const matchFindUniqueMock = vi.fn();
const matchUpdateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: {
      findUnique: (...a: unknown[]) => matchFindUniqueMock(...a),
      update: (...a: unknown[]) => matchUpdateMock(...a),
    },
  },
}));

function makePostRequest() {
  return new NextRequest("http://localhost/api/orgs/org-1/matches/m1/end", { method: "POST" });
}

const params = Promise.resolve({ orgId: "org-1", matchId: "m1" });

describe("/api/orgs/[orgId]/matches/[matchId]/end", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    matchFindUniqueMock.mockReset();
    matchUpdateMock.mockReset();
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    matchFindUniqueMock.mockResolvedValue({ orgId: "org-1", status: "LIVE" });
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

    it("allows OPERATOR to end a match", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "OPERATOR" } });
      matchUpdateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(200);
    });

    it("404s when the match doesn't exist", async () => {
      matchFindUniqueMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(404);
    });

    it("404s when the match belongs to a different org", async () => {
      matchFindUniqueMock.mockResolvedValue({ orgId: "org-2", status: "LIVE" });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(404);
    });

    it("short-circuits with ok: true and no write when the match is already ENDED", async () => {
      matchFindUniqueMock.mockResolvedValue({ orgId: "org-1", status: "ENDED" });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(matchUpdateMock).not.toHaveBeenCalled();
    });

    it("marks a live match ENDED and sets endedAt", async () => {
      matchUpdateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const res = await POST(makePostRequest(), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(matchUpdateMock).toHaveBeenCalledWith({
        where: { id: "m1" },
        data: { status: "ENDED", endedAt: expect.any(Date) },
      });
    });
  });
});
