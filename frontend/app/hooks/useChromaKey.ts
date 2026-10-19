"use client";

import { useEffect, useState } from "react";
import { RELAY_URL } from "../control/lib/relay";

// Broadcast-standard chroma green and blue. A transparent Browser Source is
// all OBS/vMix need, but a hardware switcher (an ATEM fed over HDMI/SDI) only
// sees a solid picture, so it keys out one of these instead.
export const CHROMA_KEY_COLORS = { green: "#00B140", blue: "#0047BB" } as const;
export type ChromaKey = keyof typeof CHROMA_KEY_COLORS;

export function isChromaKey(value: string | null): value is ChromaKey {
  return value === "green" || value === "blue";
}

/**
 * Background colour for a keyable output (overlay, score bug, graphics) when
 * its link carries ?key=green|blue, or null to stay transparent. Part of the
 * Graphics add-on, so it only applies once the relay confirms the org has
 * it — until then (and if it doesn't) the page stays transparent as usual.
 */
export function useChromaKey(): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const key = params.get("key");
    if (!isChromaKey(key)) return;
    const org = params.get("org");
    const url = org ? `${RELAY_URL}/api/graphics/entitlement?org=${encodeURIComponent(org)}` : `${RELAY_URL}/api/graphics/entitlement`;
    let cancelled = false;
    fetch(url)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.entitled) setColor(CHROMA_KEY_COLORS[key]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return color;
}
