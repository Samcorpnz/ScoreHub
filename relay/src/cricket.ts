import type { MatchState } from "./types";
import type { CricketState, CricketInningsState, CricketBatter, CricketBowler, CricketFormat } from "@scorehub/types";
import type { CricketBallEventPayload, CricketOverCompleteEventPayload, CricketInningsChangeEventPayload, CricketDeclareEventPayload } from "./schemas";

// Pure state-transition functions for cricket's dedicated relay events.
// Each takes the current MatchState + an already-validated event payload and
// returns the next CricketState. Callers push the result through
// applyManualUpdate({ sportState: next }) so undo/persistence/broadcast stay
// on the one shared path every other mutation uses.

const OVERS_PER_INNINGS: Record<CricketFormat, number> = { t20: 20, odi: 50, test: 90 };

export function oversPerInnings(format: CricketFormat): number {
  return OVERS_PER_INNINGS[format];
}

function freshInnings(battingTeam: "home" | "visitor"): CricketInningsState {
  return {
    battingTeam,
    runs: 0,
    wickets: 0,
    oversComplete: 0,
    ballsThisOver: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0 },
    batters: [],
    bowlers: [],
    currentBatter1Index: 0,
    currentBatter2Index: 1,
    currentBowlerIndex: 0,
    thisOverBalls: [],
  };
}

export function getCricketState(current: MatchState): CricketState {
  const existing = current.sportState as CricketState | undefined;
  if (existing?.sport === "cricket") return existing;
  const format = ((current.sportConfig?.format as CricketFormat) ?? "t20");
  return {
    sport: "cricket",
    format,
    inningsNumber: 1,
    innings: [freshInnings("home")],
    homeSquad: [],
    visitorSquad: [],
  };
}

// Reset Match: back to a fresh first innings, keeping the format and both
// squads the operator entered at setup.
export function resetCricketState(existing: CricketState): CricketState {
  return {
    ...existing,
    inningsNumber: 1,
    innings: [freshInnings("home")],
    ...(existing.dayNumber !== undefined && { dayNumber: 1 }),
    ...(existing.session !== undefined && { session: "morning" as const }),
  };
}

function cloneInnings(inn: CricketInningsState): CricketInningsState {
  return {
    ...inn,
    extras: { ...inn.extras },
    batters: inn.batters.map(b => ({ ...b })),
    bowlers: inn.bowlers.map(b => ({ ...b })),
    thisOverBalls: [...inn.thisOverBalls],
  };
}

function ballLabel(payload: CricketBallEventPayload, wicketNullifiedByFreeHit: boolean): string {
  if (payload.isWicket) return wicketNullifiedByFreeHit ? "FH-W(no)" : "W";
  if (payload.isWide) return payload.runs > 0 ? `Wd+${payload.runs}` : "Wd";
  if (payload.isNoBall) return payload.runs > 0 ? `Nb+${payload.runs}` : "Nb";
  if (payload.isBye) return `${payload.runs}b`;
  if (payload.isLegBye) return `${payload.runs}lb`;
  return String(payload.runs);
}

// Applies the runs/extras for one delivery to the innings/batter/bowler
// totals and returns the total runs added to the team score this ball.
function applyBallRuns(
  inn: CricketInningsState,
  payload: CricketBallEventPayload,
  batter1: CricketBatter | undefined,
  bowler: CricketBowler | undefined,
): number {
  if (payload.isWide) {
    inn.extras.wides += 1 + payload.runs;
    inn.runs += 1 + payload.runs;
    if (bowler) bowler.runs += 1 + payload.runs;
    return 1 + payload.runs;
  }
  if (payload.isNoBall) {
    inn.extras.noBalls += 1;
    inn.runs += 1 + payload.runs;
    if (bowler) bowler.runs += 1 + payload.runs;
    if (batter1 && payload.runs > 0) {
      batter1.runs += payload.runs;
      if (payload.runs === 4) batter1.fours += 1;
      if (payload.runs === 6) batter1.sixes += 1;
    }
    return 1 + payload.runs;
  }
  if (payload.isBye) {
    inn.extras.byes += payload.runs;
    inn.runs += payload.runs;
    if (batter1) batter1.ballsFaced += 1;
    return payload.runs;
  }
  if (payload.isLegBye) {
    inn.extras.legByes += payload.runs;
    inn.runs += payload.runs;
    if (batter1) batter1.ballsFaced += 1;
    return payload.runs;
  }
  inn.runs += payload.runs;
  if (batter1) {
    batter1.runs += payload.runs;
    batter1.ballsFaced += 1;
    if (payload.runs === 4) batter1.fours += 1;
    if (payload.runs === 6) batter1.sixes += 1;
  }
  if (bowler) bowler.runs += payload.runs;
  return payload.runs;
}

// Applies the dismissal (if any) for this delivery, honouring the free-hit
// rule that nullifies every dismissal but a run out. Returns whether the
// dismissal stands.
function applyBallWicket(
  inn: CricketInningsState,
  payload: CricketBallEventPayload,
  batter1: CricketBatter | undefined,
  bowler: CricketBowler | undefined,
  wasFreeHit: boolean,
): boolean {
  const dismissalStands = payload.isWicket && (!wasFreeHit || payload.wicketType === "run_out");
  if (dismissalStands) {
    inn.wickets += 1;
    if (batter1) { batter1.dismissed = true; batter1.wicketType = payload.wicketType; }
    if (bowler && payload.wicketType !== "run_out") bowler.wickets += 1;
    if (payload.nextBatterIndex !== undefined) inn.currentBatter1Index = payload.nextBatterIndex;
  }
  return dismissalStands;
}

