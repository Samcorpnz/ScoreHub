"use client";

import { useState } from "react";
import type { ControlPanelProps } from "../../sport-templates";
import type { CricketBatter, CricketBowler, CricketFormat, CricketInningsState, CricketState, WicketType } from "../../types";
import { Card, SectionLabel, SmallBtn } from "./primitives";

const OVERS_PER_INNINGS: Record<CricketFormat, number> = { t20: 20, odi: 50, test: 90 };
const WICKET_TYPES: WicketType[] = ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "obstructed_field", "handled_ball"];
const RUN_BUTTONS = [0, 1, 2, 3, 4, 6];
const SESSIONS = ["morning", "afternoon", "evening"] as const;
// Mirrors relay/src/cricket.ts's isFollowOnEligible — kept in sync manually
// since this is a small, purely cosmetic UI hint (the relay is authoritative
// for whether the follow-on decision is actually enforced).
const FOLLOW_ON_THRESHOLD = 200;
type Modifier = "none" | "wide" | "noBall" | "bye" | "legBye";
const MODIFIER_LABELS: Record<Modifier, string> = {
  none: "Normal",
  wide: "Wide",
  noBall: "No-ball",
  bye: "Bye",
  legBye: "Leg-bye",
};

function emptyBatter(id: number, name: string): CricketBatter {
  return { playerId: id, name, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissed: false };
}
function emptyBowler(id: number, name: string): CricketBowler {
  return { playerId: id, name, overs: 0, ballsThisOver: 0, maidens: 0, runs: 0, wickets: 0 };
}

function getCricketState(state: ControlPanelProps["state"]): CricketState {
  const existing = state.sportState as CricketState | undefined;
  if (existing?.sport === "cricket") return existing;
  const format = ((state.sportConfig?.format as CricketFormat) ?? "t20");
  return {
    sport: "cricket",
    format,
    inningsNumber: 1,
    innings: [{
      battingTeam: "home", runs: 0, wickets: 0, oversComplete: 0, ballsThisOver: 0,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0 },
      batters: [], bowlers: [], currentBatter1Index: 0, currentBatter2Index: 1, currentBowlerIndex: 0,
      thisOverBalls: [],
    }],
    homeSquad: [],
    visitorSquad: [],
  };
}

function oversLabel(inn: CricketInningsState): string {
  return `${inn.oversComplete}.${inn.ballsThisOver}`;
}

