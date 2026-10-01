"use client";

import { formatClockDisplay } from "../types";
import { useInterpolatedClock } from "../hooks/useInterpolatedClock";

interface Props {
  clockSeconds: number;
  countDown: boolean;
  period: string;
  periodBreak?: boolean;
  periodLabel?: string;
  isRunning: boolean;
  hornActive: boolean;
  matchName?: string;
  size?: "full" | "compact";
  clockAnchorMs?: number;
  clockCarryMs?: number;
}

function clockTextShadow(isRunning: boolean, hornActive: boolean): string {
  if (hornActive) return "0 0 30px rgba(239,68,68,0.5)";
  if (isRunning) return "0 0 30px rgba(255,255,255,0.15)";
  return "none";
}

export function ClockPanel({ clockSeconds, countDown, period, periodBreak, periodLabel = "QTR", isRunning, hornActive, matchName, size = "full", clockAnchorMs, clockCarryMs }: Props) {
  const isCompact = size === "compact";
  const display = useInterpolatedClock({ clockSeconds, isRunning, countDown, clockAnchorMs, clockCarryMs });
  let clockColor: string;
  if (hornActive) clockColor = "var(--danger)";
  else if (isRunning) clockColor = "var(--text-primary)";
  else clockColor = "var(--text-secondary)";

  let periodHeadline: string;
  if (!periodBreak) periodHeadline = period;
  else periodHeadline = periodLabel === "HALF" ? "HALF TIME" : `${periodLabel} BREAK`;

  const periodSubtext = period === "E" ? "EXTRA TIME" : periodLabel;
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
          fontSize: isCompact ? "2rem" : "calc(4.5rem * var(--text-scale, 1))",
          color: clockColor,
          textShadow: clockTextShadow(isRunning, hornActive),
        }}
      >
        {formatClockDisplay(display)}
      </div>

      {/* Period */}
      <div className="flex flex-col items-center gap-1">
        <p
          data-testid="display-period"
          className="uppercase font-black tracking-widest"
          style={{ fontSize: isCompact ? "1.2rem" : "calc(2rem * var(--text-scale, 1))", color: periodColor }}
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
      </div>

      {/* Running indicator */}
      {!isCompact && <RunningIndicator isRunning={isRunning} />}
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
