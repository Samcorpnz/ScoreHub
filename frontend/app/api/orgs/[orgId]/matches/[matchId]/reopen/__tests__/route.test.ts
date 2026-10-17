// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const matchFindUniqueMock = vi.fn();
const matchUpdateMock = vi.fn();
const matchCountMock = vi.fn();
const orgFindUniqueMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: {
      findUnique: (...a: unknown[]) => matchFindUniqueMock(...a),
      update: (...a: unknown[]) => matchUpdateMock(...a),
      count: (...a: unknown[]) => matchCountMock(...a),
    },
    org: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) },
  },
}));

function makePostRequest() {
  return new NextRequest("http://localhost/api/orgs/org-1/matches/m1/reopen", { method: "POST" });
}

const params = Promise.resolve({ orgId: "org-1", matchId: "m1" });

describe("/api/orgs/[orgId]/matches/[matchId]/reopen", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    matchFindUniqueMock.mockReset();
    matchUpdateMock.mockReset();
    matchCountMock.mockReset();
    orgFindUniqueMock.mockReset();
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    matchFindUniqueMock.mockResolvedValue({ orgId: "org-1", status: "ENDED" });
    orgFindUniqueMock.mockResolvedValue({ account: { id: "acct-1", plan: "pro" } });
    matchCountMock.mockResolvedValue(0);
    matchUpdateMock.mockResolvedValue({});
  });

  it("401s when there's no session", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    expect((await POST(makePostRequest(), { params })).status).toBe(401);
  });

  it("401s when the session's activeOrgId doesn't match the route param", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-2", activeRole: "ADMIN" } });
    const { POST } = await import("../route");
    expect((await POST(makePostRequest(), { params })).status).toBe(401);
  });

  it("403s for a VIEWER", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "VIEWER" } });
    const { POST } = await import("../route");
    expect((await POST(makePostRequest(), { params })).status).toBe(403);
  });

  it("404s when the match belongs to a different org", async () => {
    matchFindUniqueMock.mockResolvedValue({ orgId: "org-2", status: "ENDED" });
    const { POST } = await import("../route");
    expect((await POST(makePostRequest(), { params })).status).toBe(404);
  });

  it("does nothing when the match isn't ended", async () => {
    matchFindUniqueMock.mockResolvedValue({ orgId: "org-1", status: "LIVE" });
    const { POST } = await import("../route");
    const res = await POST(makePostRequest(), { params });
    expect(res.status).toBe(200);
    expect(matchUpdateMock).not.toHaveBeenCalled();
  });

  it("puts an ended match back to LIVE and clears endedAt", async () => {
    const { POST } = await import("../route");
    const res = await POST(makePostRequest(), { params });
    expect(res.status).toBe(200);
    expect(matchUpdateMock).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "LIVE", endedAt: null },
    });
  });

  it("lets an OPERATOR reopen a match", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "OPERATOR" } });
    const { POST } = await import("../route");
    expect((await POST(makePostRequest(), { params })).status).toBe(200);
  });

  it("402s on the Free plan while another match is live on the account", async () => {
    orgFindUniqueMock.mockResolvedValue({ account: { id: "acct-1", plan: "free" } });
    matchCountMock.mockResolvedValue(1);
    const { POST } = await import("../route");
    const res = await POST(makePostRequest(), { params });
    expect(res.status).toBe(402);
    expect(matchCountMock).toHaveBeenCalledWith({ where: { status: "LIVE", org: { accountId: "acct-1" } } });
    expect(matchUpdateMock).not.toHaveBeenCalled();
  });

  it("allows a Free plan reopen when nothing else is live", async () => {
    orgFindUniqueMock.mockResolvedValue({ account: { id: "acct-1", plan: "free" } });
    const { POST } = await import("../route");
    expect((await POST(makePostRequest(), { params })).status).toBe(200);
  });
});
