// Pure helpers for the relay load test (loadtest/run.ts) — kept separate so
// argument parsing, percentile maths and pass/fail evaluation can be unit
// tested without opening a single socket.

export interface LoadConfig {
  url: string;
  matches: number;
  viewersPerMatch: number;
  durationSec: number;
  // Score changes per second, per match (one controller each).
  scoreRateHz: number;
  // Connections opened per second while ramping up, so results reflect
  // steady-state load rather than a thundering herd at t=0.
  rampPerSec: number;
  // "multi": one org+match per simulated match (needs DATABASE_URL + AUTH_SECRET
  // — the production shape). "legacy": single shared room, shared secret.
  mode: "multi" | "legacy";
  keepData: boolean;
  thresholds: Thresholds;
  jsonOut?: string;
}

export interface Thresholds {
  // Controller-action -> viewer-sees-it latency, milliseconds.
  p95LatencyMs: number;
  p99LatencyMs: number;
  // Minimum fraction of sockets that must connect successfully.
  minConnectSuccess: number;
  // Viewers whose final score differs from the controller's are "diverged" —
  // i.e. a dropped or mis-ordered update. Default tolerance is zero.
  maxDivergedViewers: number;
}

export const DEFAULTS: LoadConfig = {
  url: "http://localhost:4000",
  matches: 20,
  viewersPerMatch: 10,
  durationSec: 30,
  scoreRateHz: 1,
  rampPerSec: 50,
  mode: "multi",
  keepData: false,
  thresholds: { p95LatencyMs: 500, p99LatencyMs: 1500, minConnectSuccess: 0.995, maxDivergedViewers: 0 },
};

function num(flag: string, raw: string | undefined, opts: { min?: number; max?: number; int?: boolean } = {}): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) throw new Error(`${flag} needs a number (got ${JSON.stringify(raw)})`);
  if (opts.int && !Number.isInteger(n)) throw new Error(`${flag} must be an integer (got ${raw})`);
  if (opts.min !== undefined && n < opts.min) throw new Error(`${flag} must be >= ${opts.min} (got ${raw})`);
  if (opts.max !== undefined && n > opts.max) throw new Error(`${flag} must be <= ${opts.max} (got ${raw})`);
  return n;
}

export function parseArgs(argv: string[]): LoadConfig {
  const cfg: LoadConfig = { ...DEFAULTS, thresholds: { ...DEFAULTS.thresholds } };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case "--url": cfg.url = String(next() ?? "").replace(/\/$/, ""); break;
      case "--matches": cfg.matches = num(flag, next(), { min: 1, max: 5000, int: true }); break;
      case "--viewers": cfg.viewersPerMatch = num(flag, next(), { min: 0, max: 1000, int: true }); break;
      case "--duration": cfg.durationSec = num(flag, next(), { min: 1, max: 3600 }); break;
      case "--rate": cfg.scoreRateHz = num(flag, next(), { min: 0.1, max: 20 }); break;
      case "--ramp": cfg.rampPerSec = num(flag, next(), { min: 1, max: 5000 }); break;
      case "--mode": {
        const m = next();
        if (m !== "multi" && m !== "legacy") throw new Error(`--mode must be "multi" or "legacy" (got ${JSON.stringify(m)})`);
        cfg.mode = m;
        break;
      }
      case "--keep-data": cfg.keepData = true; break;
      case "--json": cfg.jsonOut = next(); break;
      case "--p95": cfg.thresholds.p95LatencyMs = num(flag, next(), { min: 1 }); break;
      case "--p99": cfg.thresholds.p99LatencyMs = num(flag, next(), { min: 1 }); break;
      case "--min-connect": cfg.thresholds.minConnectSuccess = num(flag, next(), { min: 0, max: 1 }); break;
      case "--max-diverged": cfg.thresholds.maxDivergedViewers = num(flag, next(), { min: 0, int: true }); break;
      default: throw new Error(`unknown argument ${JSON.stringify(flag)}`);
    }
  }
  if (cfg.mode === "legacy" && cfg.matches !== 1) {
    // Legacy mode has no org/match model: every socket lands in one shared
    // room, so "N concurrent matches" cannot be simulated. Fail loudly rather
    // than silently reporting a single-room result as an N-match one.
    if (argv.includes("--matches")) throw new Error("--mode legacy supports exactly 1 match (all sockets share one room); use --mode multi for concurrent matches");
    cfg.matches = 1;
  }
  return cfg;
}

// Nearest-rank percentile on an unsorted sample. Returns NaN for an empty set
// so an absent measurement can never masquerade as a passing 0ms.
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface Summary {
  socketsAttempted: number;
  socketsConnected: number;
  unexpectedDisconnects: number;
  latencyMs: number[];
  viewersChecked: number;
  viewersDiverged: number;
  controllersDenied: number;
  actionsSent: number;
  // A viewer receiving a sequenceId lower than one it already saw: the relay
  // promises monotonic ids so displays can safely discard stale updates.
  sequenceRegressions: number;
}

export interface Verdict {
  pass: boolean;
  failures: string[];
}

export function evaluate(s: Summary, t: Thresholds): Verdict {
  const failures: string[] = [];
  const connectRate = s.socketsAttempted === 0 ? 0 : s.socketsConnected / s.socketsAttempted;
  if (connectRate < t.minConnectSuccess) {
    failures.push(`connect success ${(connectRate * 100).toFixed(2)}% < ${(t.minConnectSuccess * 100).toFixed(2)}%`);
  }
  if (s.controllersDenied > 0) failures.push(`${s.controllersDenied} controller(s) were never granted control`);
  if (s.unexpectedDisconnects > 0) failures.push(`${s.unexpectedDisconnects} socket(s) disconnected unexpectedly mid-run`);
  if (s.actionsSent === 0) failures.push("no score actions were sent, so nothing was measured");
  if (s.sequenceRegressions > 0) failures.push(`${s.sequenceRegressions} out-of-order sequenceId(s) seen by viewers`);

  if (s.viewersChecked > 0) {
    if (s.latencyMs.length === 0) {
      failures.push("no viewer ever observed a score change (0 latency samples)");
    } else {
      const p95 = percentile(s.latencyMs, 95);
      const p99 = percentile(s.latencyMs, 99);
      if (p95 > t.p95LatencyMs) failures.push(`p95 latency ${p95.toFixed(0)}ms > ${t.p95LatencyMs}ms`);
      if (p99 > t.p99LatencyMs) failures.push(`p99 latency ${p99.toFixed(0)}ms > ${t.p99LatencyMs}ms`);
    }
    if (s.viewersDiverged > t.maxDivergedViewers) {
      failures.push(`${s.viewersDiverged} viewer(s) ended on a different score than their controller (max ${t.maxDivergedViewers})`);
    }
  }
  return { pass: failures.length === 0, failures };
}
