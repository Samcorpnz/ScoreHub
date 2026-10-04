"use client";

import { useState, useEffect, useRef } from "react";
import { IndoorCricketState, formatClockDisplay, formatScore } from "../../types";
import { useInterpolatedClock } from "../../hooks/useInterpolatedClock";
import { parseClock } from "../lib/parseClock";
import { getTemplate, getMatchLength, ControlPanelProps } from "../../sport-templates";
import { ClockAdjustButtons, NameField, ScoreButtons, SectionLabel, SmallBtn } from "./primitives";

type Side = "home" | "visitor";
type AdjustFn = (args: { side: Side; delta: number }) => void;

// Keys 1/2/3 → increment[0/1/2]; Q/W/E → negative; mirror on right side (9/0/8, O/P/I).
// Returns true if the key matched a score-adjust binding (and applied it).
function tryScoreAdjustKey(key: string, inc: readonly number[], adjust: AdjustFn): boolean {
  const bindings: [string, Side, number, boolean][] = [
    ["1", "home", 0, false], ["2", "home", 1, false], ["3", "home", 2, false],
    ["q", "home", 0, true], ["Q", "home", 0, true], ["w", "home", 1, true], ["W", "home", 1, true], ["e", "home", 2, true], ["E", "home", 2, true],
    ["9", "visitor", 0, false], ["0", "visitor", 1, false], ["8", "visitor", 2, false],
    ["o", "visitor", 0, true], ["O", "visitor", 0, true], ["p", "visitor", 1, true], ["P", "visitor", 1, true], ["i", "visitor", 2, true], ["I", "visitor", 2, true],
  ];
  for (const [k, side, idx, negate] of bindings) {
    if (key !== k || inc[idx] === undefined) continue;
    adjust({ side, delta: negate ? -inc[idx] : inc[idx] });
    return true;
  }
  return false;
}

function periodStatusLabel(periodBreak: boolean, periodLabel: string, period: string, matchLength?: number): string {
  if (!periodBreak) return matchLength ? `${periodLabel} ${period} of ${matchLength}` : `${periodLabel} ${period}`;
  return periodLabel === "HALF" ? "HALF TIME" : `${periodLabel} BREAK`;
}

