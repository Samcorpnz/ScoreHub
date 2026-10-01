/* eslint-disable no-console */
// Relay load test (SA-30): N concurrent matches, each with one controller
// pushing score changes and V viewers on the display path, against a running
// relay. Measures controller-action -> viewer-sees-it latency and checks that
// every viewer ends on exactly the controller's score (a dropped or reordered
// update shows up as a "diverged" viewer). Exits non-zero on a threshold
// breach so it can run as a CI/manual gate.
//
//   npm run loadtest --workspace=relay -- --url http://localhost:4000 \
//     --matches 50 --viewers 10 --duration 60
//
// Multi mode (default) is the production shape: it mints control JWTs with
// AUTH_SECRET and seeds one Org + LIVE Match per simulated match straight into
// the DB behind DATABASE_URL (bypassing the free-tier one-live-match gate),
// then deletes them afterwards. Point DATABASE_URL/AUTH_SECRET at the SAME
// database/secret the target relay uses. NEVER run it against production.
//
// Legacy mode (relay started without DATABASE_URL) has one shared room, so it
// can only exercise fan-out for a single match. See docs/load-testing.md.

import crypto from "node:crypto";
import fs from "node:fs";
import { io, Socket } from "socket.io-client";
import { SignJWT } from "jose";
import { DEFAULT_MATCH_STATE } from "../src/types";
import { parseArgs, evaluate, percentile, LoadConfig, Summary } from "./lib";

interface SimMatch {
  index: number;
  orgId: string;
  matchId?: string;
  displayToken?: string;
  // Time each score value was first sent, keyed by the value it produces.
  sentAt: { home: Map<number, number>; visitor: Map<number, number> };
  expected: { home: number; visitor: number };
  controller?: Socket;
  viewers: Viewer[];
}

