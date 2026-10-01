import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ScorebugPage from "../page";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

const { useMatchStateMock, searchParamsMock } = vi.hoisted(() => ({
  useMatchStateMock: vi.fn(),
  searchParamsMock: vi.fn(),
}));

vi.mock("../../../hooks/useMatchState", () => ({
  useMatchState: useMatchStateMock,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock(),
}));

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

function params(map: Record<string, string> = {}) {
  return { get: (key: string) => map[key] ?? null };
}

beforeEach(() => {
  searchParamsMock.mockReturnValue(params());
  useMatchStateMock.mockReturnValue({ state: makeState() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScorebugPage", () => {
  it("renders team scores with fallback names by default", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "" }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "" } }),
    });
    render(<ScorebugPage />);
    expect(screen.getByText("HOME")).toBeInTheDocument();
    expect(screen.getByText("VISITOR")).toBeInTheDocument();
  });

  it("renders actual team names and scores when set", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", score: 5 }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Eagles", score: 3 } }),
    });
    render(<ScorebugPage />);
    expect(screen.getByText("Sharks")).toBeInTheDocument();
    expect(screen.getByText("Eagles")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // e2e/smoke specs read the score through these hooks — keep them stable.
    expect(screen.getByTestId("display-score-home")).toHaveTextContent("5");
    expect(screen.getByTestId("display-score-visitor")).toHaveTextContent("3");
  });

  it("shows initials instead of a logo image when no logoUrl is set", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks", logoUrl: "" } }),
    });
    render(<ScorebugPage />);
    expect(screen.getByText("SHA")).toBeInTheDocument();
  });

  it("shows PAUSED text when the clock is stopped", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ isRunning: false, periodBreak: false }) });
    render(<ScorebugPage />);
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
  });

  it("reads the position and size params without throwing (bottom-left, small)", () => {
    searchParamsMock.mockReturnValue(params({ position: "bl", size: "sm" }));
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "" } }),
    });
    render(<ScorebugPage />);
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  it("shows EXTRA as the period text when period is 'E'", () => {
    useMatchStateMock.mockReturnValue({ state: makeState({ period: "E", periodBreak: false }) });
    render(<ScorebugPage />);
    expect(screen.getByText("EXTRA")).toBeInTheDocument();
  });
});