export function ScoreTab({
  state, push, sendReset, sendUndo,
  sendCricketBall, sendCricketOverComplete, sendCricketInningsChange, sendCricketDeclare,
  sendScoreAdjust, sendIndoorCricketWicket,
}: ControlPanelProps) {
  const [homeName,   setHomeName]   = useState("");
  const [visName,    setVisName]    = useState("");
  const [matchName,  setMatchName]  = useState("");
  const [period,     setPeriod]     = useState("");
  const [clockInput, setClockInput] = useState("");
  const displayClock = useInterpolatedClock({
    clockSeconds: state.clockSeconds, isRunning: state.isRunning, countDown: state.countDown,
    clockAnchorMs: state.clockAnchorMs, clockCarryMs: state.clockCarryMs,
  });

  // Keep stable refs so keyboard handlers don't go stale. Refreshed after each
  // commit; the handlers only read them from key events, never during render.
  const stateRef = useRef(state);
  const pushRef = useRef(push);
  const undoRef = useRef(sendUndo);
  const adjustRef = useRef(sendScoreAdjust);
  useEffect(() => {
    stateRef.current = state;
    pushRef.current = push;
    undoRef.current = sendUndo;
    adjustRef.current = sendScoreAdjust;
  });

  const isBasketball = state.sport === "basketball";
  const faultLabel = isBasketball ? "Fouls" : "Faults";
  const template = getTemplate(state.sport);
  const { scoreIncrements, scoreLabels } = template;
  // Best-of sports stop at the chosen match length (SA-118); undefined = no cap
  const matchLength = getMatchLength(state);
  const currentPeriod = Number.parseInt(state.period, 10);
  const isFinalPeriod = matchLength !== undefined && !Number.isNaN(currentPeriod) && currentPeriod >= matchLength;

  const isIndoorCricket = state.sport === "indoor_cricket";
  const wicketPenalty = Number(state.sportConfig?.wicketPenalty ?? 5);
  const indoorCricketState = state.sportState as IndoorCricketState | undefined;
  const homeWickets = indoorCricketState?.homeWickets ?? 0;
  const visitorWickets = indoorCricketState?.visitorWickets ?? 0;

  function takeWicket(side: "home" | "visitor") {
    sendIndoorCricketWicket({ side });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't fire while the user is typing in an input or textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const s = stateRef.current;
      const p = pushRef.current;
      const inc = getTemplate(s.sport).scoreIncrements;

      // Cmd/Ctrl+Z — undo last action
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undoRef.current();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        p({ isRunning: !s.isRunning });
        return;
      }
      if (e.key === "[") {
        const n = Number.parseInt(s.period, 10);
        p({ period: String(Number.isNaN(n) || n <= 1 ? 1 : n - 1) });
        return;
      }
      if (e.key === "]") {
        const n = Number.parseInt(s.period, 10);
        const max = getMatchLength(s);
        if (max !== undefined && n >= max) return;
        p({ period: String(Number.isNaN(n) ? 2 : n + 1) });
        return;
      }
      tryScoreAdjustKey(e.key, inc, adjustRef.current);
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  // Sport-specific control panel override (used by complex sports like Cricket, Softball)
  const CustomPanel = template.controlPanel;
  if (CustomPanel) return (
    <CustomPanel
      state={state} push={push} sendReset={sendReset} sendUndo={sendUndo}
      sendCricketBall={sendCricketBall} sendCricketOverComplete={sendCricketOverComplete}
      sendCricketInningsChange={sendCricketInningsChange} sendCricketDeclare={sendCricketDeclare}
      sendScoreAdjust={sendScoreAdjust} sendIndoorCricketWicket={sendIndoorCricketWicket}
    />
  );

  return (
    <div className="space-y-6">
      {/* ── PRIMARY OPERATOR CONTROLS ─────────────────────────────── */}

      {/* Start / Stop — full-width, very tall */}
      <button
        data-testid="score-start-stop"
        className="w-full rounded-2xl py-8 text-3xl font-black tracking-widest uppercase transition-all"
        style={state.isRunning
          ? { background: "rgba(239,68,68,0.12)", border: "2px solid rgba(239,68,68,0.5)", color: "var(--danger)" }
          : { background: "var(--accent-dim)", border: "2px solid var(--border-accent)", color: "var(--accent)" }
        }
        onClick={() => push({ isRunning: !state.isRunning })}
      >
        {state.isRunning ? "■  STOP" : "▶  START"}
      </button>

      {/* Undo last action */}
      <button
        data-testid="score-undo"
        className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        onClick={sendUndo}
      >
        ↩ UNDO  <span style={{ fontSize: 10, opacity: 0.6 }}>⌘Z</span>
      </button>

      {/* End Period / Reopen Period */}
      <div className="flex gap-3">
        <button
          data-testid="score-end-period"
          className="flex-1 rounded-xl py-4 text-lg font-black tracking-widest uppercase transition-all"
          style={{ background: "rgba(251,146,60,0.1)", border: "2px solid rgba(251,146,60,0.4)", color: "rgb(251,146,60)", opacity: isFinalPeriod ? 0.4 : 1 }}
          disabled={isFinalPeriod}
          title={isFinalPeriod ? `This is the last ${template.periodLabel.toLowerCase()} of a best-of-${matchLength} match` : undefined}
          onClick={() => {
            const n = Number.parseInt(state.period, 10);
            const nextPeriod = Number.isNaN(n) ? 2 : n + 1;
            // FIBA: overtime periods are 5 minutes (300s), not 10
            const nextClock = isBasketball && nextPeriod > 4 ? 300 : template.clockSeconds;
            push({
              isRunning: false,
              clockSeconds: nextClock,
              period: String(nextPeriod),
              periodBreak: true,
              // FIBA: team fouls reset each quarter
              ...(isBasketball && {
                home: { ...state.home, faults: 0 },
                visitor: { ...state.visitor, faults: 0 },
              }),
              // Set-based sports (volleyball, tennis, etc.) reset scores between games
              ...(template.resetScoreOnPeriod && {
                home: { ...state.home, score: 0, ...(isBasketball ? { faults: 0 } : {}) },
                visitor: { ...state.visitor, score: 0, ...(isBasketball ? { faults: 0 } : {}) },
              }),
            });
          }}
        >
          {isFinalPeriod ? `FINAL ${template.periodLabel}` : `⏭  END ${template.periodLabel}`}
        </button>
        <button
          data-testid="score-reopen-period"
          className="rounded-xl px-5 py-4 text-sm font-black tracking-widest uppercase transition-all"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={() => {
            const n = Number.parseInt(state.period, 10);
            push({
              isRunning: false,
              clockSeconds: template.clockSeconds,
              period: String(Number.isNaN(n) || n <= 1 ? 1 : n - 1),
              periodBreak: false,
            });
          }}
        >
          ↩ REOPEN
        </button>
      </div>

      {/* Live status bar */}
      <div className="rounded-xl p-4 flex items-center justify-around gap-4 flex-wrap"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="text-center">
          <p className="text-xs mb-1 font-bold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
            {state.home.name || "HOME"}
          </p>
          <p data-testid="score-home-value" className="score-digit text-5xl" style={{ color: state.home.color || "var(--home-color)" }}>
            {formatScore(state, "home")}
          </p>
        </div>
        <div className="text-center">
          <p data-testid="score-clock" className="clock-digit text-4xl" style={{ color: state.isRunning ? "#fff" : "var(--text-secondary)" }}>
            {formatClockDisplay(displayClock)}
          </p>
          <p className="text-xs mt-1 font-black tracking-widest" style={{ color: state.periodBreak ? "rgb(251,146,60)" : "var(--accent)" }}>
            {periodStatusLabel(state.periodBreak, template.periodLabel, state.period, matchLength)}
          </p>
          <p className="text-xs mt-1 font-semibold" style={{ color: state.isRunning ? "var(--running)" : "var(--stopped)" }}>
            {state.isRunning ? "● RUNNING" : "■ PAUSED"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs mb-1 font-bold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
            {state.visitor.name || "VISITOR"}
          </p>
          <p data-testid="score-visitor-value" className="score-digit text-5xl" style={{ color: state.visitor.color || "var(--visitor-color)" }}>
            {formatScore(state, "visitor")}
          </p>
        </div>
      </div>

      {/* Scoring — two big side-by-side cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm font-black tracking-widest uppercase mb-1" style={{ color: state.home.color || "var(--home-color)" }}>
            {state.home.name || "Home"}
          </p>
          <ScoreButtons scoreIncrements={scoreIncrements} scoreLabels={scoreLabels} score={state.home.score} testIdPrefix="score-home"
            onAdjust={d => sendScoreAdjust({ side: "home", delta: d })} />
          <div className="flex gap-2 mt-3">
            <SmallBtn label={`${faultLabel}: ${state.home.faults}`}
              onClick={() => push({ home: { ...state.home, faults: state.home.faults + 1 } })} />
            <SmallBtn label={`Reset ${faultLabel.toLowerCase()}`}
              onClick={() => push({ home: { ...state.home, faults: 0 } })} />
          </div>
          {template.timeoutsPerTeam > 0 && (
            <div className="flex gap-2 mt-2">
              <SmallBtn label={`Timeouts left: ${state.home.timeouts}`} testId="score-home-timeout"
                onClick={() => push({ home: { ...state.home, timeouts: Math.max(0, state.home.timeouts - 1) } })} />
              <SmallBtn label="Restore timeout" testId="score-home-timeout-restore"
                onClick={() => push({ home: { ...state.home, timeouts: Math.min(template.timeoutsPerTeam, state.home.timeouts + 1) } })} />
            </div>
          )}
          {isIndoorCricket && (
            <div className="mt-2">
              <SmallBtn label={`Wicket (-${wicketPenalty})  ·  ${homeWickets}`} onClick={() => takeWicket("home")} testId="score-home-wicket" />
            </div>
          )}
        </div>

        <div className="rounded-2xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm font-black tracking-widest uppercase mb-1" style={{ color: state.visitor.color || "var(--visitor-color)" }}>
            {state.visitor.name || "Visitor"}
          </p>
          <ScoreButtons scoreIncrements={scoreIncrements} scoreLabels={scoreLabels} score={state.visitor.score} testIdPrefix="score-visitor"
            onAdjust={d => sendScoreAdjust({ side: "visitor", delta: d })} />
          <div className="flex gap-2 mt-3">
            <SmallBtn label={`${faultLabel}: ${state.visitor.faults}`}
              onClick={() => push({ visitor: { ...state.visitor, faults: state.visitor.faults + 1 } })} />
            <SmallBtn label={`Reset ${faultLabel.toLowerCase()}`}
              onClick={() => push({ visitor: { ...state.visitor, faults: 0 } })} />
          </div>
          {template.timeoutsPerTeam > 0 && (
            <div className="flex gap-2 mt-2">
              <SmallBtn label={`Timeouts left: ${state.visitor.timeouts}`} testId="score-visitor-timeout"
                onClick={() => push({ visitor: { ...state.visitor, timeouts: Math.max(0, state.visitor.timeouts - 1) } })} />
              <SmallBtn label="Restore timeout" testId="score-visitor-timeout-restore"
                onClick={() => push({ visitor: { ...state.visitor, timeouts: Math.min(template.timeoutsPerTeam, state.visitor.timeouts + 1) } })} />
            </div>
          )}
          {isIndoorCricket && (
            <div className="mt-2">
              <SmallBtn label={`Wicket (-${wicketPenalty})  ·  ${visitorWickets}`} onClick={() => takeWicket("visitor")} testId="score-visitor-wicket" />
            </div>
          )}
        </div>
      </div>

      {/* Possession */}
      <div className="flex gap-3">
        <button
          className="flex-1 rounded-xl py-3 text-sm font-black tracking-wide"
          style={state.possession === "home"
            ? { background: "var(--accent-dim)", border: "2px solid var(--border-accent)", color: "var(--accent)" }
            : { background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }
          }
          onClick={() => push({ possession: state.possession === "home" ? "none" : "home" })}
        >
          ◀ {state.home.name || "Home"} ball
        </button>
        <button
          className="flex-1 rounded-xl py-3 text-sm font-black tracking-wide"
          style={state.possession === "visitor"
            ? { background: "var(--accent-dim)", border: "2px solid var(--border-accent)", color: "var(--accent)" }
            : { background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }
          }
          onClick={() => push({ possession: state.possession === "visitor" ? "none" : "visitor" })}
        >
          {state.visitor.name || "Visitor"} ball ▶
        </button>
      </div>

      {/* Keyboard legend */}
      <div className="rounded-xl px-4 py-3 text-xs flex flex-wrap gap-x-6 gap-y-1"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-dim)" }}>
        <span className="font-semibold w-full" style={{ color: "var(--text-secondary)" }}>Keyboard shortcuts</span>
        <span><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>Space</kbd> Start/Stop</span>
        <span><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>⌘Z</kbd> Undo</span>
        {(["1", "2", "3"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Home +{scoreIncrements[i]}{scoreLabels?.[i] ? ` (${scoreLabels[i]})` : ""}</span>
        ))}
        {(["Q", "W", "E"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Home −{scoreIncrements[i]}</span>
        ))}
        {(["9", "0", "8"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Visitor +{scoreIncrements[i]}{scoreLabels?.[i] ? ` (${scoreLabels[i]})` : ""}</span>
        ))}
        {(["O", "P", "I"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Visitor −{scoreIncrements[i]}</span>
        ))}
        <span><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>[</kbd><kbd className="px-1.5 py-0.5 rounded font-mono ml-1" style={{ background: "var(--bg-elevated)" }}>]</kbd> Period −/+</span>
      </div>

      {/* ── SECONDARY CONTROLS ────────────────────────────────────── */}
      <div
        className="rounded-2xl p-5 space-y-5"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <SectionLabel>Clock &amp; Match Controls</SectionLabel>

        {/* Clock adjust */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>Adjust clock</p>
            <SmallBtn
              label={state.countDown ? "↓ Count down" : "↑ Count up"}
              active={state.countDown}
              onClick={() => push({ countDown: !state.countDown })}
            />
          </div>
          <ClockAdjustButtons
            clockSeconds={state.clockSeconds}
            onAdjust={d => push({ clockSeconds: Math.max(0, state.clockSeconds + d) })}
          />
          <div className="flex gap-2 mt-2">
            <input
              className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              placeholder="MM:SS"
              value={clockInput}
              onChange={e => setClockInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const s = parseClock(clockInput);
                  if (s !== null) { push({ clockSeconds: s }); setClockInput(""); }
                }
              }}
            />
            <button
              className="rounded-lg px-3 py-2 text-xs font-bold"
              style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
              onClick={() => {
                const s = parseClock(clockInput);
                if (s !== null) { push({ clockSeconds: s }); setClockInput(""); }
              }}
            >Set</button>
          </div>
        </div>

        {/* Team names */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <NameField label={`Home team name`} value={homeName} placeholder={state.home.name} onChange={setHomeName}
            onCommit={() => { push({ home: { ...state.home, name: homeName } }); setHomeName(""); }} />
          <NameField label={`Visitor team name`} value={visName} placeholder={state.visitor.name} onChange={setVisName}
            onCommit={() => { push({ visitor: { ...state.visitor, name: visName } }); setVisName(""); }} />
        </div>

        {/* Match info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <NameField label="Match name" value={matchName} placeholder={state.matchName || "e.g. Round 1"}
            onChange={setMatchName} onCommit={() => { push({ matchName }); setMatchName(""); }} />
          <NameField label="Period / Quarter" value={period} placeholder={state.period}
            onChange={setPeriod} onCommit={() => { push({ period }); setPeriod(""); }} />
        </div>

        {/* Reset */}
        <div className="pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <button data-testid="score-reset-match" className="w-full rounded-lg py-2 text-sm font-bold tracking-wide uppercase"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--danger)" }}
            onClick={() => { if (confirm("Reset scores to 0? (Names and colours are kept)")) sendReset(); }}>
            Reset Match
          </button>
        </div>
      </div>
    </div>
  );
}
