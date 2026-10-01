import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AdvancedDisplay from "../page";
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

describe("AdvancedDisplay", () => {
  it("shows two connection badges (header bar + floating) reflecting the same status", () => {
    render(<AdvancedDisplay />);
    const statuses = screen.getAllByTestId("connection-status");
    expect(statuses).toHaveLength(2);
    for (const s of statuses) expect(s).toHaveTextContent("CONNECTING");
  });

  it("falls back to 'SCOREBOARD' in the header when matchName is empty", () => {
    render(<AdvancedDisplay />);
    expect(screen.getByText("SCOREBOARD")).toBeInTheDocument();
  });

  it("shows the actual match name in the header once set", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ matchName: "Semi Final" }), status: "connected", relayUnreachable: false });
    render(<AdvancedDisplay />);
    expect(screen.getByText("Semi Final")).toBeInTheDocument();
    expect(screen.queryByText("SCOREBOARD")).not.toBeInTheDocument();
  });

  it("renders team scores using formatScore", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", score: 33 }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Eagles", score: 27 } }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<AdvancedDisplay />);
    expect(screen.getByText("Sharks")).toBeInTheDocument();
    expect(screen.getByText("Eagles")).toBeInTheDocument();
    expect(screen.getByText("33")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    // e2e/smoke specs read the score through these hooks — keep them stable.
    expect(screen.getByTestId("display-score-home")).toHaveTextContent("33");
    expect(screen.getByTestId("display-score-visitor")).toHaveTextContent("27");
  });

  it("renders timeout dots when a team has timeouts remaining", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, timeouts: 2 } }),
      status: "connected",
      relayUnreachable: false,
    });
    const { container } = render(<AdvancedDisplay />);
    expect(container.querySelectorAll(".rounded-full").length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the on-court player strip when the sport template has no displayStats (basketball)", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({
        sport: "basketball",
        home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", players: [{ number: 7, name: "Kim", onCourt: true, faults: 0, points: 0 }] },
      }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<AdvancedDisplay />);
    expect(screen.getByText("Sharks — On Court")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
  });

  it("renders nothing extra when no players are on court and the sport has no displayStats", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ sport: "basketball" }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<AdvancedDisplay />);
    expect(screen.queryByText(/On Court/)).not.toBeInTheDocument();
  });
});
