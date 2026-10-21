"use client";

import type { CricketFormat, CricketState, MatchState } from "../../types";
import type { DisplayStatsProps } from "../../sport-templates";

const OVERS_PER_INNINGS: Record<CricketFormat, number> = { t20: 20, odi: 50, test: 90 };

function getCricketState(state: MatchState): CricketState | undefined {
  const cs = state.sportState as CricketState | undefined;
  return cs?.sport === "cricket" ? cs : undefined;
}

export function CricketDisplayStats({ state, variant = "full" }: Readonly<DisplayStatsProps>) {
  const cricket = getCricketState(state);
  if (!cricket) return null;

  const inn = cricket.innings.at(-1)!;
  const battingTeam = state[inn.battingTeam];
  const bowlingTeam = state[inn.battingTeam === "home" ? "visitor" : "home"];
  const batter1 = inn.batters[inn.currentBatter1Index];
  const batter2 = inn.batters[inn.currentBatter2Index];
  const bowler = inn.bowlers[inn.currentBowlerIndex];

  const ballsBowled = inn.oversComplete * 6 + inn.ballsThisOver;
  const crr = ballsBowled > 0 ? (inn.runs / (ballsBowled / 6)).toFixed(2) : "0.00";

  if (variant === "compact") {
    return (
      <div
        className="flex items-center justify-between px-5 py-2 rounded-lg"
        style={{ background: "var(--keyed-panel-bg, rgba(7,9,15,0.92))", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      >
        <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
          CRR <span style={{ color: "var(--accent)" }}>{crr}</span>
          {inn.target !== undefined && (
            <span className="ml-4" style={{ color: "rgb(251,146,60)" }}>
              Need {Math.max(0, inn.target - inn.runs)} runs
            </span>
          )}
        </span>
        <div className="flex gap-1.5">
          {inn.thisOverBalls.length ? inn.thisOverBalls.map((b, i) => (
            <span key={`${i}-${b}`} className="text-xs font-bold px-1.5" style={{ color: "var(--text-primary)" }}>{b}</span>
          )) : <span className="text-xs" style={{ color: "var(--text-dim)" }}>—</span>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)" }} className="p-6">
      {inn.target !== undefined && (
        <div
          className="rounded-xl p-4 mb-6 flex items-center justify-between"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm font-bold" style={{ color: "rgb(251,146,60)" }}>
            Target {inn.target} · need {Math.max(0, inn.target - inn.runs)} runs
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            RRR {(() => {
              const ballsLeft = Math.max(0, 6 * OVERS_PER_INNINGS[cricket.format] - ballsBowled);
              return ballsLeft > 0 ? ((Math.max(0, inn.target - inn.runs)) / (ballsLeft / 6)).toFixed(2) : "—";
            })()}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <p className="text-xs uppercase tracking-widest font-bold" style={{ color: "var(--text-dim)" }}>
          {battingTeam.name || inn.battingTeam} batting · {cricket.format.toUpperCase()} · Innings {cricket.inningsNumber}
        </p>
        {inn.freeHit ? (
          <p className="font-black tracking-widest uppercase" style={{ fontSize: "1rem", color: "var(--danger)" }}>⚡ Free Hit</p>
        ) : (
          <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>CRR {crr}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-dim)" }}>Batting</p>
          {[batter1, batter2].map((b, i) => b && (
            <div key={b.playerId} className="flex justify-between text-sm py-1">
              <span style={{ color: i === 0 ? "var(--accent)" : "var(--text-secondary)" }}>{b.name}{i === 0 ? " *" : ""}</span>
              <span style={{ color: "var(--text-primary)" }}>{b.runs} ({b.ballsFaced}) · {b.fours}×4 {b.sixes}×6</span>
            </div>
          ))}
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-dim)" }}>Bowling</p>
          {bowler && (
            <div className="flex justify-between text-sm py-1">
              <span style={{ color: "var(--text-secondary)" }}>{bowler.name}</span>
              <span style={{ color: "var(--text-primary)" }}>
                {bowler.overs}.{bowler.ballsThisOver}-{bowler.maidens}-{bowler.runs}-{bowler.wickets}
              </span>
            </div>
          )}
          <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>{bowlingTeam.name || "Bowling side"}</p>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-dim)" }}>This over</p>
        <div className="flex gap-2 flex-wrap">
          {inn.thisOverBalls.length ? inn.thisOverBalls.map((b, i) => (
            <span
              key={`${i}-${b}`}
              className="rounded-lg px-3 py-1.5 text-sm font-bold"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            >
              {b}
            </span>
          )) : <span className="text-sm" style={{ color: "var(--text-dim)" }}>—</span>}
        </div>
      </div>
    </div>
  );
}
