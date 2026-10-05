import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ControlPanel from "../page";
import { DEFAULT_MATCH_STATE } from "../../types";
import type { MatchState } from "@scorehub/types";

const {
  pushMock,
  searchParamsMock,
  signOutMock,
  useSessionMock,
  useMatchStateMock,
  useControlTokenMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsMock: vi.fn(),
  signOutMock: vi.fn(),
  useSessionMock: vi.fn(),
  useMatchStateMock: vi.fn(),
  useControlTokenMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock(),
}));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
  signOut: signOutMock,
}));

vi.mock("../../hooks/useMatchState", () => ({
  useMatchState: useMatchStateMock,
}));

vi.mock("../../hooks/useControlToken", () => ({
  useControlToken: useControlTokenMock,
}));

vi.mock("../../hooks/useSoundCues", () => ({
  useSoundCues: () => ({ cues: [], addCue: vi.fn(), removeCue: vi.fn() }),
  useSoundPlayback: vi.fn(),
}));

vi.mock("../../components/PlanBadge", () => ({
  PlanBadge: () => <div data-testid="plan-badge" />,
}));

vi.mock("../../components/OrgSwitcher", () => ({
  OrgSwitcher: () => <div data-testid="org-switcher" />,
}));

vi.mock("../components/ScoreTab", () => ({
  ScoreTab: ({ state }: { state: MatchState }) => <div data-testid="score-tab">{state.matchName}</div>,
}));
vi.mock("../components/OutputsTab", () => ({
  OutputsTab: ({ matchId }: { matchId?: string }) => <div data-testid="outputs-tab">{matchId ?? "no-match-id"}</div>,
}));
vi.mock("../components/LogosTab", () => ({
  LogosTab: ({ controlToken }: { controlToken: string }) => <div data-testid="logos-tab">{controlToken}</div>,
}));
vi.mock("../components/ThemeTab", () => ({
  ThemeTab: () => <div data-testid="theme-tab" />,
}));
vi.mock("../components/AudioTab", () => ({
  AudioTab: () => <div data-testid="audio-tab" />,
}));
vi.mock("../components/SettingsTab", () => ({
  SettingsTab: ({ matchId, onEnded }: { matchId?: string; onEnded: () => void }) => (
    <div data-testid="settings-tab">
      {matchId ?? "no-match-id"}
      <button data-testid="settings-end" onClick={onEnded}>end</button>
    </div>
  ),
}));

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

function makeMatchStateReturn(overrides: Record<string, unknown> = {}) {
  return {
    state: makeState(),
    status: "connected",
    feedStale: false,
    relayUnreachable: false,
    sendManualUpdate: vi.fn(),
    sendReset: vi.fn(),
    sendUndo: vi.fn(),
    controllerStatus: "granted",
    takeControl: vi.fn(),
    sendCricketBall: vi.fn(),
    sendCricketOverComplete: vi.fn(),
    sendCricketInningsChange: vi.fn(),
    sendCricketDeclare: vi.fn(),
    sendScoreAdjust: vi.fn(),
    sendIndoorCricketWicket: vi.fn(),
    estimateServerNow: () => Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  searchParamsMock.mockReturnValue({ get: () => null });
  useControlTokenMock.mockReturnValue("control-secret");
  useMatchStateMock.mockReturnValue(makeMatchStateReturn());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ControlPanel", () => {
  it("shows a loading state while auth status is loading", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" });
    render(<ControlPanel />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated users to login", () => {
    useSessionMock.mockImplementation((opts?: { onUnauthenticated?: () => void }) => {
      opts?.onUnauthenticated?.();
      return { data: null, status: "unauthenticated" };
    });
    render(<ControlPanel />);
    expect(pushMock).toHaveBeenCalledWith("/login?callbackUrl=/control");
  });

  it("shows a no-access message for VIEWER-role users instead of the panel", () => {
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "VIEWER", name: "Val Viewer" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    expect(screen.getByText(/doesn't have control access/)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders the score tab by default for an authenticated operator", () => {
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "OPERATOR", name: "Sam Operator" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    expect(screen.getByTestId("score-tab")).toBeInTheDocument();
    expect(screen.getByText("Sam Operator")).toBeInTheDocument();
    expect(screen.getByTestId("connection-status")).toHaveTextContent("LIVE");
  });

  it("switches tabs on click, passing matchId through to Outputs/Settings tabs", () => {
    searchParamsMock.mockReturnValue({ get: (k: string) => (k === "matchId" ? "match-42" : null) });
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "ADMIN", name: "Ada Admin" } },
      status: "authenticated",
    });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "outputs" }));
    expect(screen.getByTestId("outputs-tab")).toHaveTextContent("match-42");

    fireEvent.click(screen.getByRole("tab", { name: "settings" }));
    expect(screen.getByTestId("settings-tab")).toHaveTextContent("match-42");

    fireEvent.click(screen.getByRole("tab", { name: "logos" }));
    expect(screen.getByTestId("logos-tab")).toHaveTextContent("control-secret");

    fireEvent.click(screen.getByRole("tab", { name: "audio" }));
    expect(screen.getByTestId("audio-tab")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "theme" }));
    expect(screen.getByTestId("theme-tab")).toBeInTheDocument();
  });

  it("shows an upgrade prompt instead of the logos and theme tabs on the Free plan", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "ADMIN" } }, status: "authenticated" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: "free" }) }));
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "theme" }));
    expect(await screen.findByTestId("branding-upgrade-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-tab")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "logos" }));
    expect(screen.getByTestId("branding-upgrade-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("logos-tab")).not.toBeInTheDocument();
  });

  it("keeps the logos and theme tabs on the Pro plan", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "ADMIN" } }, status: "authenticated" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: "pro" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ControlPanel />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/billing/status"));
    fireEvent.click(screen.getByRole("tab", { name: "theme" }));
    expect(screen.getByTestId("theme-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("branding-upgrade-prompt")).not.toBeInTheDocument();
  });

  it("navigates to /dashboard when SettingsTab reports the match ended", () => {
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "ADMIN", name: "Ada Admin" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "settings" }));
    fireEvent.click(screen.getByTestId("settings-end"));
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("shows the IN CONTROL badge when controllerStatus is granted", () => {
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ controllerStatus: "granted" }));
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "ADMIN", name: "Ada Admin" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    expect(screen.getByText("● IN CONTROL")).toBeInTheDocument();
  });

  it("shows a conflict banner and calls takeControl when 'Take Control' is clicked", () => {
    const takeControl = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ controllerStatus: "conflict", takeControl }));
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "ADMIN", name: "Ada Admin" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    expect(screen.getByTestId("controller-conflict-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("take-control"));
    expect(takeControl).toHaveBeenCalled();
  });

  it("shows a revoked banner and calls takeControl when 'Reclaim Control' is clicked", () => {
    const takeControl = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ controllerStatus: "revoked", takeControl }));
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "ADMIN", name: "Ada Admin" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    expect(screen.getByTestId("controller-revoked-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reclaim-control"));
    expect(takeControl).toHaveBeenCalled();
  });

  it("signs out via next-auth when Sign out is clicked", () => {
    useSessionMock.mockReturnValue({
      data: { user: { activeRole: "ADMIN", name: "Ada Admin" } },
      status: "authenticated",
    });
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
