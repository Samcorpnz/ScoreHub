"use client";

/**
 * Fullscreen display — designed to fill a second monitor or be captured by a
 * hardware capture card (Elgato, AVerMedia, Magewell etc.).
 *
 * Press F to toggle fullscreen. Press 1/2/3 to switch sub-layouts.
 * No scrollbars, no browser chrome should be visible when windowed to a screen.
 */

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { useMatchState } from "../../hooks/useMatchState";
import { useDisplayTheme } from "../../hooks/useDisplayTheme";
import { useInterpolatedClock } from "../../hooks/useInterpolatedClock";
import { ClockPanel } from "../../components/ClockPanel";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { TeamState, Possession, formatClockDisplay, formatScore } from "../../types";
import { getPeriodLabel, getTemplate } from "../../sport-templates";
import { DisplayLinkExpiredNotice } from "../components/DisplayLinkExpiredNotice";
import { PoweredByWatermark } from "../components/PoweredByWatermark";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

type Layout = "wide" | "stacked" | "minimal";

export default function FullscreenDisplay() {
  const { state, status, relayUnreachable, unauthorized } = useMatchState();
  const [layout, setLayout] = useState<Layout>("wide");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHud, setShowHud] = useState(true);
  const { textScale: _ts, competitionLogoUrl: _cl, ...themeStyle } = useDisplayTheme(state.displayTheme);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      if (e.key === "1") setLayout("wide");
      if (e.key === "2") setLayout("stacked");
      if (e.key === "3") setLayout("minimal");
      if (e.key === "h" || e.key === "H") setShowHud(v => !v);
    };
    globalThis.addEventListener("keydown", handler);

    const fsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fsChange);

    return () => {
      globalThis.removeEventListener("keydown", handler);
      document.removeEventListener("fullscreenchange", fsChange);
    };
  }, [toggleFullscreen]);

  // Auto-hide HUD after 3 seconds of no mouse movement
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const show = () => { setShowHud(true); clearTimeout(timer); timer = setTimeout(() => setShowHud(false), 3000); };
    globalThis.addEventListener("mousemove", show);
    timer = setTimeout(() => setShowHud(false), 3000);
    return () => { globalThis.removeEventListener("mousemove", show); clearTimeout(timer); };
  }, []);

  if (unauthorized) return <DisplayLinkExpiredNotice />;

  return (
    <div
      style={{
        width: "100vw", height: "100vh", overflow: "hidden",
        position: "relative",
        cursor: showHud ? "default" : "none",
        ...themeStyle,
      }}
    >
      {/* HUD overlay — fades out after inactivity */}
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 10, pointerEvents: showHud ? "auto" : "none",
          opacity: showHud ? 1 : 0, transition: "opacity 400ms",
        }}
      >
        <div className="absolute top-4 right-4 flex items-center gap-3">
          <ConnectionBadge status={status} relayUnreachable={relayUnreachable} />
          <LayoutPicker layout={layout} setLayout={setLayout} />
          <button
            onClick={toggleFullscreen}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            {isFullscreen ? "⛶ Exit" : "⛶ Fullscreen"} [F]
          </button>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs" style={{ color: "var(--text-dim)" }}>
          H = toggle HUD · 1/2/3 = layout · F = fullscreen
        </div>
      </div>

      <PoweredByWatermark />

      {/* Display content */}
      {layout === "wide"    && <WideLayout    state={state} relayUrl={RELAY_URL} />}
      {layout === "stacked" && <StackedLayout state={state} relayUrl={RELAY_URL} />}
      {layout === "minimal" && <MinimalLayout state={state} />}
    </div>
  );
}

// ─── Layout: Wide (default) ───────────────────────────────────────────────────

