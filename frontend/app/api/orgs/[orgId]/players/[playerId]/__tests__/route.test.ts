// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const orgFindUniqueMock = vi.fn();
const playerFindUniqueMock = vi.fn();
const playerUpdateMock = vi.fn();
const playerDeleteMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    org: { findUnique: (...a: unknown[]) => orgFindUniqueMock(...a) },
    player: {
      findUnique: (...a: unknown[]) => playerFindUniqueMock(...a),
      update: (...a: unknown[]) => playerUpdateMock(...a),
      delete: (...a: unknown[]) => playerDeleteMock(...a),
    },
  },
}));

function makePatchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orgs/org-1/players/p1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new NextRequest("http://localhost/api/orgs/org-1/players/p1", { method: "DELETE" });
}

const fetchMock = vi.fn();

const params = Promise.resolve({ orgId: "org-1", playerId: "p1" });

describe("/api/orgs/[orgId]/players/[playerId]", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    orgFindUniqueMock.mockReset();
    playerFindUniqueMock.mockReset();
    playerUpdateMock.mockReset();
    playerDeleteMock.mockReset();
    delete process.env.DATABASE_URL;
    process.env.AUTH_SECRET = "test-secret";
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-1" });
  });

  it("401s when there's no session", async () => {
    authMock.mockResolvedValue(null);
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatchRequest({ firstName: "Ann" }), { params });
    expect(res.status).toBe(401);
  });

  it("403s for a role outside ADMIN/MANAGER/OPERATOR", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "VIEWER" } });
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatchRequest({ firstName: "Ann" }), { params });
    expect(res.status).toBe(403);
  });

  describe("PATCH", () => {
    it("404s when the player doesn't exist", async () => {
      playerFindUniqueMock.mockResolvedValue(null);
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ firstName: "Ann" }), { params });
      expect(res.status).toBe(404);
    });

    it("404s when the player belongs to a different org", async () => {
      playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-2" });
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ firstName: "Ann" }), { params });
      expect(res.status).toBe(404);
    });

    it("treats unparseable JSON as an empty patch (no patchable fields present) rather than erroring", async () => {
      playerUpdateMock.mockResolvedValue({ id: "p1" });
      const { PATCH } = await import("../route");
      const req = new NextRequest("http://localhost/api/orgs/org-1/players/p1", {
        method: "PATCH",
        body: "not json",
      });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(200);
      expect(playerUpdateMock).toHaveBeenCalledWith({ where: { id: "p1" }, data: {} });
    });

    it("400s when a present field is not a string or null", async () => {
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ firstName: 42 }), { params });
      expect(res.status).toBe(400);
    });

    it("400s when a field exceeds its max length", async () => {
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ bio: "x".repeat(1001) }), { params });
      expect(res.status).toBe(400);
    });

    it("400s when photoUrl isn't a /player-photos/ path or https URL", async () => {
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ photoUrl: "http://insecure.example/x.png" }), { params });
      expect(res.status).toBe(400);
    });

    it("accepts a valid /player-photos/ photoUrl", async () => {
      playerUpdateMock.mockResolvedValue({ id: "p1", photoUrl: "/player-photos/p1.jpg" });
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ photoUrl: "/player-photos/p1.jpg" }), { params });
      expect(res.status).toBe(200);
    });

    it("400s when firstName is patched to an empty string", async () => {
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ firstName: "   " }), { params });
      expect(res.status).toBe(400);
    });

    it("400s when lastName is patched to an empty string", async () => {
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ lastName: "" }), { params });
      expect(res.status).toBe(400);
    });

    it("clears a field to null by sending null explicitly", async () => {
      playerUpdateMock.mockResolvedValue({ id: "p1", externalId: null });
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ externalId: null }), { params });
      expect(res.status).toBe(200);
      expect(playerUpdateMock).toHaveBeenCalledWith({ where: { id: "p1" }, data: { externalId: null } });
    });

    it("only patches fields present in the body", async () => {
      playerUpdateMock.mockResolvedValue({ id: "p1" });
      const { PATCH } = await import("../route");
      await PATCH(makePatchRequest({ bio: "New bio" }), { params });
      expect(playerUpdateMock).toHaveBeenCalledWith({ where: { id: "p1" }, data: { bio: "New bio" } });
    });

    it("409s on a duplicate provider/externalId (Prisma P2002)", async () => {
      playerUpdateMock.mockRejectedValue({ code: "P2002" });
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ provider: "championdata", externalId: "42" }), { params });
      expect(res.status).toBe(409);
    });

    it("rethrows an unrelated database error", async () => {
      playerUpdateMock.mockRejectedValue(new Error("connection lost"));
      const { PATCH } = await import("../route");
      await expect(PATCH(makePatchRequest({ bio: "x" }), { params })).rejects.toThrow("connection lost");
    });
  });

  describe("DELETE", () => {
    it("404s when the player doesn't exist", async () => {
      playerFindUniqueMock.mockResolvedValue(null);
      const { DELETE } = await import("../route");
      const res = await DELETE(makeDeleteRequest(), { params });
      expect(res.status).toBe(404);
    });

    it("404s when the player belongs to a different org", async () => {
      playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-2" });
      const { DELETE } = await import("../route");
      const res = await DELETE(makeDeleteRequest(), { params });
      expect(res.status).toBe(404);
    });

    it("deletes the player and returns status: removed", async () => {
      playerDeleteMock.mockResolvedValue({});
      const { DELETE } = await import("../route");
      const res = await DELETE(makeDeleteRequest(), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "removed" });
      expect(playerDeleteMock).toHaveBeenCalledWith({ where: { id: "p1" } });
    });

    it("deletes the stored photo through the relay before the player", async () => {
      playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-1", photoUrl: "/player-photos/org-1/p1.png" });
      playerDeleteMock.mockResolvedValue({});
      const { DELETE } = await import("../route");
      const res = await DELETE(makeDeleteRequest(), { params });
      expect(res.status).toBe(200);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/player-photo\/p1$/);
      expect(init.method).toBe("DELETE");
      expect(init.headers["x-control-secret"]).toEqual(expect.any(String));
    });

    it("keeps the player when their photo couldn't be removed", async () => {
      playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-1", photoUrl: "/player-photos/org-1/p1.png" });
      fetchMock.mockResolvedValue({ ok: false });
      const { DELETE } = await import("../route");
      const res = await DELETE(makeDeleteRequest(), { params });
      expect(res.status).toBe(502);
      expect(playerDeleteMock).not.toHaveBeenCalled();
    });

    it("still removes a player with no photo when the relay is unreachable", async () => {
      fetchMock.mockRejectedValue(new Error("down"));
      playerDeleteMock.mockResolvedValue({});
      const { DELETE } = await import("../route");
      const res = await DELETE(makeDeleteRequest(), { params });
      expect(res.status).toBe(200);
      expect(playerDeleteMock).toHaveBeenCalled();
    });
  });

  describe("PATCH photoUrl: null", () => {
    it("deletes the stored photo, then clears photoUrl", async () => {
      playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-1", photoUrl: "/player-photos/org-1/p1.png" });
      playerUpdateMock.mockResolvedValue({ id: "p1", photoUrl: null });
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ photoUrl: null }), { params });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(playerUpdateMock).toHaveBeenCalledWith({ where: { id: "p1" }, data: { photoUrl: null } });
    });

    it("leaves photoUrl alone when the file couldn't be removed", async () => {
      playerFindUniqueMock.mockResolvedValue({ id: "p1", orgId: "org-1", photoUrl: "/player-photos/org-1/p1.png" });
      fetchMock.mockResolvedValue({ ok: false });
      const { PATCH } = await import("../route");
      const res = await PATCH(makePatchRequest({ photoUrl: null }), { params });
      expect(res.status).toBe(502);
      expect(playerUpdateMock).not.toHaveBeenCalled();
    });

    it("doesn't call the relay for an ordinary edit", async () => {
      playerUpdateMock.mockResolvedValue({ id: "p1" });
      const { PATCH } = await import("../route");
      await PATCH(makePatchRequest({ firstName: "Ann" }), { params });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