interface Viewer {
  socket: Socket;
  home: number;
  visitor: number;
  lastSeq: number;
  connected: boolean;
  // The first matchStateChange after connecting is the room's current state,
  // not a change made during the run — it sets the baseline only.
  baselined: boolean;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const now = () => performance.now();

async function seed(cfg: LoadConfig): Promise<{ matches: SimMatch[]; cleanup: () => Promise<void> }> {
  const blank = (index: number, orgId: string, matchId?: string, displayToken?: string): SimMatch => ({
    index, orgId, matchId, displayToken,
    sentAt: { home: new Map(), visitor: new Map() },
    expected: { home: 0, visitor: 0 },
    viewers: [],
  });

  if (cfg.mode === "legacy") {
    return { matches: [blank(0, "legacy-single-tenant")], cleanup: async () => undefined };
  }

  if (!process.env.DATABASE_URL) throw new Error("multi mode needs DATABASE_URL (the relay's database, to seed orgs/matches)");
  if (!process.env.AUTH_SECRET) throw new Error("multi mode needs AUTH_SECRET (the relay's JWT signing key, to mint control tokens)");

  const { prisma } = await import("@scorehub/db");
  const runId = crypto.randomBytes(4).toString("hex");
  const accountId = crypto.randomUUID();
  const orgs = Array.from({ length: cfg.matches }, () => crypto.randomUUID());
  const matchIds = Array.from({ length: cfg.matches }, () => crypto.randomUUID());
  const tokens = Array.from({ length: cfg.matches }, () => crypto.randomBytes(24).toString("hex"));

  await prisma.account.create({ data: { id: accountId, name: `loadtest-${runId}`, plan: "venue" } });
  await prisma.org.createMany({ data: orgs.map((id, i) => ({ id, accountId, name: `loadtest-${runId}-${i}` })) });
  await prisma.match.createMany({
    data: matchIds.map((id, i) => ({
      id, orgId: orgs[i], status: "LIVE" as const, sport: "netball",
      state: DEFAULT_MATCH_STATE as unknown as object, displayToken: tokens[i],
    })),
  });
  console.log(`seeded ${cfg.matches} orgs+matches (run ${runId})`);

  return {
    matches: orgs.map((orgId, i) => blank(i, orgId, matchIds[i], tokens[i])),
    cleanup: async () => {
      if (cfg.keepData) { console.log(`--keep-data: left loadtest-${runId}-* rows in place`); return; }
      // The relay debounces match persistence by ~2s; let any in-flight save
      // land before deleting, otherwise it upserts into a deleted org.
      await sleep(3000);
      await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
      await prisma.org.deleteMany({ where: { id: { in: orgs } } });
      await prisma.account.deleteMany({ where: { id: accountId } });
      await prisma.$disconnect();
      console.log("cleaned up seeded rows");
    },
  };
}

async function controlToken(m: SimMatch, cfg: LoadConfig): Promise<string> {
  if (cfg.mode === "legacy") {
    const s = process.env.CONTROL_SECRET;
    if (!s) throw new Error("legacy mode needs CONTROL_SECRET (the relay's shared control secret)");
    return s;
  }
  return new SignJWT({ orgId: m.orgId, role: "OPERATOR", matchId: m.matchId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`loadtest-user-${m.index}`)
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const totalSockets = cfg.matches * (1 + cfg.viewersPerMatch);
  console.log(
    `relay load test: ${cfg.matches} match(es) x (1 controller + ${cfg.viewersPerMatch} viewers) = ${totalSockets} sockets, ` +
    `${cfg.scoreRateHz}/s per match for ${cfg.durationSec}s, mode=${cfg.mode}, target=${cfg.url}`
  );

  const { matches, cleanup } = await seed(cfg);

  let socketsAttempted = 0;
  let socketsConnected = 0;
  let unexpectedDisconnects = 0;
  let controllersDenied = 0;
  let sequenceRegressions = 0;
  let actionsSent = 0;
  let closing = false;
  const connectMs: number[] = [];
  const latencyMs: number[] = [];
  const connectErrors = new Map<string, number>();
  const noteConnectError = (e: Error) => connectErrors.set(e.message, (connectErrors.get(e.message) ?? 0) + 1);

  // `setup` runs before the socket can connect. The relay emits the room's
  // initial state and the controller grant/conflict straight after the
  // handshake, so any listener for those has to exist first — attaching it in
  // a `connect` handler races the very event it is waiting for.
  const openSocket = (auth: Record<string, unknown>, setup?: (socket: Socket) => void): Promise<Socket | null> => {
    socketsAttempted++;
    const t0 = now();
    const socket = io(cfg.url, { auth, reconnection: false, transports: ["websocket"], timeout: 15_000 });
    setup?.(socket);
    return new Promise(resolve => {
      socket.once("connect", () => {
        socketsConnected++;
        connectMs.push(now() - t0);
        socket.on("disconnect", () => { if (!closing) unexpectedDisconnects++; });
        resolve(socket);
      });
      socket.once("connect_error", err => { noteConnectError(err); socket.close(); resolve(null); });
    });
  };

  const openMatch = async (m: SimMatch): Promise<void> => {
    const secret = await controlToken(m, cfg);
    // The room may already hold a score (always true in legacy mode, where the
    // single room persists between runs), so expected totals start from what
    // the relay says the score is, not from zero.
    let grant!: () => void;
    const granted = new Promise<void>(resolve => { grant = resolve; });
    const ctrl = await openSocket({ secret, role: "control" }, socket => {
      socket.once("matchStateChange", (state: { home: { score: number }; visitor: { score: number } }) => {
        m.expected.home = state.home.score;
        m.expected.visitor = state.visitor.score;
      });
      socket.on("controllerGranted", grant);
      socket.on("controllerConflict", () => socket.emit("takeControl"));
    });
    if (ctrl) {
      m.controller = ctrl;
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        granted.then(() => "granted" as const),
        new Promise<"denied">(resolve => { timer = setTimeout(() => resolve("denied"), 10_000); }),
      ]);
      clearTimeout(timer);
      if (outcome === "denied") controllersDenied++;
    } else {
      controllersDenied++;
    }

    await Promise.all(Array.from({ length: cfg.viewersPerMatch }, async () => {
      const viewerAuth: Record<string, unknown> = cfg.mode === "legacy"
        ? {}
        : { orgId: m.orgId, matchId: m.matchId, token: m.displayToken };
      const socket = await openSocket(viewerAuth);
      if (!socket) return;
      const v: Viewer = { socket, home: 0, visitor: 0, lastSeq: -1, connected: true, baselined: false };
      socket.on("matchStateChange", (state: { sequenceId: number; home: { score: number }; visitor: { score: number } }) => {
        const t = now();
        if (!v.baselined) {
          v.baselined = true;
          v.home = state.home.score;
          v.visitor = state.visitor.score;
          v.lastSeq = state.sequenceId;
          return;
        }
        if (state.sequenceId < v.lastSeq) sequenceRegressions++;
        v.lastSeq = Math.max(v.lastSeq, state.sequenceId);
        for (const side of ["home", "visitor"] as const) {
          const score = state[side].score;
          if (score > v[side]) {
            const sent = m.sentAt[side].get(score);
            if (sent !== undefined) latencyMs.push(t - sent);
          }
          v[side] = score;
        }
      });
      m.viewers.push(v);
    }));
  };

  // Ramp: open matches at a steady connection rate rather than all at once.
  const perMatchSockets = 1 + cfg.viewersPerMatch;
  const openGapMs = Math.max(0, (perMatchSockets / cfg.rampPerSec) * 1000);
  const openings: Promise<void>[] = [];
  for (const m of matches) {
    openings.push(openMatch(m));
    if (openGapMs > 0) await sleep(openGapMs);
  }
  await Promise.all(openings);
  console.log(`connected ${socketsConnected}/${socketsAttempted} sockets; starting ${cfg.durationSec}s of scoring`);

