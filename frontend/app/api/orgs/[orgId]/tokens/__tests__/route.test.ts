// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const matchFindUniqueMock = vi.fn();
const tokenCreateMock = vi.fn();
const tokenFindManyMock = vi.fn();
const orgFindUniqueMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: { findUnique: (...a: unknown[]) => matchFindUniqueMock(...a) },
    org: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) },
    scopedToken: {
      create: (...a: unknown[]) => tokenCreateMock(...a),
      findMany: (...a: unknown[]) => tokenFindManyMock(...a),
    },
  },
}));

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orgs/org-1/tokens", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeGetRequest() {
  return new NextRequest("http://localhost/api/orgs/org-1/tokens");
}

const params = Promise.resolve({ orgId: "org-1" });

describe("/api/orgs/[orgId]/tokens", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    matchFindUniqueMock.mockReset();
    tokenCreateMock.mockReset();
    tokenFindManyMock.mockReset();
    orgFindUniqueMock.mockReset();
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    // BRIDGE (the default type) and DATA_FEED tokens need the data-feed add-on
    orgFindUniqueMock.mockResolvedValue({ account: { addOns: ["data-feed"] } });
  });

  describe("POST", () => {
    it("401s when there's no session", async () => {
      authMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({}), { params });
      expect(res.status).toBe(401);
    });

    it("401s when the session's activeOrgId doesn't match the route param", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-2", activeRole: "ADMIN" } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({}), { params });
      expect(res.status).toBe(401);
    });

    it("403s for a role outside ADMIN/MANAGER", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "OPERATOR" } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({}), { params });
      expect(res.status).toBe(403);
    });

    it("handles unparseable JSON as an empty body (defaults apply)", async () => {
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const req = new NextRequest("http://localhost/api/orgs/org-1/tokens", { method: "POST", body: "not json" });
      const res = await POST(req, { params });
      expect(res.status).toBe(201);
    });

    it("404s when matchId is provided but the match doesn't exist", async () => {
      matchFindUniqueMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ matchId: "m1" }), { params });
      expect(res.status).toBe(404);
    });

    it("404s when matchId belongs to a different org", async () => {
      matchFindUniqueMock.mockResolvedValue({ orgId: "org-2" });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ matchId: "m1" }), { params });
      expect(res.status).toBe(404);
    });

    it("creates a BRIDGE token by default and returns the plaintext with 201", async () => {
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ label: "Venue laptop" }), { params });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(typeof body.token).toBe("string");
      expect(body.token).toHaveLength(64);
      expect(tokenCreateMock).toHaveBeenCalledWith({
        data: {
          orgId: "org-1",
          matchId: undefined,
          type: "BRIDGE",
          tokenHash: expect.any(String),
          label: "Venue laptop",
        },
      });
    });

    it("creates a CONTROL token when type: CONTROL is specified", async () => {
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      await POST(makePostRequest({ type: "CONTROL" }), { params });
      expect(tokenCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "CONTROL" }) }),
      );
    });

    it("scopes the token to a valid matchId in the same org", async () => {
      matchFindUniqueMock.mockResolvedValue({ orgId: "org-1" });
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ matchId: "m1" }), { params });
      expect(res.status).toBe(201);
      expect(tokenCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchId: "m1" }) }),
      );
    });

    it("truncates an overlong label to 100 characters", async () => {
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      await POST(makePostRequest({ label: "L".repeat(150) }), { params });
      const call = tokenCreateMock.mock.calls[0][0];
      expect(call.data.label).toHaveLength(100);
    });

    it("403s when creating a BRIDGE token for an org without the data-feed add-on (SA-114)", async () => {
      orgFindUniqueMock.mockResolvedValue({ account: { addOns: [] } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({}), { params });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/data-feed add-on/);
      expect(tokenCreateMock).not.toHaveBeenCalled();
    });

    it("creates a CONTROL token without the data-feed add-on", async () => {
      orgFindUniqueMock.mockResolvedValue({ account: { addOns: [] } });
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ type: "CONTROL" }), { params });
      expect(res.status).toBe(201);
    });

    it("403s when creating a DATA_FEED token for an org without the data-feed add-on", async () => {
      orgFindUniqueMock.mockResolvedValue({ account: { addOns: [] } });
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ type: "DATA_FEED" }), { params });
      expect(res.status).toBe(403);
      expect(tokenCreateMock).not.toHaveBeenCalled();
    });

    it("creates a DATA_FEED token when the org has the data-feed add-on", async () => {
      orgFindUniqueMock.mockResolvedValue({ account: { addOns: ["data-feed"] } });
      tokenCreateMock.mockResolvedValue({});
      const { POST } = await import("../route");
      const res = await POST(makePostRequest({ type: "DATA_FEED" }), { params });
      expect(res.status).toBe(201);
      expect(tokenCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "DATA_FEED" }) }),
      );
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

    it("returns this org's tokens", async () => {
      const tokens = [{ id: "tok-1", label: "Venue laptop", type: "BRIDGE" }];
      tokenFindManyMock.mockResolvedValue(tokens);
      const { GET } = await import("../route");
      const res = await GET(makeGetRequest(), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ tokens });
      expect(tokenFindManyMock).toHaveBeenCalledWith({
        where: { orgId: "org-1" },
        select: { id: true, label: true, type: true, matchId: true, createdAt: true, revokedAt: true },
        orderBy: { createdAt: "desc" },
      });
    });
  });
});
