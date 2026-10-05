"use client";

import { useMatchState } from "../../hooks/useMatchState";
import { useDisplayTheme } from "../../hooks/useDisplayTheme";
import { ScorePanel } from "../../components/ScorePanel";
import { ClockPanel } from "../../components/ClockPanel";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { TeamState, Possession, formatScore } from "../../types";
import { getPeriodLabel, getTemplate } from "../../sport-templates";
import { DisplayLinkExpiredNotice } from "../components/DisplayLinkExpiredNotice";
import { PoweredByWatermark } from "../components/PoweredByWatermark";

export default function AdvancedDisplay() {
  const { state, status, relayUnreachable, unauthorized } = useMatchState();
  const { textScale: _ts, competitionLogoUrl: _cl, ...themeStyle } = useDisplayTheme(state.displayTheme);
  const DisplayStats = getTemplate(state.sport).displayStats;

  if (unauthorized) return <DisplayLinkExpiredNotice />;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={themeStyle}
    >
      <div className="fixed top-4 right-4 z-10">
        <ConnectionBadge status={status} relayUnreachable={relayUnreachable} />
      </div>
      <PoweredByWatermark />

      <div
        className="w-full max-w-6xl rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 0 80px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header bar */}
        <div
          className="px-8 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}
        >
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
            {state.matchName || "SCOREBOARD"}
          </span>
          <ConnectionBadge status={status} relayUnreachable={relayUnreachable} />
        </div>

        {/* Main scoreboard row */}
        <div className="flex items-stretch">
          <TeamColumn team={state.home} side="home" possession={state.possession} scoreText={formatScore(state, "home")} />
          <div
            className="flex flex-col items-center justify-center px-10 py-8 flex-shrink-0"
            style={{ borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}
          >
            <ClockPanel
              clockSeconds={state.clockSeconds}
              countDown={state.countDown}
              period={state.period}
              periodBreak={state.periodBreak}
              periodLabel={getPeriodLabel(state)}
              isRunning={state.isRunning}
              hornActive={state.hornActive}
              clockAnchorMs={state.clockAnchorMs}
              clockCarryMs={state.clockCarryMs}
            />
          </div>
          <TeamColumn team={state.visitor} side="visitor" possession={state.possession} scoreText={formatScore(state, "visitor")} />
        </div>

        {/* Sport-specific stats panel */}
        {DisplayStats ? (
          <DisplayStats state={state} variant="full" />
        ) : (
          <PlayerStrip homeTeam={state.home} visitorTeam={state.visitor} />
        )}
      </div>
    </div>
  );
}

// ─── Score column ─────────────────────────────────────────────────────────────

function TeamColumn({
  team, side, possession, scoreText,
}: {
  readonly team: TeamState;
  readonly side: "home" | "visitor";
  readonly possession: Possession;
  readonly scoreText: string;
}) {
  const color = side === "home" ? "var(--home-color)" : "var(--visitor-color)";
  return (
    <div className="flex-1 flex flex-col">
      <div style={{ height: 6, background: color, boxShadow: `0 0 20px ${color}66` }} />
      <div className="flex flex-col items-center justify-center py-10 px-6 flex-1">
        <ScorePanel team={team} side={side} possession={possession} size="full" scoreText={scoreText} />
        {team.timeouts > 0 && (
          <div className="flex gap-2 mt-4">
            {Array.from({ length: Math.max(team.timeouts, 3) }).map((_, i) => (
              <div
                key={`${side}-timeout-${i}`}
                className="rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  background: i < team.timeouts ? color : "var(--text-dim)",
                  boxShadow: i < team.timeouts ? `0 0 6px ${color}` : "none",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fallback player strip (sports with no displayStats override) ────────────

function PlayerStrip({ homeTeam, visitorTeam }: { readonly homeTeam: TeamState; readonly visitorTeam: TeamState }) {
  const homePlayers = homeTeam.players.filter(p => p.onCourt);
  const visPlayers  = visitorTeam.players.filter(p => p.onCourt);
  if (homePlayers.length === 0 && visPlayers.length === 0) return null;

  return (
    <div
      className="px-6 py-4 flex gap-8 overflow-x-auto"
      style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
    >
      <PlayerList players={homePlayers} color="var(--home-color)" label={homeTeam.name} />
      <div style={{ width: 1, background: "var(--border)", flexShrink: 0 }} />
      <PlayerList players={visPlayers} color="var(--visitor-color)" label={visitorTeam.name} />
    </div>
  );
}

function PlayerList({ players, color, label }: { readonly players: TeamState["players"]; readonly color: string; readonly label: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: "var(--text-dim)" }}>
        {label} — On Court
      </p>
      <div className="flex flex-wrap gap-2">
        {players.map(p => (
          <div
            key={p.number}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-bold"
            style={{ background: `${color}18`, border: `1px solid ${color}33`, color }}
          >
            <span>#{p.number}</span>
            {p.name && <span className="font-normal" style={{ color: "var(--text-secondary)" }}>{p.name}</span>}
            {p.faults > 0 && <span style={{ color: "var(--danger)" }}>F{p.faults}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
