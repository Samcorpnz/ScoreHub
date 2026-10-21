"use client";

/**
 * Scorebug — compact corner widget, transparent background.
 * Add as a Browser Source in OBS/vMix at ~480×100, position top-right or top-left.
 * No chroma key needed — but ?key=green|blue (Graphics add-on) gives a solid
 * key colour for switchers that can't take an alpha channel.
 *
 * URL params:
 *   ?position=tr|tl|br|bl  — which corner (default: top-right)
 *   ?size=sm|md|lg          — overall scale (default: md)
 *   ?key=green|blue         — chroma key background (Graphics add-on)
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";
import { useMatchState } from "../../hooks/useMatchState";
import { useDisplayTheme } from "../../hooks/useDisplayTheme";
import { useChromaKey, KEYED_PANEL_VARS } from "../../hooks/useChromaKey";
import { useInterpolatedClock } from "../../hooks/useInterpolatedClock";
import { formatClockDisplay, formatScore } from "../../types";
import { getPeriodText } from "../../sport-templates";
import { DisplayLinkExpiredNotice } from "../components/DisplayLinkExpiredNotice";
import { PoweredByWatermark } from "../components/PoweredByWatermark";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

export default function ScorebugPage() {
  return (
    <Suspense>
      <Scorebug />
    </Suspense>
  );
}

function scorebugScale(size: string): number {
  if (size === "sm") return 0.75;
  if (size === "lg") return 1.3;
  return 1;
}

function resolveScorebugLogo(logoUrl: string | undefined): string | null {
  if (!logoUrl) return null;
  return logoUrl.startsWith("/logos/") ? `${RELAY_URL}${logoUrl}` : logoUrl;
}

function Scorebug() {
  const params   = useSearchParams();
  const position = (params.get("position") as string) || "tr";
  const size     = (params.get("size")     as string) || "md";

  const { state, unauthorized } = useMatchState();
  const { home, visitor, clockSeconds, countDown, isRunning, hornActive, possession } = state;
  const displayClock = useInterpolatedClock({ clockSeconds, isRunning, countDown, clockAnchorMs: state.clockAnchorMs, clockCarryMs: state.clockCarryMs });
  const { backgroundColor: _bg, backgroundImage: _bi, backgroundSize: _bs, backgroundPosition: _bp, textScale: _ts, competitionLogoUrl: _cl, ...themeVars } = useDisplayTheme(state.displayTheme, "scorebug");
  const chromaKey = useChromaKey();

  if (unauthorized) return <DisplayLinkExpiredNotice />;

  const homeColor    = home.color    || "#F59E0B";
  const visitorColor = visitor.color || "#818CF8";

  const scale = scorebugScale(size);

  const align = position.includes("l") ? "flex-start" : "flex-end";
  const vAlign = position.includes("b") ? "flex-end" : "flex-start";

  const homeLogo    = resolveScorebugLogo(home.logoUrl);
  const visitorLogo = resolveScorebugLogo(visitor.logoUrl);
  const clockColor  = hornActive ? "#EF4444" : isRunning ? "#fff" : "#94A3B8";
  const periodText  = getPeriodText(state);

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: chromaKey ?? "transparent",
      display: "flex",
      alignItems: vAlign,
      justifyContent: align,
      padding: 16,
      ...themeVars,
      ...(chromaKey && KEYED_PANEL_VARS),
    }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: `${position.includes("l") ? "left" : "right"} ${position.includes("b") ? "bottom" : "top"}` }}>
        <div style={{
          display: "flex",
          alignItems: "stretch",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "var(--keyed-panel-shadow, 0 4px 24px rgba(0,0,0,0.8))",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          fontSize: 14,
        }}>
          {/* Home */}
          <TeamBlock
            name={home.name || "HOME"}
            score={formatScore(state, "home")}
            color={homeColor}
            hasPossession={possession === "home" || possession === "both"}
            logoSrc={homeLogo}
            side="home"
          />

          {/* Clock + period */}
          <div style={{
            background: "var(--keyed-panel-bg, rgba(7,9,15,0.95))",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "6px 14px",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            minWidth: 90,
            gap: 2,
          }}>
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: "calc(1.4rem * var(--clock-scale, 1))",
              fontWeight: 700,
              color: clockColor,
              letterSpacing: "0.05em",
              lineHeight: 1,
            }}>
              {formatClockDisplay(displayClock)}
            </span>
            <span style={{
              fontSize: "calc(0.6rem * var(--period-scale, 1))",
              fontWeight: 800,
              letterSpacing: "0.2em",
              color: state.periodBreak ? "rgb(251,146,60)" : "var(--accent)",
              textTransform: "uppercase",
            }}>
              {periodText}
            </span>
            {!isRunning && !state.periodBreak && (
              <span style={{ fontSize: "0.5rem", color: "#94A3B8", letterSpacing: "0.15em", textTransform: "uppercase" }}>PAUSED</span>
            )}
          </div>

          {/* Visitor */}
          <TeamBlock
            name={visitor.name || "VISITOR"}
            score={formatScore(state, "visitor")}
            color={visitorColor}
            hasPossession={possession === "visitor" || possession === "both"}
            logoSrc={visitorLogo}
            side="visitor"
          />
        </div>
        <PoweredByWatermark inline />
      </div>
    </div>
  );
}

function TeamBlock({ name, score, color, hasPossession, logoSrc, side }: {
  name: string; score: string; color: string;
  hasPossession: boolean; logoSrc: string | null; side: "home" | "visitor";
}) {
  return (
    <div style={{
      background: "var(--keyed-panel-bg, rgba(7,9,15,0.95))",
      display: "flex",
      flexDirection: side === "home" ? "row" : "row-reverse",
      alignItems: "center",
      gap: 10,
      padding: "8px 16px",
      minWidth: 140,
      position: "relative",
    }}>
      {/* Colour accent */}
      <div style={{
        position: "absolute",
        [side === "home" ? "left" : "right"]: 0,
        top: 0,
        bottom: 0,
        width: 4,
        background: color,
        boxShadow: `0 0 10px ${color}`,
      }} />

      {/* Logo or initials */}
      <div style={{
        width: 36, height: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {logoSrc ? (
          <Image src={logoSrc} alt={name} width={34} height={34} style={{ objectFit: "contain" }} />
        ) : (
          <div style={{
            width: 34, height: 34, borderRadius: 4,
            background: `${color}22`, border: `1px solid ${color}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.6rem", fontWeight: 900, color, letterSpacing: "0.05em",
          }}>
            {name.slice(0, 3).toUpperCase()}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: side === "home" ? "flex-start" : "flex-end" }}>
        <span style={{
          fontSize: "calc(0.6rem * var(--name-scale, 1))", fontWeight: 700, letterSpacing: "0.12em",
          textTransform: "uppercase", color: "rgba(255,255,255,0.45)",
          whiteSpace: "nowrap",
        }}>
          {name}
          {hasPossession && <span style={{ color, marginLeft: 5 }}>●</span>}
        </span>
        <span data-testid={`display-score-${side}`} style={{
          fontVariantNumeric: "tabular-nums", fontWeight: 900,
          fontSize: "calc(2rem * var(--score-scale, 1))", color, lineHeight: 1,
          textShadow: `0 0 16px ${color}55`,
        }}>
          {score}
        </span>
      </div>
    </div>
  );
}