function WideLayout({ state, relayUrl }: { readonly state: ReturnType<typeof useMatchState>["state"]; readonly relayUrl: string }) {
  const { home, visitor, clockSeconds, period, isRunning, hornActive, matchName, possession } = state;
  const periodLabel  = getPeriodLabel(state);
  const DisplayStats = getTemplate(state.sport).displayStats;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* Home side */}
        <TeamSide team={home} side="home" possession={possession} relayUrl={relayUrl} scoreText={formatScore(state, "home")} />

        {/* Center divider with clock */}
        <div
          className="flex flex-col items-center justify-center px-12"
          style={{ flexShrink: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}
        >
          <ClockPanel clockSeconds={clockSeconds} countDown={state.countDown} period={period} periodBreak={state.periodBreak} periodLabel={periodLabel} isRunning={isRunning} hornActive={hornActive} matchName={matchName} clockAnchorMs={state.clockAnchorMs} clockCarryMs={state.clockCarryMs} />
        </div>

        {/* Visitor side */}
        <TeamSide team={visitor} side="visitor" possession={possession} relayUrl={relayUrl} scoreText={formatScore(state, "visitor")} />
      </div>

      {DisplayStats && (
        <div className="flex justify-center pb-6 flex-shrink-0">
          <DisplayStats state={state} variant="compact" />
        </div>
      )}
    </div>
  );
}