// End-of-over bookkeeping: bowler figures, maiden detection, and the end
// change. No-ops on any ball that doesn't complete the over.
function maybeCompleteOver(inn: CricketInningsState, bowler: CricketBowler | undefined): void {
  if (inn.ballsThisOver < 6) return;
  inn.oversComplete += 1;
  inn.ballsThisOver = 0;
  inn.thisOverBalls = [];
  if (bowler) {
    bowler.overs += 1;
    bowler.ballsThisOver = 0;
    if ((inn.runsConcededThisOver ?? 0) === 0) bowler.maidens += 1;
  }
  inn.runsConcededThisOver = 0;
  // Ends change at the end of every over.
  [inn.currentBatter1Index, inn.currentBatter2Index] = [inn.currentBatter2Index, inn.currentBatter1Index];
}

export function applyCricketBall(current: MatchState, payload: CricketBallEventPayload): CricketState {
  const cs = getCricketState(current);
  const innings = cs.innings.slice();
  const inn = cloneInnings(innings.at(-1)!);

  const legalDelivery = !payload.isWide && !payload.isNoBall;
  const batter1 = inn.batters[inn.currentBatter1Index] as CricketBatter | undefined;
  const bowler = inn.bowlers[inn.currentBowlerIndex] as CricketBowler | undefined;
  const wasFreeHit = inn.freeHit === true;

  const runsThisBall = applyBallRuns(inn, payload, batter1, bowler);
  inn.runsConcededThisOver = (inn.runsConcededThisOver ?? 0) + runsThisBall;

  // On a free hit (the ball after a no-ball), only a run out counts —
  // every other dismissal is nullified, matching ICC playing conditions.
  const dismissalStands = applyBallWicket(inn, payload, batter1, bowler, wasFreeHit);

  inn.thisOverBalls.push(ballLabel(payload, wasFreeHit && payload.isWicket && !dismissalStands));

  // Free hit carries over across another no-ball; otherwise it only ever
  // applies to the single delivery immediately following a no-ball.
  inn.freeHit = payload.isNoBall ?? false;

  if (legalDelivery) {
    if (bowler) bowler.ballsThisOver += 1;
    inn.ballsThisOver += 1;

    // Strike rotates on odd runs off the bat, byes, or leg-byes (not on a
    // wicket ball — the incoming batter takes strike from the non-striker's
    // end only if the dismissal itself was on an odd-run attempt, which
    // nextBatterIndex handles explicitly via the control panel instead).
    let rotatingRuns: number;
    if (payload.isBye || payload.isLegBye) rotatingRuns = payload.runs;
    else rotatingRuns = dismissalStands ? 0 : payload.runs;
    if (rotatingRuns % 2 === 1) {
      [inn.currentBatter1Index, inn.currentBatter2Index] = [inn.currentBatter2Index, inn.currentBatter1Index];
    }

    maybeCompleteOver(inn, bowler);
  }

  innings[innings.length - 1] = inn;
  return { ...cs, innings };
}

export function applyOverComplete(current: MatchState, payload: CricketOverCompleteEventPayload): CricketState {
  const cs = getCricketState(current);
  const innings = cs.innings.slice();
  const inn = cloneInnings(innings.at(-1)!);
  if (payload.nextBowlerIndex !== undefined) inn.currentBowlerIndex = payload.nextBowlerIndex;
  innings[innings.length - 1] = inn;
  return { ...cs, innings };
}

export function applyInningsChange(current: MatchState, payload: CricketInningsChangeEventPayload): CricketState {
  const cs = getCricketState(current);
  const prior = innings0Target(cs, payload);
  const next = freshInnings(payload.battingTeam);
  next.target = payload.target ?? prior;
  return {
    ...cs,
    inningsNumber: cs.inningsNumber + 1,
    innings: [...cs.innings, next],
  };
}

// First-innings total becomes the chase target (+1) when the caller doesn't
// supply one explicitly — the common case for T20/ODI 2nd innings.
function innings0Target(cs: CricketState, payload: CricketInningsChangeEventPayload): number | undefined {
  if (payload.target !== undefined) return payload.target;
  const priorForOtherTeam = cs.innings.filter(i => i.battingTeam !== payload.battingTeam);
  const last = priorForOtherTeam.at(-1);
  return last ? last.runs + 1 : undefined;
}

// ICC Test regulations scale the follow-on deficit with days remaining
// (200/150/100 runs); this uses the standard 200-run threshold as a
// reasonable single default rather than modelling the sliding scale.
const FOLLOW_ON_THRESHOLD = 200;

export function isFollowOnEligible(cs: CricketState): boolean {
  if (cs.format !== "test" || cs.innings.length !== 2) return false;
  const [first, second] = cs.innings;
  const secondInningsDone = second.wickets >= 10 || second.declared === true;
  return secondInningsDone && first.runs - second.runs >= FOLLOW_ON_THRESHOLD;
}

export function applyDeclare(current: MatchState, payload: CricketDeclareEventPayload): CricketState {
  const cs = getCricketState(current);
  const innings = cs.innings.slice();
  const lastIdx = innings.length - 1;
  const last = innings[lastIdx];
  if (last.battingTeam !== payload.battingTeam) return cs; // can only declare your own current innings
  innings[lastIdx] = { ...cloneInnings(last), declared: true };
  return { ...cs, innings };
}
