import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import BasicDisplay from "../page";
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
  useMatchStateMock.mockReturnValue({ state: makeState(), status: "connecting", relayUnreachable: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BasicDisplay", () => {
  it("shows CONNECTING before the first matchStateChange arrives", () => {
    render(<BasicDisplay />);
    expect(screen.getAllByTestId("connection-status")[0]).toHaveTextContent("CONNECTING");
  });

  it("renders team names, scores and the match name once connected", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({
        matchName: "Final",
        home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", score: 21 },
        visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Eagles", score: 18 },
      }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<BasicDisplay />);
    expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
    expect(screen.getByText("Sharks")).toBeInTheDocument();
    expect(screen.getByText("Eagles")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    // e2e/smoke specs read the score through these hooks — keep them stable.
    expect(screen.getByTestId("display-score-home")).toHaveTextContent("21");
    expect(screen.getByTestId("display-score-visitor")).toHaveTextContent("18");
  });

  it("does not render a match-name label when matchName is empty", () => {
    render(<BasicDisplay />);
    expect(screen.queryByText("SCOREBOARD")).not.toBeInTheDocument();
  });

  it("renders sport-specific display stats when the sport template provides one (netball)", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ sport: "netball" }),
      status: "connected",
      relayUnreachable: false,
    });
    const { container } = render(<BasicDisplay />);
    // NetballDisplayStats renders inside an extra wrapper only when present
    expect(container.querySelectorAll(".rounded-2xl").length).toBeGreaterThan(1);
  });

  it("shows the input source line when a hardware source is feeding the match", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ inputSource: "saturn" }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<BasicDisplay />);
    expect(screen.getByText("Source: saturn")).toBeInTheDocument();
  });

  it("hides the input source line when there is no hardware source", () => {
    render(<BasicDisplay />);
    expect(screen.queryByText(/Source:/)).not.toBeInTheDocument();
  });

  it("shows RELAY UNREACHABLE when the relay has been down past the threshold", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState(),
      status: "disconnected",
      relayUnreachable: true,
    });
    render(<BasicDisplay />);
    expect(screen.getAllByTestId("connection-relay-unreachable")[0]).toBeInTheDocument();
  });
});
