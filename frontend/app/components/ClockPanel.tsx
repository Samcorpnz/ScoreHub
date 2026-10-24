"use client";

import { formatClockDisplay } from "../types";
import { useInterpolatedClock } from "../hooks/useInterpolatedClock";

interface Props {
  clockSeconds: number;
  countDown: boolean;
  period: string;
  periodBreak?: boolean;
  periodLabel?: string;
  // Shown instead of the period during a break; defaults to "<label> BREAK"
  breakLabel?: string;
  // A short flag under the period, e.g. Fast5's "POWER PLAY"
  notice?: string;
  // A penalty shoot-out: takes the period's place, with each side's attempts
  shootout?: { label: string; home: boolean[]; visitor: boolean[]; homeGoals: number; visitorGoals: number };
  isRunning: boolean;
  hornActive: boolean;
  matchName?: string;
  size?: "full" | "compact";
  clockAnchorMs?: number;
  clockCarryMs?: number;
}

// Spelled out under the period number once a match is past regulation
const EXTRA_TIME_SUBTEXT: Record<string, string> = { ET: "EXTRA TIME", OT: "OVERTIME", GP: "GOLDEN POINT" };

function clockTextShadow(isRunning: boolean, hornActive: boolean): string {
  if (hornActive) return "0 0 30px rgba(239,68,68,0.5)";
  if (isRunning) return "0 0 30px rgba(255,255,255,0.15)";
  return "none";
}

export function ClockPanel({ clockSeconds, countDown, period, periodBreak, periodLabel = "QTR", breakLabel, notice, shootout, isRunning, hornActive, matchName, size = "full", clockAnchorMs, clockCarryMs }: Readonly<Props>) {
  const isCompact = size === "compact";
  const display = useInterpolatedClock({ clockSeconds, isRunning, countDown, clockAnchorMs, clockCarryMs });
  let clockColor: string;
  if (hornActive) clockColor = "var(--danger)";
  else if (isRunning) clockColor = "var(--text-primary)";
  else clockColor = "var(--text-secondary)";

  let periodHeadline: string;
  if (!periodBreak) periodHeadline = period;
  else periodHeadline = breakLabel ?? (periodLabel === "HALF" ? "HALF TIME" : `${periodLabel} BREAK`);

  const periodSubtext = period === "E" ? "EXTRA TIME" : EXTRA_TIME_SUBTEXT[periodLabel] ?? periodLabel;
  const periodColor = periodBreak ? "rgb(251,146,60)" : "var(--accent)";

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      {/* Match name */}
      {!isCompact && matchName && (
        <p
          className="uppercase tracking-widest font-semibold text-center"
          style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}
        >
          {matchName}
        </p>
      )}

      {/* Clock */}
      <div
        data-testid="display-clock"
        className={`clock-digit ${hornActive ? "horn-active" : ""}`}
        style={{
          fontSize: isCompact ? "calc(2rem * var(--clock-scale, 1))" : "calc(4.5rem * var(--text-scale, 1) * var(--clock-scale, 1))",
          color: clockColor,
          textShadow: clockTextShadow(isRunning, hornActive),
        }}
      >
        {formatClockDisplay(display)}
      </div>

      {shootout && (
        <div data-testid="display-shootout" className="flex flex-col items-center gap-1">
          <p className="uppercase font-black tracking-widest" style={{ fontSize: isCompact ? "0.8rem" : "calc(1.1rem * var(--text-scale, 1))", color: "var(--accent)" }}>
            {shootout.label}
          </p>
          <p className="score-digit" style={{ fontSize: isCompact ? "1.2rem" : "calc(2rem * var(--text-scale, 1))", color: "var(--text-primary)" }}>
            {shootout.homeGoals} – {shootout.visitorGoals}
          </p>
          <ShootoutAttempts attempts={shootout.home} color="var(--home-color)" />
          <ShootoutAttempts attempts={shootout.visitor} color="var(--visitor-color)" />
        </div>
      )}

      {/* Period */}
      {!shootout && <div className="flex flex-col items-center gap-1">
        <p
          data-testid="display-period"
          className="uppercase font-black tracking-widest"
          style={{ fontSize: isCompact ? "calc(1.2rem * var(--period-scale, 1))" : "calc(2rem * var(--text-scale, 1) * var(--period-scale, 1))", color: periodColor }}
        >
          {periodHeadline}
        </p>
        {!periodBreak && (
          <p
            className="uppercase tracking-widest font-semibold"
            style={{ fontSize: "0.6rem", color: "var(--text-dim)" }}
          >
            {periodSubtext}
          </p>
        )}
        {notice && !periodBreak && (
          <p
            data-testid="display-notice"
            className="uppercase font-black tracking-widest rounded-full px-3 py-1"
            style={{
              fontSize: isCompact ? "0.6rem" : "calc(0.8rem * var(--text-scale, 1))",
              color: "rgb(250,204,21)", background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.35)",
            }}
          >
            {notice}
          </p>
        )}
      </div>}

      {/* Running indicator */}
      {!isCompact && <RunningIndicator isRunning={isRunning} />}
    </div>
  );
}

// One mark per attempt in the order taken: filled = scored, hollow = missed
export function ShootoutAttempts({ attempts, color }: { readonly attempts: readonly boolean[]; readonly color: string }) {
  return (
    <div className="flex items-center gap-1" style={{ minHeight: 12 }}>
      {attempts.map((scored, i) => (
        <span
          // attempts are positional and only ever appended or popped
          key={i} // NOSONAR — no identity beyond position
          title={scored ? "Scored" : "Missed"}
          style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${color}`, background: scored ? color : "transparent" }}
        />
      ))}
    </div>
  );
}

function RunningIndicator({ isRunning }: { readonly isRunning: boolean }) {
  const stateColor = isRunning ? "var(--running)" : "var(--stopped)";
  return (
    <div
      data-testid="display-running-indicator"
      className="flex items-center gap-1.5 rounded-full px-3 py-1"
      style={{
        background: isRunning ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.08)",
        border: `1px solid ${isRunning ? "rgba(34,197,94,0.25)" : "rgba(148,163,184,0.15)"}`,
      }}
    >
      <span
        className="status-dot"
        style={{ background: stateColor, boxShadow: isRunning ? "0 0 6px var(--running)" : "none" }}
      />
      <span className="text-xs font-bold tracking-widest uppercase" style={{ color: stateColor }}>
        {isRunning ? "LIVE" : "PAUSED"}
      </span>
    </div>
  );
}
