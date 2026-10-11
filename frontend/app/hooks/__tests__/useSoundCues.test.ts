import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSoundCues, useSoundPlayback, SoundCue } from "../useSoundCues";
import { DEFAULT_MATCH_STATE, MatchState } from "../../types";

const CUE: SoundCue = {
  id: "1",
  label: "Buzzer",
  period: "*",
  clockSeconds: 30,
  soundUrl: "https://example.com/buzzer.mp3",
  filename: "buzzer.mp3",
};

describe("useSoundCues", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty when localStorage has no saved cues", () => {
    const { result } = renderHook(() => useSoundCues());
    expect(result.current.cues).toEqual([]);
  });

  it("adds a cue and persists it to localStorage", () => {
    const { result } = renderHook(() => useSoundCues());
    act(() => result.current.addCue(CUE));
    expect(result.current.cues).toEqual([CUE]);
    expect(JSON.parse(localStorage.getItem("scoreboard_sound_cues")!)).toEqual([CUE]);
  });

  it("removes a cue by id", () => {
    const { result } = renderHook(() => useSoundCues());
    act(() => result.current.addCue(CUE));
    act(() => result.current.removeCue(CUE.id));
    expect(result.current.cues).toEqual([]);
  });

  it("falls back to an empty list if localStorage contains malformed JSON", () => {
    localStorage.setItem("scoreboard_sound_cues", "{not valid json");
    const { result } = renderHook(() => useSoundCues());
    expect(result.current.cues).toEqual([]);
  });
});

describe("useSoundPlayback", () => {
  it("does not throw when the clock crosses a cue's trigger point while running", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const baseState: MatchState = { ...DEFAULT_MATCH_STATE, isRunning: true, countDown: true, clockSeconds: 31 };
    const { rerender } = renderHook(
      ({ state }) => useSoundPlayback(state, [CUE]),
      { initialProps: { state: baseState } }
    );

    const nextState: MatchState = { ...baseState, clockSeconds: 29 };
    rerender({ state: nextState });

    expect(playSpy).toHaveBeenCalled();
    playSpy.mockRestore();
  });

  it("plays an Extra time cue in the periods after regulation, and not before", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const cue: SoundCue = { ...CUE, period: "E" };
    const cross = (period: string) => {
      const state: MatchState = { ...DEFAULT_MATCH_STATE, sport: "netball", period, isRunning: true, countDown: true, clockSeconds: 31 };
      const { rerender, unmount } = renderHook(({ state }) => useSoundPlayback(state, [cue]), { initialProps: { state } });
      rerender({ state: { ...state, clockSeconds: 29 } });
      unmount();
    };

    cross("4");
    expect(playSpy).not.toHaveBeenCalled();
    cross("5");
    expect(playSpy).toHaveBeenCalledTimes(1);
    cross("E");
    expect(playSpy).toHaveBeenCalledTimes(2);
    playSpy.mockRestore();
  });

  it("does not fire when the match is not running", () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const baseState: MatchState = { ...DEFAULT_MATCH_STATE, isRunning: false, countDown: true, clockSeconds: 31 };
    const { rerender } = renderHook(
      ({ state }) => useSoundPlayback(state, [CUE]),
      { initialProps: { state: baseState } }
    );

    rerender({ state: { ...baseState, clockSeconds: 29 } });

    expect(playSpy).not.toHaveBeenCalled();
    playSpy.mockRestore();
  });
});
