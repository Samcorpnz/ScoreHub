import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MobileControl from "../page";
import { DEFAULT_MATCH_STATE, formatClock } from "../../../types";
import type { MatchState } from "@scorehub/types";

const {
  pushMock,
  useSessionMock,
  useMatchStateMock,
  useControlTokenMock,
  searchParams,
} = vi.hoisted(() => ({
  searchParams: { current: new URLSearchParams() },
  pushMock: vi.fn(),
  useSessionMock: vi.fn(),
  useMatchStateMock: vi.fn(),
  useControlTokenMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams.current,
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

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

function makeMatchStateReturn(overrides: Record<string, unknown> = {}) {
  const sendManualUpdate = vi.fn();
  return {
    state: makeState(),
    status: "connected",
    feedStale: false,
    relayUnreachable: false,
    sendManualUpdate,
    sendReset: vi.fn(),
    sendUndo: vi.fn(),
    sendScoreAdjust: vi.fn(),
    controllerStatus: "granted",
    takeControl: vi.fn(),
    estimateServerNow: () => Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  searchParams.current = new URLSearchParams();
  useControlTokenMock.mockReturnValue("mobile-secret");
  useSessionMock.mockReturnValue({ data: { user: { name: "Op" } }, status: "authenticated" });
  useMatchStateMock.mockReturnValue(makeMatchStateReturn());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("MobileControl", () => {
  it("redirects unauthenticated users to the mobile-specific login callback", () => {
    useSessionMock.mockImplementation((opts?: { onUnauthenticated?: () => void }) => {
      opts?.onUnauthenticated?.();
      return { data: null, status: "unauthenticated" };
    });
    render(<MobileControl />);
    expect(pushMock).toHaveBeenCalledWith("/login?callbackUrl=/control/mobile");
  });

  it("renders team names, scores, and the connection status", () => {
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", score: 12 }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Eagles", score: 9 } }),
    }));
    render(<MobileControl />);
    expect(screen.getByText("Sharks")).toBeInTheDocument();
    expect(screen.getByText("Eagles")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByTestId("connection-status")).toHaveTextContent("LIVE");
  });

  it("shows START when stopped and toggles isRunning with a click", () => {
    const sendManualUpdate = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({
      state: makeState({ isRunning: false }),
      sendManualUpdate,
    }));
    render(<MobileControl />);
    const btn = screen.getByText(/START/);
    fireEvent.click(btn);
    expect(sendManualUpdate).toHaveBeenCalledWith(expect.objectContaining({ isRunning: true }));
  });

  it("shows STOP when running", () => {
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ state: makeState({ isRunning: true }) }));
    render(<MobileControl />);
    expect(screen.getByText(/STOP/)).toBeInTheDocument();
  });

  it("scores with a delta event, not an absolute score, so rapid taps can't coalesce", () => {
    const sendManualUpdate = vi.fn();
    const sendScoreAdjust = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({
      state: makeState({ sport: "netball", home: { ...DEFAULT_MATCH_STATE.home, score: 0 } }),
      sendManualUpdate,
      sendScoreAdjust,
    }));
    render(<MobileControl />);
    // netball's increments are [1, 2] — first "+1" is home, second is visitor
    const plusOneButtons = screen.getAllByText("+1");
    fireEvent.click(plusOneButtons[0]);
    fireEvent.click(plusOneButtons[1]);
    expect(sendScoreAdjust).toHaveBeenNthCalledWith(1, { side: "home", delta: 1 });
    expect(sendScoreAdjust).toHaveBeenNthCalledWith(2, { side: "visitor", delta: 1 });
    expect(sendManualUpdate).not.toHaveBeenCalled();
  });

  it("scopes the control token and the full-panel link to the match in the URL (SA-144)", () => {
    searchParams.current = new URLSearchParams("matchId=m-42");
    render(<MobileControl />);
    expect(useControlTokenMock).toHaveBeenCalledWith("m-42");
    expect(screen.getByText("Full panel ↗")).toHaveAttribute("href", "/control?matchId=m-42");
  });

  it("falls back to the org's default match when no matchId is given", () => {
    render(<MobileControl />);
    expect(useControlTokenMock).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("Full panel ↗")).toHaveAttribute("href", "/control");
  });

  it("shows IN CONTROL when this panel holds the controller lock", () => {
    render(<MobileControl />);
    expect(screen.getByTestId("mobile-controller-status")).toHaveTextContent("IN CONTROL");
    expect(screen.queryByTestId("take-control")).not.toBeInTheDocument();
  });

  it("shows VIEWING ONLY with a Take Control button when another panel has control", () => {
    const takeControl = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ controllerStatus: "conflict", takeControl }));
    render(<MobileControl />);
    expect(screen.getByTestId("mobile-controller-status")).toHaveTextContent("VIEWING ONLY");
    fireEvent.click(screen.getByTestId("take-control"));
    expect(takeControl).toHaveBeenCalled();
  });

  it("sends an undo", () => {
    const sendUndo = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ sendUndo }));
    render(<MobileControl />);
    fireEvent.click(screen.getByText(/Undo/));
    expect(sendUndo).toHaveBeenCalled();
  });

  it("labels periods from the sport template rather than a hard-coded Q", () => {
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ state: makeState({ sport: "volleyball", period: "2" }) }));
    render(<MobileControl />);
    expect(screen.getByText("◀ SET 1")).toBeInTheDocument();
    expect(screen.getByText("SET 3 ▶")).toBeInTheDocument();
  });

  it("opens the set-time panel and applies a preset clock value", () => {
    const sendManualUpdate = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ sendManualUpdate }));
    render(<MobileControl />);
    fireEvent.click(screen.getByText(/Time/));
    fireEvent.click(screen.getByText("10m"));
    expect(sendManualUpdate).toHaveBeenCalledWith(expect.objectContaining({ clockSeconds: 600, isRunning: false }));
  });

  it("confirms before sending a reset", () => {
    const sendReset = vi.fn();
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ sendReset }));
    render(<MobileControl />);
    fireEvent.click(screen.getByText("Reset Match"));
    expect(globalThis.confirm).toHaveBeenCalled();
    expect(sendReset).toHaveBeenCalled();
  });

  it("displays the formatted clock value", () => {
    useMatchStateMock.mockReturnValue(makeMatchStateReturn({ state: makeState({ clockSeconds: 125, isRunning: false }) }));
    render(<MobileControl />);
    expect(screen.getByText(formatClock(125))).toBeInTheDocument();
  });
});
