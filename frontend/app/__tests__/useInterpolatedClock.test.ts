import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInterpolatedClock } from "../hooks/useInterpolatedClock";

type Props = Parameters<typeof useInterpolatedClock>[0];

const base: Props = { clockSeconds: 100, isRunning: false, countDown: false };

const render = (initialProps: Props) =>
  renderHook((p: Props) => useInterpolatedClock(p), { initialProps });

describe("useInterpolatedClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the bare clockSeconds when stopped with no carry", () => {
    const { result } = render(base);
    expect(result.current).toBe(100);
  });

  it("folds the relay's carry into the value (count-up adds, count-down subtracts)", () => {
    const up = render({ ...base, clockCarryMs: 400 });
    expect(up.result.current).toBeCloseTo(100.4);

    const down = render({ ...base, countDown: true, clockCarryMs: 400 });
    expect(down.result.current).toBeCloseTo(99.6);
  });

  it("interpolates forward between relay ticks while running (count-up)", () => {
    const { result } = render({ ...base, isRunning: true, clockAnchorMs: Date.now() });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBeCloseTo(100.5, 1);
  });

  it("interpolates backward while running (count-down) and never goes below zero", () => {
    const { result } = render({ clockSeconds: 0.3, isRunning: true, countDown: true, clockAnchorMs: Date.now() });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(0);
  });

  it("snaps to the precise (anchor+carry) value when the clock stops, with no backward jump", () => {
    const { result, rerender } = render({ ...base, isRunning: true, clockAnchorMs: Date.now() });
    act(() => { vi.advanceTimersByTime(700); });
    rerender({ ...base, clockSeconds: 100, isRunning: false, clockCarryMs: 700 });
    expect(result.current).toBeCloseTo(100.7);
  });

  it("restarts from the server's value, not a stale interpolated one", () => {
    const { result, rerender } = render({ ...base, isRunning: true, clockAnchorMs: Date.now() });
    act(() => { vi.advanceTimersByTime(900); });
    rerender({ ...base, clockSeconds: 200, isRunning: false });
    expect(result.current).toBe(200);
    rerender({ ...base, clockSeconds: 200, isRunning: true, clockAnchorMs: Date.now() });
    // Before the first 50ms tick fires, the value must still be the server's.
    expect(result.current).toBe(200);
  });

  it("re-baselines when the server sends a new value while running", () => {
    const { result, rerender } = render({ ...base, isRunning: true, clockAnchorMs: Date.now() });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ ...base, clockSeconds: 150, isRunning: true, clockAnchorMs: Date.now() });
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current).toBeCloseTo(150.25, 1);
  });
});
