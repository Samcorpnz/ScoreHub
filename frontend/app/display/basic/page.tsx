"use client";

import { useMatchState } from "../../hooks/useMatchState";
import { useDisplayTheme } from "../../hooks/useDisplayTheme";
import { ScorePanel } from "../../components/ScorePanel";
import { ClockPanel } from "../../components/ClockPanel";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { getPeriodLabel, getTemplate } from "../../sport-templates";
import { formatScore } from "../../types";
import { DisplayLinkExpiredNotice } from "../components/DisplayLinkExpiredNotice";
import { PoweredByWatermark } from "../components/PoweredByWatermark";

export default function BasicDisplay() {
  const { state, status, relayUnreachable, unauthorized } = useMatchState();
  const { textScale: _textScale, competitionLogoUrl: _cl, ...themeStyle } = useDisplayTheme(state.displayTheme);
  const DisplayStats = getTemplate(state.sport).displayStats;

  if (unauthorized) return <DisplayLinkExpiredNotice />;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-8"
      style={themeStyle}
    >
      {/* Connection badge — top right */}
      <div className="fixed top-4 right-4 z-10">
        <ConnectionBadge status={status} relayUnreachable={relayUnreachable} />
      </div>
      <PoweredByWatermark />

      {/* Match name */}
      {state.matchName && (
        <p
          className="mb-8 uppercase tracking-widest font-semibold"
          style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}
        >
          {state.matchName}
        </p>
      )}

      {/* Main scoreboard */}
      <div
        className="relative flex items-center gap-0 w-full max-w-3xl rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 0 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Home strip accent */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ background: "var(--home-color)" }}
        />
        {/* Visitor strip accent */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1"
          style={{ background: "var(--visitor-color)" }}
        />

        {/* Home team */}
        <div className="flex-1 flex justify-center py-10 pl-8">
          <ScorePanel team={state.home} side="home" possession={state.possession} scoreText={formatScore(state, "home")} />
        </div>

        {/* Divider + clock */}
        <div
          className="flex flex-col items-center px-8 py-10"
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
            matchName={state.matchName}
            clockAnchorMs={state.clockAnchorMs}
            clockCarryMs={state.clockCarryMs}
          />
        </div>

        {/* Visitor team */}
        <div className="flex-1 flex justify-center py-10 pr-8">
          <ScorePanel team={state.visitor} side="visitor" possession={state.possession} scoreText={formatScore(state, "visitor")} />
        </div>
      </div>

      {DisplayStats && (
        <div className="w-full max-w-3xl mt-6 rounded-2xl overflow-hidden" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <DisplayStats state={state} variant="full" />
        </div>
      )}

      {/* Input source */}
      {state.inputSource !== "none" && (
        <p className="mt-6 text-xs" style={{ color: "var(--text-dim)" }}>
          Source: {state.inputSource}
        </p>
      )}
    </div>
  );
}
