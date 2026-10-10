"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMatchState } from "../../hooks/useMatchState";
import { useControlToken } from "../../hooks/useControlToken";
import { useInterpolatedClock } from "../../hooks/useInterpolatedClock";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { MatchState, formatClock } from "../../types";
import { getTemplate, getMatchLength } from "../../sport-templates";

const CLOCK_PRESETS = [5, 8, 10, 12, 15, 20, 25, 30, 40, 45].map(m => ({
  label: `${m}m`,
  secs: m * 60,
}));

export default function MobileControl() {
  return (
    <Suspense fallback={null}>
      <MobileControlInner />
    </Suspense>
  );
}

function MobileControlInner() {
  const router = useRouter();
  // Same match scoping as the full panel (see control/page.tsx) — without it
  // the token is unscoped and this page scores the org's default room rather
  // than the match its displays are showing (SA-144).
  const matchId = useSearchParams().get("matchId") ?? undefined;
  const matchQuery = matchId ? `?matchId=${encodeURIComponent(matchId)}` : "";
  const controlToken = useControlToken(matchId);
  const {
    state, status, feedStale, relayUnreachable, matchEnded, sendManualUpdate, sendReset, sendUndo, sendScoreAdjust,
    controllerStatus, takeControl, estimateServerNow,
  } = useMatchState({
    secret: controlToken,
    role: "control",
  });

  useSession({
    required: true,
    onUnauthenticated() {
      router.push(`/login?callbackUrl=${matchId ? encodeURIComponent(`/control/mobile${matchQuery}`) : "/control/mobile"}`);
    },
  });

  const [showSetTime, setShowSetTime]   = useState(false);
  const [customMins, setCustomMins]     = useState("");
  const [customSecs, setCustomSecs]     = useState("");

  // The relay is the sole clock authority (see resyncClock/applyManualUpdate)
  // — this page just displays its precise anchor/carry and sends plain
  // isRunning/clockSeconds patches, exactly like the desktop ScoreTab.
  const displayClock = useInterpolatedClock({
    clockSeconds: state.clockSeconds, isRunning: state.isRunning, countDown: state.countDown,
    clockAnchorMs: state.clockAnchorMs, clockCarryMs: state.clockCarryMs,
  });

  // Attach a latency-compensated click-instant timestamp whenever a patch
  // toggles isRunning, same as the desktop control panel's `push`.
  const push = (patch: Partial<MatchState>) =>
    sendManualUpdate("isRunning" in patch ? { ...patch, clientEventMs: estimateServerNow() } : patch);

  const toggleClock = () => push({ isRunning: !state.isRunning });

  const setClockTo = (secs: number) => {
    push({ clockSeconds: secs, isRunning: false });
    setShowSetTime(false);
    setCustomMins("");
    setCustomSecs("");
  };

  const clockRunning = state.isRunning;
  const increments   = getTemplate(state.sport).scoreIncrements;
  const period       = Number.parseInt(state.period || "1", 10);
  const periodLabel  = getTemplate(state.sport).periodLabel;
  const inControl    = controllerStatus === "granted";

  return (
    <div style={{
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-base)",
      color: "var(--text-primary)",
      overflow: "hidden",
      overscrollBehavior: "none",
      maxWidth: 480,
      margin: "0 auto",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: -0.5 }}>
          Score<span style={{ color: "var(--accent)" }}>Hub</span>
          <span style={{
            marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
            textTransform: "uppercase", color: "var(--text-dim)",
          }}>Mobile</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ConnectionBadge status={status} feedStale={feedStale} relayUnreachable={relayUnreachable} />
          <a href={`/control${matchQuery}`} style={{ fontSize: 11, color: "var(--text-dim)", textDecoration: "none" }}>
            Full panel ↗
          </a>
        </div>
      </div>

      {/* ── Ended match ── */}
      {matchEnded && (
        <div
          data-testid="match-ended-banner"
          style={{
            padding: "8px 16px", flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#ff3c3c",
            background: "rgba(255,60,60,0.12)", borderBottom: "1px solid rgba(255,60,60,0.3)",
          }}
        >
          This match has ended, so it can&apos;t be changed.{" "}
          <a href={`/control${matchQuery}`} style={{ color: "#ff3c3c", textDecoration: "underline" }}>Open the full panel</a> to reopen it.
        </div>
      )}

      {/* ── Controller status ── */}
      {controllerStatus !== "connecting" && (
        <div
          data-testid="mobile-controller-status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "6px 16px",
            background: inControl ? "rgba(0,200,100,0.10)" : "rgba(255,160,0,0.12)",
            borderBottom: `1px solid ${inControl ? "rgba(0,200,100,0.3)" : "rgba(255,160,0,0.3)"}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: inControl ? "#00c864" : "#ffa000" }}>
            {inControl ? "● IN CONTROL" : "○ VIEWING ONLY — another panel has control"}
          </span>
          {!inControl && (
            <button
              data-testid="take-control"
              onClick={takeControl}
              style={{
                padding: "5px 12px", borderRadius: 8, border: "none",
                background: "#ffa000", color: "#000", fontSize: 11, fontWeight: 800, cursor: "pointer",
              }}
            >
              Take Control
            </button>
          )}
        </div>
      )}

      {/* ── Teams + Scores ── */}
      <div style={{ display: "flex", gap: 8, padding: "12px 12px 8px", flexShrink: 0 }}>
        <TeamColumn
          label={state.home.name || "Home"}
          score={state.home.score}
          color={state.home.color || "var(--home-color)"}
          faults={state.home.faults}
          increments={increments}
          onScore={d => sendScoreAdjust({ side: "home", delta: d })}
          onFault={() => push({ home: { ...state.home, faults: state.home.faults + 1 } })}
        />
        <TeamColumn
          label={state.visitor.name || "Visitor"}
          score={state.visitor.score}
          color={state.visitor.color || "var(--visitor-color)"}
          faults={state.visitor.faults}
          increments={increments}
          onScore={d => sendScoreAdjust({ side: "visitor", delta: d })}
          onFault={() => push({ visitor: { ...state.visitor, faults: state.visitor.faults + 1 } })}
        />
      </div>

      {/* ── Clock ── */}
      <div style={{
        margin: "0 12px",
        padding: "12px 16px",
        background: "var(--bg-surface)",
        borderRadius: 16,
        border: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {/* Clock face */}
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <div className="clock-digit" style={{
            fontSize: 56,
            color: clockRunning ? "var(--text-primary)" : "var(--text-secondary)",
            lineHeight: 1,
          }}>
            {formatClock(Math.floor(displayClock))}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 2,
            textTransform: "uppercase", color: "var(--accent)", marginTop: 4,
          }}>
            {state.sport.replace("_", " ")} · {periodLabel} {state.period}
          </div>
        </div>

        {/* Start / Stop */}
        <button
          onClick={toggleClock}
          style={{
            width: "100%",
            padding: "15px 0",
            borderRadius: 12,
            border: `1px solid ${clockRunning ? "rgba(239,68,68,0.35)" : "var(--border-accent)"}`,
            background: clockRunning ? "rgba(239,68,68,0.12)" : "var(--accent-dim)",
            color: clockRunning ? "#EF4444" : "var(--accent)",
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          {clockRunning ? "■  STOP" : "▶  START"}
        </button>

        {/* Clock control row */}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <TinyBtn label={showSetTime ? "▲ Time" : "▼ Time"} onClick={() => setShowSetTime(v => !v)} />
          <TinyBtn
            label={`◀ ${periodLabel} ${Math.max(1, period - 1)}`}
            onClick={() => push({ period: String(Math.max(1, period - 1)) })}
          />
          <TinyBtn
            label={`${periodLabel} ${period + 1} ▶`}
            onClick={() => {
              const max = getMatchLength(state);
              if (max === undefined || period < max) push({ period: String(period + 1) });
            }}
          />
        </div>

        {/* Set-time panel */}
        {showSetTime && (
          <div style={{
            marginTop: 10, padding: 12, borderRadius: 10,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {CLOCK_PRESETS.map(p => (
                <button key={p.label} onClick={() => setClockTo(p.secs)} style={{
                  padding: "6px 10px", borderRadius: 7,
                  border: "1px solid var(--border-accent)", background: "var(--accent-dim)",
                  color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="number" placeholder="mm" value={customMins}
                onChange={e => setCustomMins(e.target.value)}
                style={{
                  flex: 1, padding: "8px 6px", borderRadius: 8, textAlign: "center",
                  border: "1px solid var(--border)", background: "var(--bg-base)",
                  color: "var(--text-primary)", fontSize: 16, fontWeight: 700,
                }}
              />
              <span style={{ color: "var(--text-dim)", fontWeight: 700 }}>:</span>
              <input
                type="number" placeholder="ss" value={customSecs}
                onChange={e => setCustomSecs(e.target.value)}
                style={{
                  flex: 1, padding: "8px 6px", borderRadius: 8, textAlign: "center",
                  border: "1px solid var(--border)", background: "var(--bg-base)",
                  color: "var(--text-primary)", fontSize: 16, fontWeight: 700,
                }}
              />
              <button
                onClick={() => {
                  const total = (Number.parseInt(customMins || "0", 10) * 60) + Number.parseInt(customSecs || "0", 10);
                  if (total > 0) setClockTo(total);
                }}
                style={{
                  padding: "8px 14px", borderRadius: 8,
                  border: "1px solid var(--border-accent)", background: "var(--accent-dim)",
                  color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                Set
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Possession ── */}
      <div style={{ padding: "8px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["home", "none", "visitor"] as const).map(p => (
            <button
              key={p}
              onClick={() => push({ possession: p })}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 10,
                border: `1px solid ${state.possession === p ? "var(--border-accent)" : "var(--border)"}`,
                background: state.possession === p ? "var(--accent-dim)" : "var(--bg-surface)",
                color: state.possession === p ? "var(--accent)" : "var(--text-secondary)",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {p === "none" ? "—" : p}
            </button>
          ))}
        </div>
      </div>

      {/* ── Undo / Reset ── */}
      <div style={{ padding: "0 12px 20px", marginTop: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={sendUndo}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          ↩ Undo
        </button>
        <button
          onClick={() => { if (confirm("Reset scores to 0? (Names and colours are kept)")) sendReset(); }}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 10,
            border: "1px solid rgba(239,68,68,0.2)",
            background: "rgba(239,68,68,0.05)",
            color: "var(--danger)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          Reset Match
        </button>
      </div>
    </div>
  );
}

// ── Team Column ───────────────────────────────────────────────────────────────

function TeamColumn({ label, score, color, faults, increments, onScore, onFault }: {
  readonly label: string;
  readonly score: number;
  readonly color: string;
  readonly faults: number;
  readonly increments: number[];
  readonly onScore: (d: number) => void;
  readonly onFault: () => void;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Team name */}
      <div style={{
        textAlign: "center", fontSize: 11, fontWeight: 700,
        letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-dim)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {label}
      </div>

      {/* Score */}
      <div className="score-digit" style={{ textAlign: "center", fontSize: 72, color, lineHeight: 1 }}>
        {score}
      </div>

      {/* Increment buttons */}
      <div style={{ display: "flex", gap: 5 }}>
        {increments.map(n => (
          <button
            key={n}
            onClick={() => onScore(n)}
            style={{
              flex: 1, padding: "13px 0", borderRadius: 10,
              border: "1px solid var(--border-accent)", background: "var(--accent-dim)",
              color: "var(--accent)", fontSize: 15, fontWeight: 800, cursor: "pointer",
            }}
          >
            +{n}
          </button>
        ))}
      </div>

      {/* Undo / Faults */}
      <div style={{ display: "flex", gap: 5 }}>
        <button
          onClick={() => onScore(-1)}
          style={{
            flex: 1, padding: "8px 0", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg-elevated)",
            color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          −1
        </button>
        <button
          onClick={onFault}
          style={{
            flex: 2, padding: "8px 0", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg-elevated)",
            color: "var(--text-secondary)", fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}
        >
          F: {faults}
        </button>
      </div>
    </div>
  );
}

// ── Tiny Button ───────────────────────────────────────────────────────────────

function TinyBtn({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "8px 0", borderRadius: 8,
        border: "1px solid var(--border)", background: "var(--bg-elevated)",
        color: "var(--text-secondary)", fontSize: 11, fontWeight: 700,
        cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
