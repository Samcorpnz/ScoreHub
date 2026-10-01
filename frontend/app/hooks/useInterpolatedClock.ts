"use client";

import { useState, useEffect, useRef } from "react";

export function useInterpolatedClock({
  clockSeconds,
  isRunning,
  countDown,
  clockAnchorMs,
  clockCarryMs,
}: {
  clockSeconds: number;
  isRunning: boolean;
  countDown: boolean;
  clockAnchorMs?: number;
  clockCarryMs?: number;
}): number {
  // When the relay supplies a precise anchor/carry (relay-tick-loop-driven
  // matches), preciseSeconds is the exact value at clockAnchorMs — no more
  // guessing at a fractional remainder. When absent (bridge-driven matches,
  // or an un-updated caller), carry is 0 and this collapses to clockSeconds,
  // matching the previous ad-hoc-local-anchor behavior exactly.
  const direction = countDown ? -1 : 1;
  const preciseSeconds = clockSeconds + direction * ((clockCarryMs ?? 0) / 1000);

  const [display, setDisplay] = useState(preciseSeconds);
  // The initial time is never read: the sync effect below runs on mount,
  // before the first interpolation tick, and overwrites it.
  const lastRef = useRef({ time: clockAnchorMs ?? 0, seconds: preciseSeconds });

  // Snap to the precise (anchor+carry) value whenever the server sends a new
  // value while stopped — not the bare integer: this is exactly what
  // interpolation was already converging toward, so stopping never produces
  // a visible backward jump. Done during render (React's "adjust state when
  // inputs change" pattern) rather than in an effect, so it doesn't cost an
  // extra committed render.
  const syncKey = `${clockSeconds}|${isRunning}|${countDown}|${clockAnchorMs}|${clockCarryMs}`;
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey);
    if (!isRunning) setDisplay(preciseSeconds);
  }

  // Sync the interpolation baseline whenever the server sends a new value
  useEffect(() => {
    lastRef.current = { time: clockAnchorMs ?? Date.now(), seconds: preciseSeconds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockSeconds, isRunning, countDown, clockAnchorMs, clockCarryMs]);

  // Interpolation — 50ms interval fills in the tenths between relay ticks
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      const elapsed = Math.min((Date.now() - lastRef.current.time) / 1000, 1.1);
      const val = countDown
        ? lastRef.current.seconds - elapsed
        : lastRef.current.seconds + elapsed;
      setDisplay(Math.max(0, val));
    }, 50);
    return () => clearInterval(id);
  }, [isRunning, countDown]);

  return display;
}
