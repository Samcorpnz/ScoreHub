// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const matchFindManyMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    match: { findMany: (...a: unknown[]) => matchFindManyMock(...a) },
  },
}));

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/orgs/org-1/matches/export${query}`);
}

const params = Promise.resolve({ orgId: "org-1" });

const endedMatch = {
  id: "m-1",
  sport: "netball",
  competition: "Premier",
  homeName: "Sharks",
  visitorName: "Rays",
  scheduledAt: new Date("2026-10-10T01:00:00.000Z"),
  endedAt: new Date("2026-10-10T02:05:00.000Z"),
  state: { home: { score: 42 }, visitor: { score: 39 } },
};

describe("/api/orgs/[orgId]/matches/export", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    getAccountForOrgMock.mockReset();
    matchFindManyMock.mockReset();
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "OPERATOR" } });
    getAccountForOrgMock.mockResolvedValue({ plan: "pro" });
    matchFindManyMock.mockResolvedValue([endedMatch]);
  });

  it("401s when there's no session", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await import("../route");
    expect((await GET(makeRequest(), { params })).status).toBe(401);
  });

  it("401s when the session's activeOrgId doesn't match the route param", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-2", activeRole: "ADMIN" } });
    const { GET } = await import("../route");
    expect((await GET(makeRequest(), { params })).status).toBe(401);
    expect(matchFindManyMock).not.toHaveBeenCalled();
  });

  it("403s on the Free plan without reading any matches", async () => {
    getAccountForOrgMock.mockResolvedValue({ plan: "free" });
    const { GET } = await import("../route");
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Pro or Venue/);
    expect(matchFindManyMock).not.toHaveBeenCalled();
  });

  it("returns ended matches as a CSV attachment", async () => {
    const { GET } = await import("../route");
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="scorehub-results-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(await res.text()).toBe(
      "sport,competition,home,visitor,homeScore,visitorScore,scheduledAt,endedAt,matchId\r\n" +
      "netball,Premier,Sharks,Rays,42,39,2026-10-10T01:00:00.000Z,2026-10-10T02:05:00.000Z,m-1\r\n",
    );
  });

  it("only ever reads this org's ENDED matches, with the dashboard's filters applied", async () => {
    const { GET } = await import("../route");
    await GET(makeRequest("?sport=netball&competition=Premier&q=%20shark%20&status=LIVE&orgId=org-2"), { params });
    expect(matchFindManyMock.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      status: "ENDED",
      sport: "netball",
      competition: "Premier",
      OR: [
        { homeName: { contains: "shark", mode: "insensitive" } },
        { visitorName: { contains: "shark", mode: "insensitive" } },
      ],
    });
  });

  it("returns just the header row when nothing has ended", async () => {
    matchFindManyMock.mockResolvedValue([]);
    const { GET } = await import("../route");
    const res = await GET(makeRequest(), { params });
    expect(await res.text()).toBe("sport,competition,home,visitor,homeScore,visitorScore,scheduledAt,endedAt,matchId\r\n");
  });
});
