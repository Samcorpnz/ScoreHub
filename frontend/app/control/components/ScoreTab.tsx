"use client";

import { useState, useEffect, useRef } from "react";
import { IndoorCricketState, MatchState, formatClock, formatClockDisplay, formatScore } from "../../types";
import { useInterpolatedClock } from "../../hooks/useInterpolatedClock";
import { parseClock } from "../lib/parseClock";
import {
  getMatchTemplate, getMatchLength, getActivePowerPlay, getBreakLabel, getExtraTimePeriod, getExtraTimeSeconds,
  getPeriodClockSeconds, getPeriodLabel, getPeriodNumber, getShootout, isFullTime, ControlPanelProps,
} from "../../sport-templates";
import { useEndMatch } from "../lib/useEndMatch";
import { ShootoutAttempts } from "../../components/ClockPanel";
import { ClockAdjustButtons, NameField, ScoreButtons, SectionLabel, SmallBtn } from "./primitives";

type Side = "home" | "visitor";
type AdjustFn = (args: { side: Side; delta: number }) => void;

// Keys 1/2/3/4 → increment[0/1/2/3]; Q/W/E/R → negative; mirror on right side (9/0/8/7, O/P/I/U).
// Returns true if the key matched a score-adjust binding (and applied it).
function tryScoreAdjustKey(key: string, inc: readonly number[], adjust: AdjustFn): boolean {
  const bindings: [string, Side, number, boolean][] = [
    ["1", "home", 0, false], ["2", "home", 1, false], ["3", "home", 2, false], ["4", "home", 3, false],
    ["q", "home", 0, true], ["Q", "home", 0, true], ["w", "home", 1, true], ["W", "home", 1, true], ["e", "home", 2, true], ["E", "home", 2, true], ["r", "home", 3, true], ["R", "home", 3, true],
    ["9", "visitor", 0, false], ["0", "visitor", 1, false], ["8", "visitor", 2, false], ["7", "visitor", 3, false],
    ["o", "visitor", 0, true], ["O", "visitor", 0, true], ["p", "visitor", 1, true], ["P", "visitor", 1, true], ["i", "visitor", 2, true], ["I", "visitor", 2, true], ["u", "visitor", 3, true], ["U", "visitor", 3, true],
  ];
  for (const [k, side, idx, negate] of bindings) {
    if (key !== k || inc[idx] === undefined) continue;
    adjust({ side, delta: negate ? -inc[idx] : inc[idx] });
    return true;
  }
  return false;
}

// What each sport calls the play after full time, for the full-time panel's button
const EXTRA_TIME_NAMES: Record<string, string> = { OT: "OVERTIME", GP: "GOLDEN POINT", "DROP-OFF": "DROP-OFF" };

function endPeriodLabel(isFinalPeriod: boolean, fullTime: boolean, isLastRegulationPeriod: boolean, templatePeriodLabel: string, periodLabel: string): string {
  if (isFinalPeriod) return `FINAL ${templatePeriodLabel}`;
  if (fullTime) return "FULL TIME";
  if (isLastRegulationPeriod) return "⏭  FULL TIME";
  return `⏭  END ${periodLabel}`;
}

function periodStatusLabel(breakLabel: string | undefined, periodLabel: string, period: string, matchLength?: number): string {
  if (breakLabel) return breakLabel;
  return matchLength ? `${periodLabel} ${period} of ${matchLength}` : `${periodLabel} ${period}`;
}

// "[" / "]" step the period back / forward: never below 1, nor past a
// best-of match's length (null = no change).
function steppedPeriod(s: MatchState, direction: -1 | 1): string | null {
  const n = Number.parseInt(s.period, 10);
  if (direction < 0) return String(Number.isNaN(n) || n <= 1 ? 1 : n - 1);
  const max = getMatchLength(s);
  if (max !== undefined && n >= max) return null;
  return String(Number.isNaN(n) ? 2 : n + 1);
}

