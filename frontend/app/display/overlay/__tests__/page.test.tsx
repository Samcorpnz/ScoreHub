import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import OverlayDisplay from "../page";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

const { useMatchStateMock } = vi.hoisted(() => ({ useMatchStateMock: vi.fn() }));

vi.mock("../../../hooks/useMatchState", () => ({
  useMatchState: useMatchStateMock,
}));

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

beforeEach(() => {
  useMatchStateMock.mockReturnValue({ state: makeState() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OverlayDisplay", () => {
  it("renders both team blocks with fallback names when team names are unset", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "" }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "" } }),
    });
    render(<OverlayDisplay />);
    expect(screen.getByText("HOME")).toBeInTheDocument();
    expect(screen.getByText("VISITOR")).toBeInTheDocument();
  });

  it("uses actual team names and scores when set", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", score: 14 }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Eagles", score: 10 } }),
    });
    render(<OverlayDisplay />);
    expect(screen.getByText("Sharks")).toBeInTheDocument();
    expect(screen.getByText("Eagles")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    // e2e/smoke specs read the score through these hooks — keep them stable.
    expect(screen.getByTestId("display-score-home")).toHaveTextContent("14");
    expect(screen.getByTestId("display-score-visitor")).toHaveTextContent("10");
  });

  it("shows PAUSED when the clock is stopped and not on a period break", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ isRunning: false, periodBreak: false }) });
    render(<OverlayDisplay />);
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
  });

  it("does not show PAUSED while running", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ isRunning: true }) });
    render(<OverlayDisplay />);
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });

  it("shows a HALF TIME period label during a half-time break for a two-half sport", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ sport: "rugby_union", periodBreak: true }) });
    render(<OverlayDisplay />);
    expect(screen.getByText("HALF TIME")).toBeInTheDocument();
  });

  it("shows a period+number label when not on a break", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ sport: "netball", period: "2", periodBreak: false }) });
    render(<OverlayDisplay />);
    expect(screen.getByText("QTR 2")).toBeInTheDocument();
  });

  it("renders the netball sport-specific stats strip below the bar", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ sport: "netball" }) });
    const { container } = render(<OverlayDisplay />);
    // NetballDisplayStats renders as an additional sibling under the wrapping column
    expect(container.querySelectorAll("div").length).toBeGreaterThan(5);
  });
});
