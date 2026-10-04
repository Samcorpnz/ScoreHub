import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ScoreTab } from "../ScoreTab";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
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

describe("ScoreTab", () => {
  it("renders the start/stop button reflecting the isRunning state", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ isRunning: false })} {...handlers} />);
    expect(screen.getByTestId("score-start-stop")).toHaveTextContent("START");
  });

  it("shows STOP when the match is running, and toggles isRunning on click", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ isRunning: true })} {...handlers} />);
    const btn = screen.getByTestId("score-start-stop");
    expect(btn).toHaveTextContent("STOP");
    fireEvent.click(btn);
    expect(handlers.push).toHaveBeenCalledWith({ isRunning: false });
  });

  it("calls sendUndo when the undo button is clicked", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-undo"));
    expect(handlers.sendUndo).toHaveBeenCalled();
  });

  it("advances the period and marks periodBreak when END QTR is clicked", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ period: "1" })} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-end-period"));
    expect(handlers.push).toHaveBeenCalledWith(expect.objectContaining({
      isRunning: false, period: "2", periodBreak: true,
    }));
  });

  it("reopens the previous period when REOPEN is clicked", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ period: "2", periodBreak: true })} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-reopen-period"));
    expect(handlers.push).toHaveBeenCalledWith(expect.objectContaining({
      period: "1", periodBreak: false,
    }));
  });

  it("adjusts the home score via score buttons", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ home: { ...DEFAULT_MATCH_STATE.home, score: 0 } })} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-home-inc-1"));
    expect(handlers.sendScoreAdjust).toHaveBeenCalledWith({ side: "home", delta: 1 });
  });

  it("adjusts the visitor score via score buttons", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-visitor-inc-2"));
    expect(handlers.sendScoreAdjust).toHaveBeenCalledWith({ side: "visitor", delta: 2 });
  });

  it("increments home faults when the fault button is clicked", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ home: { ...DEFAULT_MATCH_STATE.home, faults: 1 } })} {...handlers} />);
    fireEvent.click(screen.getByText("Faults: 1"));
    expect(handlers.push).toHaveBeenCalledWith({ home: expect.objectContaining({ faults: 2 }) });
  });

  it("shows Fouls label instead of Faults for basketball", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ sport: "basketball" })} {...handlers} />);
    expect(screen.getAllByText(/Fouls: 0/).length).toBeGreaterThan(0);
  });

  describe("best-of match length (SA-118)", () => {
    it("shows the match length and still ends a game before the last one", () => {
      const handlers = makeHandlers();
      render(<ScoreTab state={makeState({ sport: "squash", sportConfig: { format: "bo3" }, period: "2" })} {...handlers} />);
      expect(screen.getByText("GAME 2 of 3")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("score-end-period"));
      expect(handlers.push).toHaveBeenCalledWith(expect.objectContaining({ period: "3" }));
    });

    it("won't go past the final game of a best-of-3", () => {
      const handlers = makeHandlers();
      render(<ScoreTab state={makeState({ sport: "squash", sportConfig: { format: "bo3" }, period: "3" })} {...handlers} />);
      const end = screen.getByTestId("score-end-period");
      expect(end).toBeDisabled();
      expect(end).toHaveTextContent("FINAL GAME");
      fireEvent.keyDown(globalThis.window, { key: "]" });
      expect(handlers.push).not.toHaveBeenCalled();
    });

    it("allows games 4 and 5 in a best-of-5", () => {
      const handlers = makeHandlers();
      render(<ScoreTab state={makeState({ sport: "squash", sportConfig: { format: "bo5" }, period: "3" })} {...handlers} />);
      expect(screen.getByTestId("score-end-period")).not.toBeDisabled();
    });
  });

  describe("timeouts (SA-119)", () => {
    it("uses a timeout for the tapped team", () => {
      const handlers = makeHandlers();
      render(<ScoreTab state={makeState({ sport: "basketball", home: { ...DEFAULT_MATCH_STATE.home, timeouts: 5 } })} {...handlers} />);
      fireEvent.click(screen.getByTestId("score-home-timeout"));
      expect(handlers.push).toHaveBeenCalledWith({ home: expect.objectContaining({ timeouts: 4 }) });
    });

    it("never goes below zero", () => {
      const handlers = makeHandlers();
      render(<ScoreTab state={makeState({ sport: "basketball", visitor: { ...DEFAULT_MATCH_STATE.visitor, timeouts: 0 } })} {...handlers} />);
      fireEvent.click(screen.getByTestId("score-visitor-timeout"));
      expect(handlers.push).toHaveBeenCalledWith({ visitor: expect.objectContaining({ timeouts: 0 }) });
    });

    it("restores a timeout, capped at the sport's allowance", () => {
      const handlers = makeHandlers();
      // basketball allows 5 per team
      render(<ScoreTab state={makeState({ sport: "basketball", home: { ...DEFAULT_MATCH_STATE.home, timeouts: 4 }, visitor: { ...DEFAULT_MATCH_STATE.visitor, timeouts: 5 } })} {...handlers} />);
      fireEvent.click(screen.getByTestId("score-home-timeout-restore"));
      expect(handlers.push).toHaveBeenLastCalledWith({ home: expect.objectContaining({ timeouts: 5 }) });
      fireEvent.click(screen.getByTestId("score-visitor-timeout-restore"));
      expect(handlers.push).toHaveBeenLastCalledWith({ visitor: expect.objectContaining({ timeouts: 5 }) });
    });

    it("is hidden for sports with no timeouts", () => {
      render(<ScoreTab state={makeState({ sport: "rugby_union" })} {...makeHandlers()} />);
      expect(screen.queryByTestId("score-home-timeout")).not.toBeInTheDocument();
    });
  });

  it("toggles home possession when the home-ball button is clicked", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ possession: "none" })} {...handlers} />);
    fireEvent.click(screen.getByText(/Home ball/));
    expect(handlers.push).toHaveBeenCalledWith({ possession: "home" });
  });

  it("clears possession when the already-active side is clicked again", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ possession: "home" })} {...handlers} />);
    fireEvent.click(screen.getByText(/Home ball/));
    expect(handlers.push).toHaveBeenCalledWith({ possession: "none" });
  });

  it("resets the match when Reset Match is confirmed", () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-reset-match"));
    expect(handlers.sendReset).toHaveBeenCalled();
  });

  it("does not reset the match when the confirm dialog is dismissed", () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    fireEvent.click(screen.getByTestId("score-reset-match"));
    expect(handlers.sendReset).not.toHaveBeenCalled();
  });

  it("adjusts the clock forward when a clock-adjust button is clicked", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ clockSeconds: 100 })} {...handlers} />);
    fireEvent.click(screen.getByText("+10s"));
    expect(handlers.push).toHaveBeenCalledWith({ clockSeconds: 110 });
  });

  it("commits a home team name change via the NameField Set button", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    const input = screen.getByPlaceholderText("Home");
    fireEvent.change(input, { target: { value: "Sharks" } });
    const setButton = input.parentElement!.querySelector("button")!;
    fireEvent.click(setButton);
    expect(handlers.push).toHaveBeenCalledWith({ home: expect.objectContaining({ name: "Sharks" }) });
  });

  it("sets the clock via the MM:SS input on Enter", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    const input = screen.getByPlaceholderText("MM:SS");
    fireEvent.change(input, { target: { value: "02:30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.push).toHaveBeenCalledWith({ clockSeconds: 150 });
  });

  it("renders the indoor-cricket wicket buttons and calls sendIndoorCricketWicket", () => {
    const handlers = makeHandlers();
    render(
      <ScoreTab
        state={makeState({ sport: "indoor_cricket", sportState: { homeWickets: 2, visitorWickets: 1 } as never })}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByTestId("score-home-wicket"));
    expect(handlers.sendIndoorCricketWicket).toHaveBeenCalledWith({ side: "home" });
  });

  it("delegates to the sport's custom control panel (e.g. cricket) when present", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ sport: "cricket" })} {...handlers} />);
    // CricketTab (the custom controlPanel) also renders a score-reset-match button
    expect(screen.getByTestId("score-reset-match")).toBeInTheDocument();
    // ScoreTab's own start/stop button should not be present since CricketTab took over
    expect(screen.queryByTestId("score-start-stop")).not.toBeInTheDocument();
  });

  it("toggles space key to start/stop the match", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState({ isRunning: false })} {...handlers} />);
    fireEvent.keyDown(window, { key: " " });
    expect(handlers.push).toHaveBeenCalledWith({ isRunning: true });
  });

  it("does not trigger keyboard shortcuts while focused on an input", () => {
    const handlers = makeHandlers();
    render(<ScoreTab state={makeState()} {...handlers} />);
    const input = screen.getByPlaceholderText("MM:SS");
    fireEvent.keyDown(input, { key: " " });
    expect(handlers.push).not.toHaveBeenCalledWith({ isRunning: true });
  });
});
