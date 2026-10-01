import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SoftballDisplayStats } from "../SoftballDisplayStats";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState, SoftballState } from "@scorehub/types";

function makeSoftballState(overrides: Partial<SoftballState> = {}): SoftballState {
  return { sport: "softball", format: "fastpitch", inningHalf: "top", outs: 1, balls: 2, strikes: 1, ...overrides };
}

function makeState(sportState?: SoftballState): MatchState {
  return { ...DEFAULT_MATCH_STATE, sportState } as unknown as MatchState;
}

afterEach(() => cleanup());

describe("SoftballDisplayStats", () => {
  it("renders nothing when the match has no softball sportState", () => {
    const { container } = render(<SoftballDisplayStats state={DEFAULT_MATCH_STATE as MatchState} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the compact count/outs summary, pluralizing 'outs' for non-1 counts", () => {
    const state = makeState(makeSoftballState({ balls: 3, strikes: 2, outs: 2 }));
    const { container } = render(<SoftballDisplayStats state={state} variant="compact" />);
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("2 outs");
  });

  it("uses the singular 'out' when there is exactly one out", () => {
    const state = makeState(makeSoftballState({ outs: 1 }));
    const { container } = render(<SoftballDisplayStats state={state} variant="compact" />);
    expect(container.textContent).toContain("1 out");
    expect(container.textContent).not.toContain("1 outs");
  });

  it("renders the full variant with count, outs, and format", () => {
    const state = makeState(makeSoftballState({ balls: 1, strikes: 0, outs: 0, format: "slowpitch" }));
    const { getByText } = render(<SoftballDisplayStats state={state} />);
    expect(getByText("Count")).toBeInTheDocument();
    expect(getByText("Outs")).toBeInTheDocument();
    expect(getByText("Format")).toBeInTheDocument();
    expect(getByText("slowpitch")).toBeInTheDocument();
  });
});
