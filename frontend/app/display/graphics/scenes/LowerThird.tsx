"use client";

import { MatchState, formatScore } from "../../../types";
import { formatStatLabel, orderStats } from "../../../sport-graphics-templates";
import { RosterPlayer } from "../../../hooks/useRoster";

export interface SceneProps {
  readonly payload?: Record<string, unknown>;
  readonly state: MatchState;
  readonly roster?: RosterPlayer[];
}

// Generic lower-third: team names/scores plus the top few team-level stats
// the current provider mapping produced (bridge/src/graphics/feedMappings),
// ordered/labeled per sport-graphics-templates.ts where one exists, falling
// back to natural order + a camelCase-split label otherwise.
export function LowerThird({ state }: Pick<SceneProps, "state">) {
  const feed = state.graphicsFeed;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "var(--keyed-panel-shadow, 0 4px 32px rgba(0,0,0,0.7))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        background: "var(--graphics-card-bg, rgba(7,9,15,0.92))",
      }}
    >
      <TeamBlock sport={state.sport} name={state.home.name || "HOME"} score={formatScore(state, "home")} color={state.home.color || "var(--home-color)"} stats={feed?.stats.team.home} align="right" />
      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.08)" }} />
      <TeamBlock sport={state.sport} name={state.visitor.name || "VISITOR"} score={formatScore(state, "visitor")} color={state.visitor.color || "var(--visitor-color)"} stats={feed?.stats.team.visitor} align="left" />
    </div>
  );
}

function TeamBlock({
  sport, name, score, color, stats, align,
}: {
  readonly sport: MatchState["sport"];
  readonly name: string;
  readonly score: string;
  readonly color: string;
  readonly stats?: Record<string, number | string>;
  readonly align: "left" | "right";
}) {
  const statEntries = orderStats(sport, stats, "lowerThirdStats", ["squadName"]).slice(0, 3);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-start" : "flex-end", padding: "10px 20px", minWidth: 200 }}>
      <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
        {name}
      </span>
      <span className="score-digit" style={{ fontSize: "2rem", color, textShadow: `0 0 20px ${color}44` }}>
        {score}
      </span>
      {statEntries.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          {statEntries.map(([key, value]) => (
            <span key={key} style={{ fontSize: "0.55rem", color: "var(--text-dim)" }}>
              {formatStatLabel(sport, key)}: <strong style={{ color: "var(--text-secondary)" }}>{value}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