export function CricketTab({
  state, push, sendReset, sendUndo, sendCricketBall, sendCricketOverComplete, sendCricketInningsChange, sendCricketDeclare,
}: ControlPanelProps) {
  const [modifier, setModifier] = useState<Modifier>("none");
  const [wicketOpen, setWicketOpen] = useState(false);
  const [wicketType, setWicketType] = useState<WicketType>("bowled");
  const [nextBatterIdx, setNextBatterIdx] = useState<number | "">("");
  const [nextBowlerIdx, setNextBowlerIdx] = useState<number | "">("");

  const cricket = getCricketState(state);
  const inn = cricket.innings.at(-1)!;
  const maxOvers = OVERS_PER_INNINGS[cricket.format];
  const battingSquad = inn.battingTeam === "home" ? cricket.homeSquad : cricket.visitorSquad;
  const bowlingSquad = inn.battingTeam === "home" ? cricket.visitorSquad : cricket.homeSquad;
  const battingTeamState = state[inn.battingTeam];
  const bowlingTeamState = state[inn.battingTeam === "home" ? "visitor" : "home"];

  const batter1 = inn.batters[inn.currentBatter1Index];
  const batter2 = inn.batters[inn.currentBatter2Index];
  const bowler = inn.bowlers[inn.currentBowlerIndex];

  function pushCricket(next: CricketState) {
    push({ sportState: next });
  }

  function startInnings() {
    if (battingSquad.length < 2 || bowlingSquad.length < 1) return;
    const nextInnings: CricketInningsState = {
      ...inn,
      batters: battingSquad.map(p => emptyBatter(p.id, p.name)),
      bowlers: bowlingSquad.map(p => emptyBowler(p.id, p.name)),
      currentBatter1Index: 0,
      currentBatter2Index: 1,
      currentBowlerIndex: 0,
    };
    const innings = cricket.innings.slice();
    innings[innings.length - 1] = nextInnings;
    pushCricket({ ...cricket, innings });
  }

  function sendBall(runs: number, isWicket = false) {
    sendCricketBall({
      battingTeam: inn.battingTeam,
      runs,
      isWicket,
      wicketType: isWicket ? wicketType : undefined,
      isWide: modifier === "wide",
      isNoBall: modifier === "noBall",
      isBye: modifier === "bye",
      isLegBye: modifier === "legBye",
      nextBatterIndex: isWicket && nextBatterIdx !== "" ? Number(nextBatterIdx) : undefined,
    });
    setModifier("none");
    if (isWicket) { setWicketOpen(false); setNextBatterIdx(""); }
  }

  function confirmWicket() {
    sendBall(0, true);
  }

  function changeBowler() {
    if (nextBowlerIdx === "") return;
    sendCricketOverComplete({ nextBowlerIndex: Number(nextBowlerIdx) });
    setNextBowlerIdx("");
  }

  function startNextInnings(battingTeam: "home" | "visitor" = inn.battingTeam === "home" ? "visitor" : "home") {
    sendCricketInningsChange({ battingTeam });
  }

  function setDaySession(dayNumber: number, session: typeof SESSIONS[number]) {
    pushCricket({ ...cricket, dayNumber, session });
  }

  const inningsComplete = cricket.format === "test" ? (inn.wickets >= 10 || inn.declared) : (inn.oversComplete >= maxOvers || inn.wickets >= 10);
  const followOnEligible = cricket.format === "test" && cricket.innings.length === 2 && inningsComplete
    && cricket.innings[0].runs - cricket.innings[1].runs >= FOLLOW_ON_THRESHOLD;

  return (
    <div className="space-y-6">
      {/* Live score header */}
      <div className="rounded-2xl p-5 text-center" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <p className="text-xs mb-1 font-bold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
          {battingTeamState.name || inn.battingTeam} batting · innings {cricket.inningsNumber} · {cricket.format.toUpperCase()}
          {cricket.format === "test" && cricket.dayNumber !== undefined && ` · Day ${cricket.dayNumber} (${cricket.session ?? "morning"})`}
        </p>
        <p data-testid="cricket-score" className="score-digit text-5xl" style={{ color: "var(--accent)" }}>
          {inn.runs}/{inn.wickets} <span className="text-2xl" style={{ color: "var(--text-secondary)" }}>({oversLabel(inn)} ov)</span>
        </p>
        {inn.target !== undefined && (
          <p className="text-sm mt-2 font-bold" style={{ color: "rgb(251,146,60)" }}>
            Target {inn.target} · need {Math.max(0, inn.target - inn.runs)} from {Math.max(0, (maxOvers - inn.oversComplete) * 6 - inn.ballsThisOver)} balls
          </p>
        )}
        {inn.freeHit && (
          <p className="text-sm mt-2 font-black tracking-widest uppercase" style={{ color: "var(--danger)" }}>
            ⚡ Free Hit
          </p>
        )}
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          This over: {inn.thisOverBalls.length ? inn.thisOverBalls.join("  ") : "—"}
        </p>
      </div>

      {(inn.batters.length === 0 || inn.bowlers.length === 0) ? (
        <Card title="Start Innings">
          {battingSquad.length < 2 || bowlingSquad.length < 1 ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              Enter squads before play starts (Settings → Cricket squads), or the setup wizard will do this automatically.
            </p>
          ) : (
            <SmallBtn primary testId="cricket-start-innings" label={`Start innings — ${battingTeamState.name || inn.battingTeam} batting`} onClick={startInnings} />
          )}
        </Card>
      ) : (
        <>
          {/* Current players */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <SectionLabel>Batting</SectionLabel>
              {[batter1, batter2].map((b, i) => b && (
                <div key={b.playerId} className="flex justify-between text-sm mt-2">
                  <span style={{ color: i === 0 ? "var(--accent)" : "var(--text-secondary)" }}>{b.name}{i === 0 ? " *" : ""}</span>
                  <span style={{ color: "var(--text-primary)" }}>{b.runs} ({b.ballsFaced}) · {b.fours}×4 {b.sixes}×6</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <SectionLabel>Bowling</SectionLabel>
              {bowler && (
                <div className="flex justify-between text-sm mt-2">
                  <span style={{ color: "var(--text-secondary)" }}>{bowler.name}</span>
                  <span style={{ color: "var(--text-primary)" }}>{bowler.overs}.{bowler.ballsThisOver}-{bowler.maidens}-{bowler.runs}-{bowler.wickets}</span>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <select data-testid="cricket-bowler-select" className="flex-1 rounded-lg px-2 py-1.5 text-xs"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  value={nextBowlerIdx} onChange={e => setNextBowlerIdx(e.target.value === "" ? "" : Number(e.target.value))}>
                  <option value="">Change bowler…</option>
                  {inn.bowlers.map((bw, idx) => idx !== inn.currentBowlerIndex && (
                    <option key={bw.playerId} value={idx}>{bw.name}</option>
                  ))}
                </select>
                <SmallBtn testId="cricket-bowler-set" label="Set" onClick={changeBowler} />
              </div>
            </div>
          </div>

          {/* Ball-by-ball input */}
          <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
            <SectionLabel>Ball</SectionLabel>
            <div className="flex gap-2 flex-wrap">
              {(["none", "wide", "noBall", "bye", "legBye"] as Modifier[]).map(m => (
                <SmallBtn key={m}
                  testId={`cricket-modifier-${m}`}
                  label={MODIFIER_LABELS[m]}
                  active={modifier === m} onClick={() => setModifier(m)} />
              ))}
            </div>
            <div className="grid grid-cols-6 gap-2">
              {RUN_BUTTONS.map(r => (
                <button key={r} data-testid={`cricket-runs-${r}`} className="rounded-xl py-4 text-lg font-black"
                  style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
                  onClick={() => sendBall(r)}>
                  {r === 0 ? "•" : r}
                </button>
              ))}
            </div>
            {!wicketOpen ? (
              <button data-testid="cricket-wicket-open" className="w-full rounded-xl py-4 text-lg font-black tracking-widest uppercase"
                style={{ background: "rgba(239,68,68,0.1)", border: "2px solid rgba(239,68,68,0.4)", color: "var(--danger)" }}
                onClick={() => setWicketOpen(true)}>
                Wicket
              </button>
            ) : (
              <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <div className="flex gap-2 flex-wrap">
                  {WICKET_TYPES.map(t => (
                    <SmallBtn key={t} testId={`cricket-wicket-type-${t}`} label={t.replace("_", " ")} active={wicketType === t} onClick={() => setWicketType(t)} />
                  ))}
                </div>
                <select data-testid="cricket-next-batter-select" className="w-full rounded-lg px-2 py-1.5 text-xs"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  value={nextBatterIdx} onChange={e => setNextBatterIdx(e.target.value === "" ? "" : Number(e.target.value))}>
                  <option value="">Next batter…</option>
                  {inn.batters.map((b, idx) => !b.dismissed && idx !== inn.currentBatter1Index && idx !== inn.currentBatter2Index && (
                    <option key={b.playerId} value={idx}>{b.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <SmallBtn testId="cricket-wicket-cancel" label="Cancel" onClick={() => setWicketOpen(false)} />
                  <SmallBtn primary testId="cricket-wicket-confirm" label="Confirm Wicket" onClick={confirmWicket} />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {inningsComplete && followOnEligible && (
        <div className="rounded-xl p-4 text-center space-y-2" style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.4)" }}>
          <p className="text-sm font-bold" style={{ color: "rgb(251,146,60)" }}>
            Follow-on available — {battingTeamState.name || inn.battingTeam} lead by {cricket.innings[0].runs - cricket.innings[1].runs} runs
          </p>
          <div className="flex gap-2 justify-center">
            <SmallBtn primary label={`Enforce follow-on — ${bowlingTeamState.name || "trailing team"} bats again`}
              onClick={() => startNextInnings(inn.battingTeam === "home" ? "visitor" : "home")} />
            <SmallBtn label={`Waive — ${battingTeamState.name || inn.battingTeam} bats again`}
              onClick={() => startNextInnings(inn.battingTeam)} />
          </div>
        </div>
      )}

      {inningsComplete && !followOnEligible && (
        <div className="rounded-xl p-4 text-center" style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.4)" }}>
          <p className="text-sm font-bold mb-2" style={{ color: "rgb(251,146,60)" }}>Innings complete</p>
          <SmallBtn primary testId="cricket-start-next-innings" label={`Start next innings — ${bowlingTeamState.name || "next team"} batting`} onClick={() => startNextInnings()} />
        </div>
      )}

      {cricket.format === "test" && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <SmallBtn testId="cricket-declare" label={`Declare ${battingTeamState.name || inn.battingTeam} innings`}
            onClick={() => sendCricketDeclare({ battingTeam: inn.battingTeam })} />
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>Day/session:</span>
            {[1, 2, 3, 4, 5].map(d => (
              <SmallBtn key={d} label={`Day ${d}`} active={cricket.dayNumber === d}
                onClick={() => setDaySession(d, cricket.session ?? "morning")} />
            ))}
            {SESSIONS.map(s => (
              <SmallBtn key={s} label={s} active={cricket.session === s}
                onClick={() => setDaySession(cricket.dayNumber ?? 1, s)} />
            ))}
          </div>
        </div>
      )}

      {/* Secondary controls */}
      <div className="rounded-2xl p-5 space-y-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <SectionLabel>Match Controls</SectionLabel>

        <button data-testid="score-undo" className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={sendUndo}>
          ↩ UNDO  <span style={{ fontSize: 10, opacity: 0.6 }}>⌘Z</span>
        </button>

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
