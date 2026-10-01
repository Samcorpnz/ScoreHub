import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { IndoorCricketDisplayStats } from "../IndoorCricketDisplayStats";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { IndoorCricketState, MatchState } from "@scorehub/types";

function makeIndoorCricketState(overrides: Partial<IndoorCricketState> = {}): IndoorCricketState {
  return { sport: "indoor_cricket", wicketPenalty: 5, homeWickets: 2, visitorWickets: 3, oversPerInnings: 16, ...overrides };
}

function makeState(sportState?: IndoorCricketState): MatchState {
  return { ...DEFAULT_MATCH_STATE, sportState } as unknown as MatchState;
}

afterEach(() => cleanup());

describe("IndoorCricketDisplayStats", () => {
  it("renders nothing when the match has no indoor cricket sportState", () => {
    const { container } = render(<IndoorCricketDisplayStats state={DEFAULT_MATCH_STATE as MatchState} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the compact wickets/overs summary", () => {
    const state = makeState(makeIndoorCricketState({ homeWickets: 4, visitorWickets: 1, oversPerInnings: 16, wicketPenalty: 5 }));
    const { container } = render(<IndoorCricketDisplayStats state={state} variant="compact" />);
    expect(container.textContent).toContain("4 / 1 wkts");
    expect(container.textContent).toContain("16 overs");
    expect(container.textContent).toContain("-5 per wicket");
  });

  it("renders the full variant with per-team wicket counts and the overs/penalty line", () => {
    const state = makeState(makeIndoorCricketState({ homeWickets: 6, visitorWickets: 2, oversPerInnings: 12, wicketPenalty: 2 }));
    const { getByText } = render(<IndoorCricketDisplayStats state={state} />);
    expect(getByText("Home Wickets")).toBeInTheDocument();
    expect(getByText("6")).toBeInTheDocument();
    expect(getByText("Visitor Wickets")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
    expect(getByText("Overs / Wicket Penalty")).toBeInTheDocument();
    expect(getByText("12 overs · -2 runs")).toBeInTheDocument();
  });
});
