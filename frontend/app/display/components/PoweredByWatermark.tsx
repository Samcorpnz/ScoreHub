"use client";

import { useEffect, useState } from "react";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

// Display pages are long-lived (a venue screen or OBS Browser Source can stay
// open for days), so the entitlement is re-checked on a timer — that's what
// makes the watermark go away after an upgrade without anyone reloading.
const RECHECK_MS = 60_000;

/**
 * Free-tier "Powered by ScoreHub" mark (SA-31). Display pages have no
 * session, so the relay answers whether the org behind this link is on the
 * Free plan (see GET /api/display/entitlement). Renders nothing until the
 * relay says so, so a paying account never sees it flash up on load.
 *
 * `inline` flows with the surrounding layout instead of pinning to the
 * viewport corner — for the scorebug, whose Browser Source is barely larger
 * than the bug itself.
 */
export function PoweredByWatermark({ inline = false }: { readonly inline?: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const query = new URLSearchParams();
    for (const key of ["org", "matchId"]) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }
    let cancelled = false;
    const check = () => {
      fetch(`${RELAY_URL}/api/display/entitlement?${query.toString()}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (!cancelled && data) setShow(Boolean(data.watermark));
        })
        // Keep whatever was last known — a relay blip shouldn't toggle it.
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, RECHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      data-testid="powered-by-watermark"
      style={{
        ...(inline
          ? { marginTop: 6, textAlign: "center" as const }
          : { position: "fixed" as const, right: 12, bottom: 10, zIndex: 20 }),
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: "rgba(255,255,255,0.75)",
        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
        whiteSpace: "nowrap",
      }}
    >
      Powered by <span style={{ fontWeight: 800, color: "#fff" }}>ScoreHub</span>
    </div>
  );
}
