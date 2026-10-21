"use client";

import type { SoftballState, MatchState } from "../../types";
import type { DisplayStatsProps } from "../../sport-templates";

function getSoftballState(state: MatchState): SoftballState | undefined {
  const ss = state.sportState as SoftballState | undefined;
  return ss?.sport === "softball" ? ss : undefined;
}

export function SoftballDisplayStats({ state, variant = "full" }: Readonly<DisplayStatsProps>) {
  const softball = getSoftballState(state);
  if (!softball) return null;

  const count = (
    <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
      <span style={{ color: "var(--accent)" }}>{softball.balls}</span>-<span style={{ color: "rgb(251,146,60)" }}>{softball.strikes}</span>
      <span className="mx-3" style={{ color: "var(--text-dim)" }}>|</span>
      {softball.outs} out{softball.outs === 1 ? "" : "s"}
    </span>
  );

  if (variant === "compact") {
    return (
      <div
        className="flex items-center justify-center px-5 py-2 rounded-lg gap-4"
        style={{ background: "var(--keyed-panel-bg, rgba(7,9,15,0.92))", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      >
        {count}
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)" }} className="px-6 py-4 flex items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--text-dim)" }}>Count</p>
        <p className="score-digit" style={{ fontSize: "1.75rem" }}>
          <span style={{ color: "var(--accent)" }}>{softball.balls}</span>
          <span style={{ color: "var(--text-dim)" }}>-</span>
          <span style={{ color: "rgb(251,146,60)" }}>{softball.strikes}</span>
        </p>
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--text-dim)" }}>Outs</p>
        <p className="score-digit" style={{ fontSize: "1.75rem", color: "var(--text-primary)" }}>{softball.outs}</p>
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--text-dim)" }}>Format</p>
        <p className="text-sm font-bold uppercase" style={{ color: "var(--text-secondary)" }}>{softball.format}</p>
      </div>
    </div>
  );
}
