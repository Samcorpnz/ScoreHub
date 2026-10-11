"use client";

import { useEffect, useRef, useState } from "react";
import { MatchState } from "../types";
import { getExtraTimePeriod } from "../sport-templates";

const STORAGE_KEY = "scoreboard_sound_cues";

export interface SoundCue {
  id: string;
  label: string;
  period: string;       // "*" = all periods, or "1", "2", "E", etc.
  clockSeconds: number; // Trigger when clock crosses this value
  soundUrl: string;     // Full URL to the audio file on the relay or CDN
  filename: string;     // Original filename for display
  serverFilename?: string; // Storage-side filename, used to issue the DELETE — absent on cues created before the R2 migration
}

export function useSoundCues() {
  const [cues, setCues] = useState<SoundCue[]>(() => {
    if (globalThis.window === undefined) return [];
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const save = (next: SoundCue[]) => {
    setCues(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return {
    cues,
    addCue:    (cue: SoundCue)  => save([...cues, cue]),
    removeCue: (id: string)     => save(cues.filter(c => c.id !== id)),
  };
}

export function useSoundPlayback(state: MatchState, cues: SoundCue[]) {
  const prevClock   = useRef(state.clockSeconds);
  const prevRunning = useRef(state.isRunning);
  const audioCache  = useRef(new Map<string, HTMLAudioElement>());
  // An "Extra time" cue covers every period past regulation, not just "E"
  const inExtraTime = getExtraTimePeriod(state) > 0;

  useEffect(() => {
    const prev       = prevClock.current;
    const wasRunning = prevRunning.current;
    prevClock.current   = state.clockSeconds;
    prevRunning.current = state.isRunning;

    // Only fire when clock transitions while running (not on pause/resume)
    if (!state.isRunning || !wasRunning) return;
    if (state.clockSeconds === prev) return;

    for (const cue of cues) {
      const matches = cue.period === "*" || cue.period === state.period || (cue.period === "E" && inExtraTime);
      if (!matches) continue;

      const hit = state.countDown
        ? prev > cue.clockSeconds && state.clockSeconds <= cue.clockSeconds
        : prev < cue.clockSeconds && state.clockSeconds >= cue.clockSeconds;

      if (!hit) continue;

      let audio = audioCache.current.get(cue.soundUrl);
      if (!audio) {
        audio = new Audio(cue.soundUrl);
        audioCache.current.set(cue.soundUrl, audio);
      }
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }, [state.clockSeconds, state.isRunning, state.period, inExtraTime, state.countDown, cues]);
}
