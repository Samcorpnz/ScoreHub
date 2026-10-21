"use client";

import { useState } from "react";
import type { NetballPlayerStats, NetballTeamStats } from "../../types";
import type { DisplayStatsProps } from "../../sport-templates";

export function NetballDisplayStats({ state, variant = "full" }: Readonly<DisplayStatsProps>) {
  const [showOnCourtOnly, setShowOnCourtOnly] = useState(true);
  const stats = state.netballStats;
  if (!stats) return null;

  if (variant === "compact") {
    return (
      <div
        className="flex items-center justify-between px-5 py-2 rounded-lg gap-6"
        style={{ background: "var(--keyed-panel-bg, rgba(7,9,15,0.92))", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      >
        <CompactTeamLine team={stats.home} color="var(--home-color)" />
        <CompactTeamLine team={stats.visitor} color="var(--visitor-color)" />
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <div
        className="px-6 py-3 flex items-center justify-between"
        style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
          Player Stats
        </span>
        <button
          onClick={() => setShowOnCourtOnly(v => !v)}
          className="text-xs font-bold px-3 py-1 rounded-full transition-colors"
          style={{
            background: showOnCourtOnly ? "var(--accent)" : "var(--bg-surface)",
            border: "1px solid var(--border)",
            color: showOnCourtOnly ? "#000" : "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          {showOnCourtOnly ? "On Court (7)" : "All Players"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--border)" }}>
        <TeamSummaryBar team={stats.home} color="var(--home-color)" align="left" />
        <TeamSummaryBar team={stats.visitor} color="var(--visitor-color)" align="right" />
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--border)" }}>
        <PlayerStatsTable team={stats.home} color="var(--home-color)" showOnCourtOnly={showOnCourtOnly} />
        <PlayerStatsTable team={stats.visitor} color="var(--visitor-color)" showOnCourtOnly={showOnCourtOnly} />
      </div>
    </div>
  );
}

function CompactTeamLine({ team, color }: { readonly team: NetballTeamStats; readonly color: string }) {
  const pct = team.goalAttempts > 0 ? `${team.shootingPercentage.toFixed(1)}%` : "–";
  return (
    <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
      Shooting <span style={{ color }}>{pct}</span> · Gains <span style={{ color }}>{team.gain}</span> · Turnovers <span style={{ color }}>{team.turnovers}</span>
    </span>
  );
}

function TeamSummaryBar({ team, color, align }: { readonly team: NetballTeamStats; readonly color: string; readonly align: "left" | "right" }) {
  const pct = team.goalAttempts > 0 ? `${team.shootingPercentage.toFixed(1)}%` : "–";
  const cpEff = team.centrePassReceives > 0 ? `${team.goalsFromCentrePass}/${team.centrePassReceives}` : "–";

  const stats = [
    { label: "Shooting", value: pct },
    { label: "CP Eff", value: cpEff },
    { label: "Gains", value: team.gain },
    { label: "Turnovers", value: team.turnovers },
    { label: "Penalties", value: team.penalties },
    { label: "Rebounds", value: team.rebounds },
    { label: "Intercepts", value: team.intercepts },
    { label: "Feeds", value: team.feeds },
  ];

  return (
    <div className="px-5 py-3 flex flex-wrap gap-x-5 gap-y-1" style={{ background: "var(--bg-elevated)" }}>
      {stats.map(s => (
        <div key={s.label} className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>{s.label}</span>
          <span className="text-sm font-bold" style={{ color }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

const ON_COURT_POSITIONS = new Set(["GS", "GA", "WA", "C", "WD", "GD", "GK"]);

function isOnCourt(p: NetballPlayerStats): boolean {
  return ON_COURT_POSITIONS.has(p.currentPosition);
}

function positionOrder(pos: string): number {
  const order: Record<string, number> = { GS: 0, GA: 1, WA: 2, C: 3, WD: 4, GD: 5, GK: 6, I: 7 };
  return order[pos] ?? 8;
}

function PlayerStatsTable({ team, color, showOnCourtOnly }: { readonly team: NetballTeamStats; readonly color: string; readonly showOnCourtOnly: boolean }) {
  const filtered = team.players
    .filter(p => !showOnCourtOnly || isOnCourt(p))
    .sort((a, b) => positionOrder(a.currentPosition) - positionOrder(b.currentPosition));

  const cols = [
    { key: "pos", label: "Pos" },
    { key: "name", label: "Player" },
    { key: "goals", label: "G" },
    { key: "goalAttempts", label: "GA" },
    { key: "pct", label: "%" },
    { key: "feeds", label: "Fd" },
    { key: "goalAssists", label: "As" },
    { key: "intercepts", label: "Int" },
    { key: "penalties", label: "Pen" },
  ];

  return (
    <div style={{ background: "var(--bg-surface)" }}>
      <div
        className="grid text-xs font-bold tracking-wider uppercase px-4 py-2"
        style={{
          gridTemplateColumns: "48px 1fr 32px 32px 44px 32px 32px 36px 36px",
          color: "var(--text-dim)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
        }}
      >
        {cols.map(c => <span key={c.key}>{c.label}</span>)}
      </div>

      {filtered.length === 0 && (
        <div className="px-4 py-6 text-xs text-center" style={{ color: "var(--text-dim)" }}>No players</div>
      )}
      {filtered.map(p => (
        <PlayerRow key={p.playerId} player={p} color={color} onCourt={isOnCourt(p)} />
      ))}
    </div>
  );
}

function PlayerRow({ player, color, onCourt }: { readonly player: NetballPlayerStats; readonly color: string; readonly onCourt: boolean }) {
  const pct = player.goalAttempts > 0 ? `${player.shootingPercentage.toFixed(0)}%` : "–";

  return (
    <div
      className="grid text-xs px-4 py-1.5 items-center"
      style={{
        gridTemplateColumns: "48px 1fr 32px 32px 44px 32px 32px 36px 36px",
        borderBottom: "1px solid var(--border)",
        opacity: onCourt ? 1 : 0.5,
      }}
    >
      <span
        className="font-bold text-center rounded px-1"
        style={{ background: onCourt ? `${color}22` : "transparent", color: onCourt ? color : "var(--text-dim)", fontSize: 10 }}
      >
        {player.currentPosition || "–"}
      </span>
      <span className="truncate pr-2" style={{ color: "var(--text-primary)" }}>
        {player.playerSurname}
        {player.playerFirstname ? `, ${player.playerFirstname.charAt(0)}.` : ""}
      </span>
      <StatCell value={player.goals > 0 ? player.goals : "–"} highlight={player.goals > 0} color={color} />
      <StatCell value={player.goalAttempts > 0 ? player.goalAttempts : "–"} />
      <StatCell value={player.goalAttempts > 0 ? pct : "–"} highlight={player.goalAttempts > 0} color={color} />
      <StatCell value={player.feeds > 0 ? player.feeds : "–"} />
      <StatCell value={player.goalAssists > 0 ? player.goalAssists : "–"} />
      <StatCell value={player.intercepts > 0 ? player.intercepts : "–"} />
      <StatCell value={player.penalties > 0 ? player.penalties : "–"} />
    </div>
  );
}

function StatCell({ value, highlight = false, color }: { readonly value: string | number; readonly highlight?: boolean; readonly color?: string }) {
  return (
    <span className="text-right font-mono" style={{ color: highlight && color ? color : "var(--text-secondary)" }}>
      {value}
    </span>
  );
}
