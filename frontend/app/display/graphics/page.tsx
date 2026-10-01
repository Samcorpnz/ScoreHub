"use client";

/**
 * Graphics Operator add-on — the single stable Browser Source URL. Drop this
 * into OBS/vMix/Wirecast once; an operator on /control/graphics switches
 * what renders here without ever touching the source/URL again.
 */

import { useEffect, useState } from "react";
import { useMatchState } from "../../hooks/useMatchState";
import { useGraphicsScene } from "../../hooks/useGraphicsScene";
import { useDisplayTheme } from "../../hooks/useDisplayTheme";
import { useRoster } from "../../hooks/useRoster";
import { SCENE_REGISTRY } from "./scenes/sceneRegistry";
import { DisplayLinkExpiredNotice } from "../components/DisplayLinkExpiredNotice";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

// Converts a "#rrggbb" theme color to an rgba() string at the given alpha,
// falling back to the default dark scene-card tint for any non-hex input
// (e.g. a stale/empty theme value) rather than producing invalid CSS.
function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(7,9,15,${alpha})`;
  const int = Number.parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function GraphicsDisplay() {
  const { state, unauthorized } = useMatchState();
  const { scene } = useGraphicsScene();
  const [entitled, setEntitled] = useState<boolean | null>(null);
  // Read once from the URL. Only consumed by useRoster, whose result is empty
  // until its fetch resolves, so the server and first client render agree.
  const [org] = useState<string | null>(() =>
    typeof globalThis.window === "undefined" ? null : new URLSearchParams(globalThis.location.search).get("org"),
  );
  // Only the ids currently on the live feed are fetched from the roster
  // endpoint (which returns nothing for ids it isn't given) — the whole-roster
  // fetch would expose the org's people database to anyone with the share URL.
  const feedPlayerIds = (state.graphicsFeed?.stats.players ?? []).map(p => p.id);
  const roster = useRoster(org, feedPlayerIds);
  const { backgroundColor, textScale: _textScale, competitionLogoUrl: _cl, ...themeStyle } = useDisplayTheme(state.displayTheme);

  useEffect(() => {
    const url = org ? `${RELAY_URL}/api/graphics/entitlement?org=${encodeURIComponent(org)}` : `${RELAY_URL}/api/graphics/entitlement`;
    fetch(url)
      .then(res => res.json())
      .then(data => setEntitled(Boolean(data.entitled)))
      .catch(() => setEntitled(null));
  }, [org]);

  const SceneComponent = scene ? SCENE_REGISTRY[scene.sceneType] : undefined;

  return (
    <div
      style={{
        ...themeStyle,
        // Themed vars (accent/font/scale) apply; background stays transparent
        // for OBS/vMix compositing — the theme's backgroundColor is only used
        // as a tint for scene card backgrounds via --graphics-card-bg below.
        background: "transparent",
        "--graphics-card-bg": hexToRgba(backgroundColor ?? "#07090F", 0.92),
        width: "100vw",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      } as React.CSSProperties}
    >
      {(() => {
        if (unauthorized) return <DisplayLinkExpiredNotice />;
        if (entitled === false) return <UpgradePrompt />;
        if (SceneComponent) return <SceneComponent payload={scene?.payload} state={state} roster={roster} />;
        return null;
      })()}
    </div>
  );
}

function UpgradePrompt() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "20px 32px",
        borderRadius: 12,
        background: "rgba(7,9,15,0.85)",
        boxShadow: "0 4px 32px rgba(0,0,0,0.6)",
      }}
    >
      <span style={{ fontWeight: 900, fontSize: "1.1rem", letterSpacing: "0.02em", color: "var(--accent)" }}>
        ScoreHub
      </span>
      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
        Upgrade your plan to unlock the Graphics Operator add-on
      </span>
    </div>
  );
}
