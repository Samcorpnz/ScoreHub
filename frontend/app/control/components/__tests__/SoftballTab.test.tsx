import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SoftballTab } from "../SoftballTab";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, sport: "softball", ...overrides } as MatchState;
}

function makeHandlers() {
  return {
    push: vi.fn(),
    sendReset: vi.fn(),
    sendUndo: vi.fn(),
    sendCricketBall: vi.fn(),
    sendCricketOverComplete: vi.fn(),
    sendCricketInningsChange: vi.fn(),
    sendCricketDeclare: vi.fn(),
    sendScoreAdjust: vi.fn(),
    sendIndoorCricketWicket: vi.fn(),
  };
}

describe("SoftballTab", () => {
  it("renders the start/stop button reflecting isRunning and toggles it", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState({ isRunning: false })} {...handlers} />);
    const btn = screen.getByTestId("score-start-stop");
    expect(btn).toHaveTextContent("START");
    fireEvent.click(btn);
    expect(handlers.push).toHaveBeenCalledWith({ isRunning: true });
  });

  it("shows STOP when running", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState({ isRunning: true })} {...handlers} />);
    expect(screen.getByTestId("score-start-stop")).toHaveTextContent("STOP");
  });

  it("calls sendUndo when the undo button is clicked", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-undo"));
    expect(handlers.sendUndo).toHaveBeenCalled();
  });

  it("shows the home and visitor scores and default TOP inning label", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({
          period: "3",
          home: { ...DEFAULT_MATCH_STATE.home, score: 2 },
          visitor: { ...DEFAULT_MATCH_STATE.visitor, score: 5 },
        })}
        {...handlers}
      />
    );
    expect(screen.getByTestId("softball-home-score")).toHaveTextContent("2");
    expect(screen.getByTestId("softball-visitor-score")).toHaveTextContent("5");
    expect(screen.getByText("TOP of 7")).toBeInTheDocument();
    expect(screen.getByText(/At bat: Visitor/)).toBeInTheDocument();
  });

  it("adds a ball, incrementing the balls count", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("softball-ball"));
    expect(handlers.push).toHaveBeenCalledWith({ sportState: expect.objectContaining({ balls: 1 }) });
  });

  it("resets the count (walk) when a 4th ball is added", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({ sportState: { sport: "softball", format: "fastpitch", inningHalf: "top", outs: 0, balls: 3, strikes: 1 } as never })}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByTestId("softball-ball"));
    expect(handlers.push).toHaveBeenCalledWith({
      sportState: expect.objectContaining({ balls: 0, strikes: 0 }),
    });
  });

  it("adds a strike, incrementing the strikes count", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("softball-strike"));
    expect(handlers.push).toHaveBeenCalledWith({ sportState: expect.objectContaining({ strikes: 1 }) });
  });

  it("records an out when the 3rd strike is added", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({ sportState: { sport: "softball", format: "fastpitch", inningHalf: "top", outs: 0, balls: 0, strikes: 2 } as never })}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByTestId("softball-strike"));
    expect(handlers.push).toHaveBeenCalledWith({
      sportState: expect.objectContaining({ outs: 1, balls: 0, strikes: 0 }),
    });
  });

  it("records an out via the Out button", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("softball-out"));
    expect(handlers.push).toHaveBeenCalledWith({ sportState: expect.objectContaining({ outs: 1 }) });
  });

  it("ends the half-inning (switches top->bottom) when the 3rd out is recorded", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({ sportState: { sport: "softball", format: "fastpitch", inningHalf: "top", outs: 2, balls: 0, strikes: 0 } as never })}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByTestId("softball-out"));
    expect(handlers.push).toHaveBeenCalledWith({
      sportState: expect.objectContaining({ inningHalf: "bottom", outs: 0 }),
    });
  });

  it("resets balls/strikes via Next Batter", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({ sportState: { sport: "softball", format: "fastpitch", inningHalf: "top", outs: 0, balls: 2, strikes: 1 } as never })}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByTestId("softball-next-batter"));
    expect(handlers.push).toHaveBeenCalledWith({ sportState: expect.objectContaining({ balls: 0, strikes: 0 }) });
  });

  it("ends the half-inning manually (top -> bottom) when the End Half-Inning button is clicked", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("softball-end-half-inning"));
    expect(handlers.push).toHaveBeenCalledWith({
      sportState: expect.objectContaining({ inningHalf: "bottom", outs: 0 }),
    });
  });

  it("ends the half-inning (bottom -> top) and advances the period", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({ period: "1", sportState: { sport: "softball", format: "fastpitch", inningHalf: "bottom", outs: 0, balls: 0, strikes: 0 } as never })}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByTestId("softball-end-half-inning"));
    expect(handlers.push).toHaveBeenCalledWith({
      period: "2",
      sportState: expect.objectContaining({ inningHalf: "top", outs: 0 }),
    });
  });

  it("adjusts home and visitor runs", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("softball-home-run-inc"));
    expect(handlers.sendScoreAdjust).toHaveBeenCalledWith({ side: "home", delta: 1 });
    fireEvent.click(screen.getByTestId("softball-home-run-dec"));
    expect(handlers.sendScoreAdjust).toHaveBeenCalledWith({ side: "home", delta: -1 });
    fireEvent.click(screen.getByTestId("softball-visitor-run-inc"));
    expect(handlers.sendScoreAdjust).toHaveBeenCalledWith({ side: "visitor", delta: 1 });
    fireEvent.click(screen.getByTestId("softball-visitor-run-dec"));
    expect(handlers.sendScoreAdjust).toHaveBeenCalledWith({ side: "visitor", delta: -1 });
  });

  it("shows the mercy-rule note when eligible (fastpitch, inning >= 6, run diff >= 8)", () => {
    const handlers = makeHandlers();
    render(
      <SoftballTab
        state={makeState({
          period: "6",
          home: { ...DEFAULT_MATCH_STATE.home, score: 10 },
          visitor: { ...DEFAULT_MATCH_STATE.visitor, score: 1 },
        })}
        {...handlers}
      />
    );
    expect(screen.getByText("Mercy rule eligible")).toBeInTheDocument();
  });

  it("does not show the mercy-rule note when not eligible", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState({ period: "1" })} {...handlers} />);
    expect(screen.queryByText("Mercy rule eligible")).not.toBeInTheDocument();
  });

  it("commits home and visitor team name changes", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    const homeInput = screen.getByPlaceholderText("Home");
    fireEvent.change(homeInput, { target: { value: "Sharks" } });
    fireEvent.click(homeInput.parentElement!.querySelector("button")!);
    expect(handlers.push).toHaveBeenCalledWith({ home: expect.objectContaining({ name: "Sharks" }) });

    const visInput = screen.getByPlaceholderText("Visitor");
    fireEvent.change(visInput, { target: { value: "Eagles" } });
    fireEvent.click(visInput.parentElement!.querySelector("button")!);
    expect(handlers.push).toHaveBeenCalledWith({ visitor: expect.objectContaining({ name: "Eagles" }) });
  });

  it("commits a match name change", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    const input = screen.getByPlaceholderText("e.g. Round 1");
    fireEvent.change(input, { target: { value: "Final" } });
    fireEvent.click(input.parentElement!.querySelector("button")!);
    expect(handlers.push).toHaveBeenCalledWith({ matchName: "Final" });
  });

  it("renders the format label as a disabled-effect small button", () => {
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    expect(screen.getByText("Format: fastpitch")).toBeInTheDocument();
  });

  it("resets the match when Reset Match is confirmed", () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-reset-match"));
    expect(handlers.sendReset).toHaveBeenCalled();
  });

  it("does not reset the match when the confirm dialog is dismissed", () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const handlers = makeHandlers();
    render(<SoftballTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-reset-match"));
    expect(handlers.sendReset).not.toHaveBeenCalled();
  });
});