// Start / Stop — full-width, very tall.
function StartStopButton({ isRunning, onToggle }: { readonly isRunning: boolean; readonly onToggle: () => void }) {
  return (
    <button
      data-testid="score-start-stop"
      className="w-full rounded-2xl py-8 text-3xl font-black tracking-widest uppercase transition-all"
      style={isRunning
        ? { background: "rgba(239,68,68,0.12)", border: "2px solid rgba(239,68,68,0.5)", color: "var(--danger)" }
        : { background: "var(--accent-dim)", border: "2px solid var(--border-accent)", color: "var(--accent)" }
      }
      onClick={onToggle}
    >
      {isRunning ? "■  STOP" : "▶  START"}
    </button>
  );
}

// Shown in place of Start / Stop at full time: End Match, or Start Extra
// Time when the sport has it (extraTimeName set).
function FullTimePanel({ extraTimeName, canEnd, ending, endMatch, endError, onStartExtraTime }: {
  readonly extraTimeName: string | undefined;
  readonly canEnd: boolean;
  readonly ending: boolean;
  readonly endMatch: () => void | Promise<void>;
  readonly endError: string;
  readonly onStartExtraTime: () => void;
}) {
  return (
    <div data-testid="score-full-time" className="rounded-2xl p-5 space-y-3"
      style={{ background: "rgba(251,146,60,0.08)", border: "2px solid rgba(251,146,60,0.4)" }}>
      <p className="text-center text-2xl font-black tracking-widest" style={{ color: "rgb(251,146,60)" }}>FULL TIME</p>
      <p className="text-center text-xs" style={{ color: "var(--text-secondary)" }}>
        {extraTimeName
          ? "End the match, or start extra time if it's needed."
          : "End the match to lock the result and move it to History."}
      </p>
      <div className="flex gap-3">
        {canEnd && (
          <button data-testid="score-end-match"
            className="flex-1 rounded-xl py-4 text-lg font-black tracking-widest uppercase"
            style={{ background: "rgba(239,68,68,0.12)", border: "2px solid rgba(239,68,68,0.5)", color: "var(--danger)" }}
            disabled={ending}
            onClick={endMatch}>
            {ending ? "Ending…" : "■  END MATCH"}
          </button>
        )}
        {extraTimeName && (
          <button data-testid="score-start-extra-time"
            className="flex-1 rounded-xl py-4 text-lg font-black tracking-widest uppercase"
            style={{ background: "var(--accent-dim)", border: "2px solid var(--border-accent)", color: "var(--accent)" }}
            onClick={onStartExtraTime}>
            ▶  START {extraTimeName}
          </button>
        )}
      </div>
      {endError && <p className="text-xs font-semibold text-center" style={{ color: "var(--danger)" }}>{endError}</p>}
    </div>
  );
}

