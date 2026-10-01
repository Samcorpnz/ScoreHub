import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import RosterControlPage from "../page";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

// Every test in this file uses the same orgId, so without a fresh SWR cache
// per render, a later test would see an earlier test's cached response
// instead of hitting its own fetch mock.
function renderPage() {
  return render(<RosterControlPage />, {
    wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>,
  });
}

const {
  pushMock,
  searchParamsMock,
  useSessionMock,
  useMatchStateMock,
  useControlTokenMock,
  useGraphicsTokenMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsMock: vi.fn(),
  useSessionMock: vi.fn(),
  useMatchStateMock: vi.fn(),
  useControlTokenMock: vi.fn(),
  useGraphicsTokenMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock(),
}));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
}));

vi.mock("../../../hooks/useMatchState", () => ({
  useMatchState: useMatchStateMock,
}));

vi.mock("../../../hooks/useControlToken", () => ({
  useControlToken: useControlTokenMock,
}));

vi.mock("../../../hooks/useGraphicsToken", () => ({
  useGraphicsToken: useGraphicsTokenMock,
}));

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

const player = {
  id: "pl1",
  firstName: "Jamie",
  lastName: "Lee",
  displayName: null,
  externalId: null,
  provider: null,
  photoUrl: null,
  bio: null,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  searchParamsMock.mockReturnValue({ get: () => null });
  useSessionMock.mockReturnValue({ data: { user: { activeRole: "OPERATOR", activeOrgId: "org1" } }, status: "authenticated" });
  useControlTokenMock.mockReturnValue("control-secret");
  useGraphicsTokenMock.mockReturnValue({ token: "graphics-token", status: "ok" });
  useMatchStateMock.mockReturnValue({ state: makeState() });
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("RosterControlPage", () => {
  it("redirects unauthenticated users to login", () => {
    useSessionMock.mockImplementation((opts?: { onUnauthenticated?: () => void }) => {
      opts?.onUnauthenticated?.();
      return { data: null, status: "unauthenticated" };
    });
    renderPage();
    expect(pushMock).toHaveBeenCalledWith("/login?callbackUrl=/control/roster");
  });

  it("shows loading, then the roster once fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ players: [player] })));
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Jamie Lee")).toBeInTheDocument());
    expect(screen.getByText("Roster (1)")).toBeInTheDocument();
  });

  it("shows an empty-roster message when there are no players", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ players: [] })));
    renderPage();
    await waitFor(() => expect(screen.getByText("No players yet — add one above.")).toBeInTheDocument());
  });

  it("shows the upsell (with admin CTA) when the roster endpoint 403s", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "ADMIN", activeOrgId: "org1" } }, status: "authenticated" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    renderPage();
    await waitFor(() => expect(screen.getByText("Unlock Player Photos & Bios")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Add Graphics/ })).toBeInTheDocument();
  });

  it("shows an error message when the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    renderPage();
    await waitFor(() => expect(screen.getByText("Failed to load roster")).toBeInTheDocument());
  });

  it("adds a new player through the modal form", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/orgs/org1/players" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ players: [] }));
      }
      if (url === "/api/orgs/org1/players" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ player: { ...player, id: "pl2" } }));
      }
      return Promise.resolve(jsonResponse({ players: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByText("No players yet — add one above.")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("add-player-button"));
    fireEvent.change(screen.getByTestId("player-form-first-name"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByTestId("player-form-last-name"), { target: { value: "Wong" } });
    fireEvent.click(screen.getByTestId("player-form-save"));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeTruthy();
    });
    const [, postInit] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(postInit.body as string)).toMatchObject({ firstName: "Alex", lastName: "Wong" });
  });

  it("shows a validation error when saving without a first/last name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ players: [] })));
    renderPage();
    await waitFor(() => expect(screen.getByText("No players yet — add one above.")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("add-player-button"));
    fireEvent.click(screen.getByTestId("player-form-save"));
    expect(screen.getByText("First and last name are required")).toBeInTheDocument();
  });

  it("deletes a player after confirming", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve(jsonResponse({}));
      return Promise.resolve(jsonResponse({ players: [player] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByText("Jamie Lee")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Remove"));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(deleteCall?.[0]).toBe("/api/orgs/org1/players/pl1");
    });
  });

  it("lists unmatched live-feed players and links one to an existing roster entry", async () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({
        graphicsFeed: {
          provider: "championdata",
          sport: "netball",
          version: 1,
          capturedAt: new Date().toISOString(),
          stats: { team: { home: {}, visitor: {} }, players: [{ id: "ext1", name: "Casey Fed", team: "home", stats: {} }] },
        },
      }),
    });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Promise.resolve(jsonResponse({}));
      return Promise.resolve(jsonResponse({ players: [player] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByText("Live match — unmatched players")).toBeInTheDocument());
    expect(screen.getByText("Casey Fed")).toBeInTheDocument();

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "pl1" } });
    fireEvent.click(screen.getByText("Link"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patchCall?.[0]).toBe("/api/orgs/org1/players/pl1");
    });
  });
});
