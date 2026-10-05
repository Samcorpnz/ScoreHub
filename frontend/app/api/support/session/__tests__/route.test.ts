// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

function makeRequest(origin?: string) {
  return new NextRequest("https://app.scorehub.co.nz/api/support/session", {
    headers: origin ? { origin } : {},
  });
}

describe("GET /api/support/session", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
  });

  it("returns the signed-in user and their active organisation to the paired help site", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u1",
        name: "Ana",
        email: "ana@example.test",
        activeOrgId: "org-2",
        memberships: [
          { orgId: "org-1", orgName: "First Club", role: "ADMIN" },
          { orgId: "org-2", orgName: "Second Club", role: "OPERATOR" },
        ],
      },
    });
    const { GET } = await import("../route");
    const res = await GET(makeRequest("https://help.scorehub.co.nz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { name: "Ana", email: "ana@example.test", organisation: "Second Club" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://help.scorehub.co.nz");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("returns user: null when signed out", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(makeRequest("https://help.scorehub.co.nz"));
    expect(await res.json()).toEqual({ user: null });
  });

  it("403s for any other origin, without consulting the session", async () => {
    const { GET } = await import("../route");
    for (const origin of ["https://evil.example", "https://help.uat.scorehub.co.nz", "https://scorehub.co.nz"]) {
      const res = await GET(makeRequest(origin));
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(authMock).not.toHaveBeenCalled();
  });
});