export function ScoreTab({
  state, push, sendReset, sendUndo,
  sendCricketBall, sendCricketOverComplete, sendCricketInningsChange, sendCricketDeclare,
  sendScoreAdjust, sendIndoorCricketWicket, matchId, onEnded,
}: ControlPanelProps & {
  // For the full-time panel's End Match button
  readonly matchId?: string;
  readonly onEnded?: () => void;
}) {
  const [period,     setPeriod]     = useState("");
  const [clockInput, setClockInput] = useState("");
  const [extraTimeInput, setExtraTimeInput] = useState("");
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

  const isBasketball = state.sport === "basketball";
  const faultLabel = isBasketball ? "Fouls" : "Faults";
  const template = getMatchTemplate(state);
  const { scoreLabels } = template;
  // Fast5: outer and super shots are worth double for the last two minutes of
  // each quarter, so the buttons (and their keys) change value with the clock.
  const powerPlay = getActivePowerPlay(state, displayClock);
  const scoreIncrements = powerPlay?.scoreIncrements ?? template.scoreIncrements;
  const incrementsRef = useRef(scoreIncrements);
  useEffect(() => {
    stateRef.current = state;
    pushRef.current = push;
    undoRef.current = sendUndo;
    adjustRef.current = sendScoreAdjust;
    incrementsRef.current = scoreIncrements;
  });

  const periodLabel = getPeriodLabel(state);
  const extraTimeSeconds = getExtraTimeSeconds(state);
  // Best-of sports stop at the chosen match length (SA-118); undefined = no cap
  const matchLength = getMatchLength(state);
  const currentPeriod = Number.parseInt(state.period, 10);
  const isFinalPeriod = matchLength !== undefined && !Number.isNaN(currentPeriod) && currentPeriod >= matchLength;
  // Timed sports: END on the last half/quarter goes to full time, where the
  // operator either ends the match or (if the sport has it) starts extra time.
  const isLastRegulationPeriod = matchLength === undefined && !state.periodBreak && currentPeriod === template.periods;
  const fullTime = isFullTime(state);
  const hasExtraTime = Boolean(template.extraTime);
  const { canEnd, endMatch, ending, endError } = useEndMatch({ matchId, isRunning: state.isRunning, push, onEnded });

  const isIndoorCricket = state.sport === "indoor_cricket";
  const wicketPenalty = Number(state.sportConfig?.wicketPenalty ?? 5);
  const indoorCricketState = state.sportState as IndoorCricketState | undefined;
  const homeWickets = indoorCricketState?.homeWickets ?? 0;
  const visitorWickets = indoorCricketState?.visitorWickets ?? 0;

  function takeWicket(side: "home" | "visitor") {
    sendIndoorCricketWicket({ side });
  }

  // Shoot-out attempts go in one at a time, so whole-tally patches are safe
  // here (unlike rapid-fire scoring, which needs adjustScore's deltas).
  const shootout = getShootout(state);
  function recordAttempt(side: Side, scored: boolean) {
    if (!state.shootout) return;
    push({ shootout: { ...state.shootout, [side]: [...state.shootout[side], scored] } });
  }
  function removeAttempt(side: Side) {
    if (!state.shootout) return;
    push({ shootout: { ...state.shootout, [side]: state.shootout[side].slice(0, -1) } });
  }

  function commitExtraTime() {
    const seconds = parseClock(extraTimeInput);
    if (seconds === null) return;
    // If an extra-time period is already waiting on the old length, move its
    // clock too — but never a clock that's running or has been adjusted.
    const clockIsWaiting = getExtraTimePeriod(state) > 0 && !state.isRunning && state.clockSeconds === extraTimeSeconds;
    push({
      sportConfig: { ...state.sportConfig, extraTimeSeconds: seconds },
      ...(clockIsWaiting && { clockSeconds: seconds }),
    });
    setExtraTimeInput("");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't fire while the user is typing in an input or textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const s = stateRef.current;
      const p = pushRef.current;
      const inc = incrementsRef.current;

      // Cmd/Ctrl+Z — undo last action
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undoRef.current();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        // At full time there's no next period to start unless the sport has extra time
        if (!s.isRunning && isFullTime(s) && !getMatchTemplate(s).extraTime) return;
        p({ isRunning: !s.isRunning });
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const next = steppedPeriod(s, e.key === "[" ? -1 : 1);
        if (next !== null) p({ period: next });
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

      {/* Start / Stop — full-width, very tall. At full time the full-time
          panel below offers End Match / Start Extra Time instead. */}
      {!fullTime && <StartStopButton isRunning={state.isRunning} onToggle={() => push({ isRunning: !state.isRunning })} />}

      {fullTime && (
        <FullTimePanel
          extraTimeName={hasExtraTime ? EXTRA_TIME_NAMES[template.extraTime?.label ?? ""] ?? "EXTRA TIME" : undefined}
          canEnd={canEnd} ending={ending} endMatch={endMatch} endError={endError}
          onStartExtraTime={() => push({ isRunning: true })}
        />
      )}

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
          disabled={isFinalPeriod || fullTime}
          title={isFinalPeriod ? `This is the last ${template.periodLabel.toLowerCase()} of a best-of-${matchLength} match` : undefined}
          onClick={() => {
            if (isLastRegulationPeriod) {
              // Into the full-time break. No foul or score resets — the result
              // stands. Sports with extra time get its clock ready; the rest
              // keep the final clock on show.
              push({
                isRunning: false,
                period: String(template.periods + 1),
                periodBreak: true,
                ...(hasExtraTime && { clockSeconds: getPeriodClockSeconds(state, template.periods + 1) }),
              });
              return;
            }
            const n = Number.parseInt(state.period, 10);
            const nextPeriod = Number.isNaN(n) ? 2 : n + 1;
            push({
              isRunning: false,
              // Extra-time periods get the extra-time length, not a full period
              clockSeconds: getPeriodClockSeconds(state, nextPeriod),
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
          {endPeriodLabel(isFinalPeriod, fullTime, isLastRegulationPeriod, template.periodLabel, periodLabel)}
        </button>
        <button
          data-testid="score-reopen-period"
          className="rounded-xl px-5 py-4 text-sm font-black tracking-widest uppercase transition-all"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={() => {
            const n = Number.parseInt(state.period, 10);
            const previousPeriod = Number.isNaN(n) || n <= 1 ? 1 : n - 1;
            push({
              isRunning: false,
              clockSeconds: getPeriodClockSeconds(state, previousPeriod),
              period: String(previousPeriod),
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
            {periodStatusLabel(state.periodBreak ? getBreakLabel(state) : undefined, periodLabel, getPeriodNumber(state), matchLength)}
          </p>
          {powerPlay && (
            <p data-testid="score-power-play" className="text-xs mt-1 font-black tracking-widest" style={{ color: "rgb(250,204,21)" }}>
              ⚡ {powerPlay.label}
            </p>
          )}
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

      {/* Penalty shoot-out — tallied apart from the match score */}
      {template.shootout && !shootout && (
        <button
          data-testid="shootout-start"
          className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={() => push({ isRunning: false, shootout: { home: [], visitor: [] } })}
        >
          Start {template.shootout.label.toLowerCase()}
        </button>
      )}
      {shootout && (
        <div className="rounded-2xl p-5" style={{ background: "var(--bg-surface)", border: "2px solid var(--border-accent)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-black tracking-widest uppercase" style={{ color: "var(--accent)" }}>
              {shootout.label} · <span data-testid="shootout-tally">{shootout.homeGoals}–{shootout.visitorGoals}</span>
            </p>
            <SmallBtn label="Clear shoot-out" testId="shootout-clear"
              onClick={() => { if (confirm("Clear the shoot-out? Its tally comes off every display.")) push({ shootout: null }); }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(["home", "visitor"] as const).map(side => (
              <div key={side}>
                <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: state[side].color || `var(--${side}-color)` }}>
                  {state[side].name || side}
                </p>
                <ShootoutAttempts attempts={shootout[side]} color={state[side].color || `var(--${side}-color)`} />
                <div className="flex gap-2 mt-2">
                  <button data-testid={`shootout-${side}-scored`} className="flex-1 rounded-xl py-3 text-sm font-black"
                    style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
                    onClick={() => recordAttempt(side, true)}>✓ Scored</button>
                  <button data-testid={`shootout-${side}-missed`} className="flex-1 rounded-xl py-3 text-sm font-black"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                    onClick={() => recordAttempt(side, false)}>✕ Missed</button>
                </div>
                <div className="mt-2">
                  <SmallBtn label="Remove last" testId={`shootout-${side}-remove`} onClick={() => removeAttempt(side)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        {(["1", "2", "3", "4"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Home +{scoreIncrements[i]}{scoreLabels?.[i] ? ` (${scoreLabels[i]})` : ""}</span>
        ))}
        {(["Q", "W", "E", "R"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Home −{scoreIncrements[i]}</span>
        ))}
        {(["9", "0", "8", "7"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
          <span key={key}><kbd className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--bg-elevated)" }}>{key}</kbd> Visitor +{scoreIncrements[i]}{scoreLabels?.[i] ? ` (${scoreLabels[i]})` : ""}</span>
        ))}
        {(["O", "P", "I", "U"] as const).map((key, i) => scoreIncrements[i] !== undefined && (
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

        {/* Extra time — competitions set their own length, so it's per match */}
        {template.extraTime && state.countDown && (
          <div className="pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <NameField label={`Extra time — length of each period (currently ${formatClock(extraTimeSeconds)})`}
              value={extraTimeInput} placeholder="e.g. 5:00" testId="score-extra-time"
              onChange={setExtraTimeInput} onCommit={commitExtraTime} />
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Ending the last {template.periodLabel.toLowerCase()} moves to extra time with this on the clock.
            </p>
          </div>
        )}

        {/* Period — team and match names live on the Settings tab */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
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