  // Sample the relay's own liveness endpoint while under load: a saturated
  // event loop shows up here even when sockets still look healthy.
  const healthMs: number[] = [];
  const healthTimer = setInterval(async () => {
    const t0 = now();
    try { await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(5000) }); healthMs.push(now() - t0); }
    catch { healthMs.push(5000); }
  }, 1000);

  const intervalMs = 1000 / cfg.scoreRateHz;
  const timers = matches.filter(m => m.controller?.connected).map(m => {
    let n = 0;
    let timer: NodeJS.Timeout;
    // Random phase so N matches don't all fire on the same millisecond.
    const kickoff = setTimeout(() => {
      timer = setInterval(() => {
        const side = n++ % 2 === 0 ? "home" : "visitor";
        const value = ++m.expected[side];
        m.sentAt[side].set(value, now());
        m.controller!.emit("adjustScore", { side, delta: 1 });
        actionsSent++;
      }, intervalMs);
    }, Math.random() * intervalMs);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  });

  await sleep(cfg.durationSec * 1000);
  timers.forEach(stop => stop());
  await sleep(3000); // drain: let the last broadcasts land before comparing
  clearInterval(healthTimer);

  let viewersChecked = 0;
  let viewersDiverged = 0;
  const divergenceSamples: string[] = [];
  for (const m of matches) {
    for (const v of m.viewers) {
      viewersChecked++;
      if (v.home !== m.expected.home || v.visitor !== m.expected.visitor) {
        viewersDiverged++;
        if (divergenceSamples.length < 5) {
          divergenceSamples.push(`match ${m.index}: viewer ${v.home}-${v.visitor}, controller expected ${m.expected.home}-${m.expected.visitor}`);
        }
      }
    }
  }

  closing = true;
  for (const m of matches) { m.controller?.close(); m.viewers.forEach(v => v.socket.close()); }
  await cleanup();

  const summary: Summary = {
    socketsAttempted, socketsConnected, unexpectedDisconnects, latencyMs,
    viewersChecked, viewersDiverged, controllersDenied, actionsSent, sequenceRegressions,
  };
  const verdict = evaluate(summary, cfg.thresholds);
  const fmt = (n: number) => (Number.isNaN(n) ? "n/a" : `${n.toFixed(0)}ms`);
  const report = {
    config: { ...cfg, jsonOut: undefined },
    sockets: { attempted: socketsAttempted, connected: socketsConnected, unexpectedDisconnects },
    connectMs: { p50: percentile(connectMs, 50), p95: percentile(connectMs, 95), max: percentile(connectMs, 100) },
    latencyMs: { samples: latencyMs.length, p50: percentile(latencyMs, 50), p95: percentile(latencyMs, 95), p99: percentile(latencyMs, 99), max: percentile(latencyMs, 100) },
    relayHealthMs: { samples: healthMs.length, p95: percentile(healthMs, 95), max: percentile(healthMs, 100) },
    correctness: { actionsSent, viewersChecked, viewersDiverged, sequenceRegressions, controllersDenied },
    connectErrors: Object.fromEntries(connectErrors),
    divergenceSamples,
    verdict,
  };

  console.log("\n─── results ───────────────────────────────────────────");
  console.log(`sockets      ${socketsConnected}/${socketsAttempted} connected, ${unexpectedDisconnects} dropped mid-run`);
  console.log(`connect      p50 ${fmt(report.connectMs.p50)}  p95 ${fmt(report.connectMs.p95)}  max ${fmt(report.connectMs.max)}`);
  console.log(`latency      p50 ${fmt(report.latencyMs.p50)}  p95 ${fmt(report.latencyMs.p95)}  p99 ${fmt(report.latencyMs.p99)}  max ${fmt(report.latencyMs.max)}  (${latencyMs.length} samples)`);
  console.log(`relay /health p95 ${fmt(report.relayHealthMs.p95)}  max ${fmt(report.relayHealthMs.max)}`);
  console.log(`correctness  ${actionsSent} actions, ${viewersDiverged}/${viewersChecked} viewers diverged, ${sequenceRegressions} sequence regressions`);
  for (const d of divergenceSamples) console.log(`  diverged: ${d}`);
  if (connectErrors.size) console.log(`connect errors ${JSON.stringify(report.connectErrors)}`);
  console.log(verdict.pass ? "\nPASS" : `\nFAIL\n  - ${verdict.failures.join("\n  - ")}`);

  if (cfg.jsonOut) fs.writeFileSync(cfg.jsonOut, JSON.stringify(report, null, 2));
  process.exit(verdict.pass ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