function TeamSide({ team, side, possession, relayUrl, scoreText }: { readonly team: TeamState; readonly side: "home" | "visitor"; readonly possession: Possession; readonly relayUrl: string; readonly scoreText: string }) {
  const color = team.color || (side === "home" ? "#F59E0B" : "#818CF8");
  const hasPossession = possession === side || possession === "both";

  let logoSrc: string | null;
  if (!team.logoUrl) {
    logoSrc = null;
  } else if (team.logoUrl.startsWith("/logos/")) {
    logoSrc = `${relayUrl}${team.logoUrl}`;
  } else {
    logoSrc = team.logoUrl;
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6" style={{ position: "relative" }}>
      {/* Colour accent strip at top */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: color, boxShadow: `0 0 24px ${color}88` }} />

      {/* Possession glow */}
      <div style={{
        position: "absolute", inset: 0, opacity: hasPossession ? 1 : 0, transition: "opacity 300ms",
        background: `radial-gradient(ellipse at ${side === "home" ? "100%" : "0%"} 50%, ${color}0a 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {logoSrc && (
        <Image src={logoSrc} alt={team.name} width={120} height={120}
          style={{ objectFit: "contain", filter: "drop-shadow(0 0 20px rgba(0,0,0,0.6))" }} />
      )}
      <p className="uppercase font-bold tracking-widest" style={{ fontSize: "1.2rem", color: "var(--text-secondary)", letterSpacing: "0.2em" }}>
        {team.name}
      </p>
      <p data-testid={`display-score-${side}`} className="score-digit" style={{ fontSize: "calc(12rem * var(--text-scale, 1))", color, textShadow: `0 0 80px ${color}33`, lineHeight: 0.9 }}>
        {scoreText}
      </p>
      {(team.faults > 0 || team.timeouts > 0) && (
        <div className="flex gap-6 text-sm" style={{ color: "var(--text-dim)" }}>
          {team.faults  > 0 && <span><span style={{ color: "var(--danger)" }}>{team.faults}</span> FLS</span>}
          {team.timeouts > 0 && <span><span style={{ color: "var(--accent)" }}>{team.timeouts}</span> TOs</span>}
        </div>
      )}
    </div>
  );
}

// ─── Layout: Stacked ─────────────────────────────────────────────────────────

function StackedLayout({ state, relayUrl }: { readonly state: ReturnType<typeof useMatchState>["state"]; readonly relayUrl: string }) {
  const { home, visitor, clockSeconds, period, isRunning, hornActive, matchName } = state;
  const periodLabel = getPeriodLabel(state);
  const DisplayStats = getTemplate(state.sport).displayStats;
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center" style={{ borderBottom: "1px solid var(--border)" }}>
        <TeamSide team={home} side="home" possession={state.possession} relayUrl={relayUrl} scoreText={formatScore(state, "home")} />
      </div>
      <div className="flex items-center justify-center py-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <ClockPanel clockSeconds={clockSeconds} countDown={state.countDown} period={period} periodBreak={state.periodBreak} periodLabel={periodLabel} isRunning={isRunning} hornActive={hornActive} matchName={matchName} clockAnchorMs={state.clockAnchorMs} clockCarryMs={state.clockCarryMs} />
      </div>
      <div className="flex-1 flex items-center justify-center" style={{ borderBottom: DisplayStats ? "1px solid var(--border)" : undefined }}>
        <TeamSide team={visitor} side="visitor" possession={state.possession} relayUrl={relayUrl} scoreText={formatScore(state, "visitor")} />
      </div>
      {DisplayStats && (
        <div className="flex justify-center py-4 flex-shrink-0">
          <DisplayStats state={state} variant="compact" />
        </div>
      )}
    </div>
  );
}

// ─── Layout: Minimal ─────────────────────────────────────────────────────────

function MinimalLayout({ state }: { readonly state: ReturnType<typeof useMatchState>["state"] }) {
  const { home, visitor, clockSeconds, countDown, period, isRunning } = state;
  const homeColor    = home.color    || "#F59E0B";
  const visitorColor = visitor.color || "#818CF8";
  const displayClock = useInterpolatedClock({ clockSeconds, isRunning, countDown, clockAnchorMs: state.clockAnchorMs, clockCarryMs: state.clockCarryMs });
  const periodLabel = getPeriodLabel(state);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      {state.matchName && (
        <p className="uppercase tracking-widest font-semibold" style={{ fontSize: "1rem", color: "var(--text-dim)" }}>
          {state.matchName}
        </p>
      )}
      <div className="flex items-center gap-16">
        <div className="text-center">
          <p className="uppercase font-bold tracking-widest mb-2" style={{ fontSize: "1rem", color: "var(--text-secondary)" }}>{home.name}</p>
          <p data-testid="display-score-home" className="score-digit" style={{ fontSize: "calc(14rem * var(--text-scale, 1))", color: homeColor, lineHeight: 0.85 }}>{formatScore(state, "home")}</p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <p className="clock-digit" style={{ fontSize: "calc(5rem * var(--text-scale, 1))", color: isRunning ? "#fff" : "var(--text-secondary)" }}>
            {formatClockDisplay(displayClock)}
          </p>
          <p className="font-black tracking-widest" style={{ fontSize: "calc(2rem * var(--text-scale, 1))", color: state.periodBreak ? "rgb(251,146,60)" : "var(--accent)" }}>
            {(() => {
              if (!state.periodBreak) return `${periodLabel} ${period}`;
              return periodLabel === "HALF" ? "HALF TIME" : `${periodLabel} BREAK`;
            })()}
          </p>
        </div>
        <div className="text-center">
          <p className="uppercase font-bold tracking-widest mb-2" style={{ fontSize: "1rem", color: "var(--text-secondary)" }}>{visitor.name}</p>
          <p data-testid="display-score-visitor" className="score-digit" style={{ fontSize: "calc(14rem * var(--text-scale, 1))", color: visitorColor, lineHeight: 0.85 }}>{formatScore(state, "visitor")}</p>
        </div>
      </div>
    </div>
  );
}

function LayoutPicker({ layout, setLayout }: { readonly layout: Layout; readonly setLayout: (l: Layout) => void }) {
  const options: { key: Layout; label: string }[] = [
    { key: "wide",    label: "Wide [1]"    },
    { key: "stacked", label: "Stack [2]"   },
    { key: "minimal", label: "Minimal [3]" },
  ];
  return (
    <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => setLayout(o.key)}
          className="px-3 py-1.5 text-xs font-bold"
          style={{
            background: layout === o.key ? "var(--accent-dim)" : "var(--bg-elevated)",
            color: layout === o.key ? "var(--accent)" : "var(--text-secondary)",
            borderRight: "1px solid var(--border)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
