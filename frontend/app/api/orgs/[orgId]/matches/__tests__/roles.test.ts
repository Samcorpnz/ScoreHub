// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const createManyMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
      createMany: (...a: unknown[]) => createManyMock(...a),
    },
  },
  MatchStatus: {},
}));

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

function signIn(activeRole: string) {
  authMock.mockResolvedValue({ user: { id: "u1", activeOrgId: "org-1", activeRole } });
}

const post = (url: string, body?: unknown) =>
  new NextRequest(url, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });

// Everyone who can score a match can also create, bulk-upload and end one
// (SA-113) — MANAGER was left out when the role was added.
describe("match lifecycle routes — role gating", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    createManyMock.mockReset();
    authMock.mockReset();
    getAccountForOrgMock.mockReset();
    process.env.AUTH_SECRET = "test-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe.each(["ADMIN", "MANAGER", "OPERATOR"])("%s", role => {
    beforeEach(() => signIn(role));

    it("can create a match", async () => {
      const { POST } = await import("../route");
      const res = await POST(post("http://localhost/api/orgs/org-1/matches"), { params: Promise.resolve({ orgId: "org-1" }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "m1" });
    });

    it("can end a match", async () => {
      findUniqueMock.mockResolvedValue({ orgId: "org-1", status: "LIVE" });
      const { POST } = await import("../[matchId]/end/route");
      const res = await POST(post("http://localhost/api/orgs/org-1/matches/m1/end"), { params: Promise.resolve({ orgId: "org-1", matchId: "m1" }) });
      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalled();
    });

    it("gets past the role check on fixture upload", async () => {
      // A free-plan account stops at the plan gate, which sits after the role
      // gate and names the plan — so this message proves the role was accepted.
      getAccountForOrgMock.mockResolvedValue({ plan: "free" });
      const { POST } = await import("../bulk/route");
      const res = await POST(post("http://localhost/api/orgs/org-1/matches/bulk", { fixtures: [] }), { params: Promise.resolve({ orgId: "org-1" }) });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/Pro or Venue plan/);
    });
  });

  describe("VIEWER", () => {
    beforeEach(() => signIn("VIEWER"));

    it("cannot create a match", async () => {
      const { POST } = await import("../route");
      const res = await POST(post("http://localhost/api/orgs/org-1/matches"), { params: Promise.resolve({ orgId: "org-1" }) });
      expect(res.status).toBe(403);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("cannot end a match", async () => {
      const { POST } = await import("../[matchId]/end/route");
      const res = await POST(post("http://localhost/api/orgs/org-1/matches/m1/end"), { params: Promise.resolve({ orgId: "org-1", matchId: "m1" }) });
      expect(res.status).toBe(403);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("cannot upload fixtures", async () => {
      const { POST } = await import("../bulk/route");
      const res = await POST(post("http://localhost/api/orgs/org-1/matches/bulk", { fixtures: [] }), { params: Promise.resolve({ orgId: "org-1" }) });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("forbidden");
      expect(getAccountForOrgMock).not.toHaveBeenCalled();
    });
  });
});
