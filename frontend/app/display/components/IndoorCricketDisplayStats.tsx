"use client";

import type { IndoorCricketState, MatchState } from "../../types";
import type { DisplayStatsProps } from "../../sport-templates";

function getIndoorCricketState(state: MatchState): IndoorCricketState | undefined {
  const ics = state.sportState as IndoorCricketState | undefined;
  return ics?.sport === "indoor_cricket" ? ics : undefined;
}

export function IndoorCricketDisplayStats({ state, variant = "full" }: Readonly<DisplayStatsProps>) {
  const indoorCricket = getIndoorCricketState(state);
  if (!indoorCricket) return null;

  const summary = (
    <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
      {indoorCricket.homeWickets} / {indoorCricket.visitorWickets} wkts
      <span className="mx-3" style={{ color: "var(--text-dim)" }}>|</span>
      {indoorCricket.oversPerInnings} overs · -{indoorCricket.wicketPenalty} per wicket
    </span>
  );

  if (variant === "compact") {
    return (
      <div
        className="flex items-center justify-center px-5 py-2 rounded-lg"
        style={{ background: "var(--keyed-panel-bg, rgba(7,9,15,0.92))", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      >
        {summary}
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)" }} className="px-6 py-4 flex items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--text-dim)" }}>Home Wickets</p>
        <p className="score-digit" style={{ fontSize: "1.75rem", color: "var(--home-color)" }}>{indoorCricket.homeWickets}</p>
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--text-dim)" }}>Visitor Wickets</p>
        <p className="score-digit" style={{ fontSize: "1.75rem", color: "var(--visitor-color)" }}>{indoorCricket.visitorWickets}</p>
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--text-dim)" }}>Overs / Wicket Penalty</p>
        <p className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>
          {indoorCricket.oversPerInnings} overs · -{indoorCricket.wicketPenalty} runs
        </p>
      </div>
    </div>
  );
}
