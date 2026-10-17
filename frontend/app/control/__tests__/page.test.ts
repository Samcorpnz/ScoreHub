import { describe, it, expect, vi, beforeEach } from "vitest";
import ControlRedirect from "../page";

const { redirectMock } = vi.hoisted(() => ({
  // Like the real redirect(), stop the page at the first call.
  redirectMock: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const visit = (params: Record<string, string | string[] | undefined>) =>
  ControlRedirect({ searchParams: Promise.resolve(params) }).catch(() => undefined);

beforeEach(() => { redirectMock.mockClear(); });

describe("/control", () => {
  it("sends an old ?matchId= link to the match's /control/<matchId> page", async () => {
    await visit({ matchId: "match-1" });
    expect(redirectMock).toHaveBeenCalledWith("/control/match-1");
  });

  it("sends a bare /control, which names no match, to the dashboard", async () => {
    await visit({});
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("encodes the match id into the path", async () => {
    await visit({ matchId: "a/b" });
    expect(redirectMock).toHaveBeenCalledWith("/control/a%2Fb");
  });
});
