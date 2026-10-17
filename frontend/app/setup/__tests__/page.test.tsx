import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SetupPage from "../page";

const { pushMock, useSessionMock, signOutMock, useControlTokenMock, useMatchStateMock, sendManualUpdateMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  useControlTokenMock: vi.fn(),
  useMatchStateMock: vi.fn(),
  sendManualUpdateMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
  signOut: signOutMock,
}));

vi.mock("../../components/PlanBadge", () => ({ PlanBadge: () => <div data-testid="plan-badge" /> }));
vi.mock("../../components/OrgSwitcher", () => ({ OrgSwitcher: () => <div data-testid="org-switcher" /> }));

vi.mock("../../hooks/useControlToken", () => ({
  useControlToken: (...args: unknown[]) => useControlTokenMock(...args),
}));
vi.mock("../../hooks/useMatchState", () => ({
  useMatchState: (...args: unknown[]) => useMatchStateMock(...args),
}));

const authedSession = {
  data: { user: { name: "Sam Kerins", activeOrgId: "org-1" } },
  status: "authenticated" as const,
};

beforeEach(() => {
  useControlTokenMock.mockReturnValue("");
  useMatchStateMock.mockReturnValue({
    state: { home: { name: "" }, visitor: { name: "" } },
    status: "connecting",
    sendManualUpdate: sendManualUpdateMock,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SetupPage", () => {
  it("shows a loading state while the session is resolving", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" });
    render(<SetupPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", () => {
    useSessionMock.mockImplementation((opts?: { onUnauthenticated?: () => void }) => {
      opts?.onUnauthenticated?.();
      return { data: null, status: "unauthenticated" };
    });
    render(<SetupPage />);
    expect(pushMock).toHaveBeenCalledWith("/login?callbackUrl=/setup");
  });

  it("disables submit and shows field errors until match/home/visitor names are filled in", () => {
    useSessionMock.mockReturnValue(authedSession);
    render(<SetupPage />);

    fireEvent.blur(screen.getByTestId("setup-match-name"));
    fireEvent.blur(screen.getByTestId("setup-home-name"));
    fireEvent.blur(screen.getByTestId("setup-visitor-name"));

    expect(screen.getByText("Match name is required")).toBeInTheDocument();
    expect(screen.getByText("Home team name is required")).toBeInTheDocument();
    expect(screen.getByText("Visitor team name is required")).toBeInTheDocument();
    expect(screen.getByTestId("setup-submit")).toBeDisabled();
  });

  it("lets the operator pick a different sport tile", () => {
    useSessionMock.mockReturnValue(authedSession);
    render(<SetupPage />);
    fireEvent.click(screen.getByTestId("sport-tile-basketball"));
    // Selecting basketball re-renders the tile with the "selected" styling —
    // just assert the click didn't throw and the tile is still present.
    expect(screen.getByTestId("sport-tile-basketball")).toBeInTheDocument();
  });

  it("provisions a match and applies the manual update once the socket connects", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "match-123" }) })
    );
    sendManualUpdateMock.mockResolvedValue(undefined);
    useMatchStateMock.mockReturnValue({
      state: { home: { name: "" }, visitor: { name: "" } },
      status: "connected",
      sendManualUpdate: sendManualUpdateMock,
    });

    render(<SetupPage />);
    fireEvent.change(screen.getByTestId("setup-match-name"), { target: { value: "Round 1" } });
    fireEvent.change(screen.getByTestId("setup-home-name"), { target: { value: "Sharks" } });
    fireEvent.change(screen.getByTestId("setup-visitor-name"), { target: { value: "Magic" } });
    fireEvent.click(screen.getByTestId("setup-submit"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/orgs/org-1/matches", { method: "POST" })
    );
    await waitFor(() => expect(sendManualUpdateMock).toHaveBeenCalled());
    const payload = sendManualUpdateMock.mock.calls[0][0];
    expect(payload.matchName).toBe("Round 1");
    expect(payload.home.name).toBe("Sharks");
    expect(payload.visitor.name).toBe("Magic");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/control/match-123"));
  });

  it("shows an upgrade-required message on a 402 response", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 402, ok: false, json: async () => ({ error: "Upgrade to add more matches." }) })
    );

    render(<SetupPage />);
    fireEvent.change(screen.getByTestId("setup-match-name"), { target: { value: "Round 1" } });
    fireEvent.change(screen.getByTestId("setup-home-name"), { target: { value: "Sharks" } });
    fireEvent.change(screen.getByTestId("setup-visitor-name"), { target: { value: "Magic" } });
    fireEvent.click(screen.getByTestId("setup-submit"));

    expect(await screen.findByText("Upgrade to add more matches.")).toBeInTheDocument();
    expect(screen.getByText("Upgrade plan").closest("a")).toHaveAttribute("href", "/account/billing");
  });

  it("shows a generic error when match creation fails", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => ({}) })
    );

    render(<SetupPage />);
    fireEvent.change(screen.getByTestId("setup-match-name"), { target: { value: "Round 1" } });
    fireEvent.change(screen.getByTestId("setup-home-name"), { target: { value: "Sharks" } });
    fireEvent.change(screen.getByTestId("setup-visitor-name"), { target: { value: "Magic" } });
    fireEvent.click(screen.getByTestId("setup-submit"));

    expect(await screen.findByText("Couldn't set up your match — try again.")).toBeInTheDocument();
  });

  it("shows a network-error message when the request throws", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<SetupPage />);
    fireEvent.change(screen.getByTestId("setup-match-name"), { target: { value: "Round 1" } });
    fireEvent.change(screen.getByTestId("setup-home-name"), { target: { value: "Sharks" } });
    fireEvent.change(screen.getByTestId("setup-visitor-name"), { target: { value: "Magic" } });
    fireEvent.click(screen.getByTestId("setup-submit"));

    expect(await screen.findByText("Couldn't reach the scoring service — try again.")).toBeInTheDocument();
  });

  it("routes cricket to the squad-entry step instead of submitting immediately", () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn());
    render(<SetupPage />);

    fireEvent.click(screen.getByTestId("sport-tile-cricket"));
    fireEvent.change(screen.getByTestId("setup-match-name"), { target: { value: "Round 1" } });
    fireEvent.change(screen.getByTestId("setup-home-name"), { target: { value: "Sharks" } });
    fireEvent.change(screen.getByTestId("setup-visitor-name"), { target: { value: "Magic" } });
    expect(screen.getByTestId("setup-submit")).toHaveTextContent("Next: Squads →");

    fireEvent.click(screen.getByTestId("setup-submit"));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("squad-submit")).toBeInTheDocument();
  });

  it("signs out and redirects to /login", () => {
    useSessionMock.mockReturnValue(authedSession);
    render(<SetupPage />);
    fireEvent.click(screen.getByText("Sign out"));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
