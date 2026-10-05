#!/usr/bin/env node
// Post-deploy smoke test (SA-30). Credential-free checks that a deployed relay
// (and optionally frontend) are actually serving, run after deploy.yml /
// deploy-uat.yml. It catches the failure class docker-compose can't: config
// and wiring breakage that only exists in the real environment (missing env
// var, wrong DATABASE_URL, proxy/websocket misrouting, a bad build).
//
//   node scripts/smoke.mjs --relay https://relay.scorehub.co.nz \
//                          --frontend https://app.scorehub.co.nz [--expect multi|legacy] [--wait 120]
//
// Against a multi-tenant relay (the default expectation) it also proves the
// database round trip works: `GET /state?matchId=<unknown>` must answer a clean
// 400 (a real Prisma lookup returned "no such match"), not a 500 or a hang.
//
// Authenticated checks (SA-30): with the smoke org's credentials in the
// environment it also drives a real match through the relay — a score change and
// a clock start/stop made with a match-pinned CONTROL token must reach a live
// viewer socket, and the score is always restored afterwards. Provision the
// org with `npm run smoke:provision --workspace=relay` (docs/smoke-org.md), then
// set SMOKE_CONTROL_TOKEN, SMOKE_ORG_ID, SMOKE_MATCH_ID, SMOKE_DISPLAY_TOKEN.
//   --auth optional (default)  skip, loudly, when the credentials are absent
//   --auth required            fail when they are absent (use once configured)
//   --auth off                 never run them
// Exit code: 0 all passed, 1 a check failed, 2 usage error.

import { io } from "socket.io-client";
import crypto from "node:crypto";

function parseArgs(argv) {
  const out = { expect: "multi", wait: 120, auth: "optional" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--relay") out.relay = String(v() ?? "").replace(/\/$/, "");
    else if (k === "--frontend") out.frontend = String(v() ?? "").replace(/\/$/, "");
    else if (k === "--expect") out.expect = v();
    else if (k === "--wait") out.wait = Number(v());
    else if (k === "--auth") out.auth = v();
    else throw new Error(`unknown argument ${JSON.stringify(k)}`);
  }
  if (!out.relay && !out.frontend) throw new Error("give at least one of --relay / --frontend");
  if (!["multi", "legacy"].includes(out.expect)) throw new Error('--expect must be "multi" or "legacy"');
  if (!["optional", "required", "off"].includes(out.auth)) throw new Error('--auth must be "optional", "required" or "off"');
  if (!Number.isFinite(out.wait) || out.wait < 0) throw new Error("--wait must be a non-negative number of seconds");
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A deploy takes a while to become reachable, so each check is retried until
// `waitSec` elapses. A check that never passes reports its last failure.
async function retrying(fn, waitSec) {
  const deadline = Date.now() + waitSec * 1000;
  let lastErr;
  for (;;) {
    try { return await fn(); } catch (err) { lastErr = err; }
    if (Date.now() >= deadline) throw lastErr;
    await sleep(3000);
  }
}

const get = async (url, init) => fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "manual", ...init });

function expectStatus(res, allowed, what) {
  if (!allowed.includes(res.status)) throw new Error(`${what}: expected HTTP ${allowed.join("/")}, got ${res.status}`);
}

function socketHandshake(relay) {
  return new Promise((resolve, reject) => {
    // No credentials and no org: a multi-tenant relay must refuse this with its
    // own middleware error, which proves the websocket upgrade got through the
    // proxy and reached the relay's auth path.
    const socket = io(relay, { reconnection: false, transports: ["websocket"], timeout: 10_000 });
    const timer = setTimeout(() => { socket.close(); reject(new Error("socket handshake timed out")); }, 12_000);
    socket.once("connect", () => { clearTimeout(timer); socket.close(); resolve({ connected: true, message: "" }); });
    socket.once("connect_error", err => { clearTimeout(timer); socket.close(); resolve({ connected: false, message: err.message }); });
  });
}

function buildChecks(cfg) {
  const checks = [];
  if (cfg.relay) {
    checks.push({
      name: "relay /health",
      run: async () => {
        const res = await get(`${cfg.relay}/health`);
        expectStatus(res, [200], "relay /health");
        const body = await res.json();
        if (body.status !== "ok") throw new Error(`relay /health body: ${JSON.stringify(body)}`);
      },
    });
    checks.push({
      name: cfg.expect === "multi" ? "relay database round trip (GET /state, unknown match -> 400)" : "relay GET /state (legacy)",
      run: async () => {
        if (cfg.expect === "legacy") {
          expectStatus(await get(`${cfg.relay}/state`), [200], "relay /state");
          return;
        }
        const res = await get(`${cfg.relay}/state?matchId=${crypto.randomUUID()}`);
        expectStatus(res, [400], "relay /state with an unknown matchId");
        const body = await res.json();
        if (!/org/i.test(String(body.error))) throw new Error(`unexpected /state error body: ${JSON.stringify(body)}`);
      },
    });
    checks.push({
      name: "relay websocket handshake",
      run: async () => {
        const { connected, message } = await socketHandshake(cfg.relay);
        if (cfg.expect === "legacy") {
          if (!connected) throw new Error(`legacy relay refused an anonymous viewer: ${message}`);
        } else if (connected || !/org/i.test(message)) {
          throw new Error(`expected the relay's own "org required" refusal, got ${connected ? "a connection" : JSON.stringify(message)}`);
        }
      },
    });
    checks.push({
      name: "relay rejects a bad control secret (auth is enforced)",
      run: async () => expectStatus(await get(`${cfg.relay}/api/me`, { headers: { "x-control-secret": "smoke-test-not-a-real-secret" } }), [401], "relay /api/me"),
    });
  }
  if (cfg.frontend) {
    checks.push({
      name: "frontend /api/health",
      run: async () => {
        const res = await get(`${cfg.frontend}/api/health`);
        expectStatus(res, [200], "frontend /api/health");
        const body = await res.json();
        if (body.status !== "ok") throw new Error(`frontend /api/health body: ${JSON.stringify(body)}`);
      },
    });
    for (const path of ["/login", "/signup", "/terms", "/privacy"]) {
      checks.push({
        name: `frontend ${path} renders`,
        run: async () => {
          const res = await get(`${cfg.frontend}${path}`);
          expectStatus(res, [200], `frontend ${path}`);
          const html = await res.text();
          if (!/<html/i.test(html)) throw new Error(`frontend ${path} did not return HTML`);
        },
      });
    }
    checks.push({
      name: "frontend /control requires a login",
      run: async () => {
        const res = await get(`${cfg.frontend}/control`);
        // Redirect to /login (3xx) or a 401/403 — anything but serving the panel or crashing.
        expectStatus(res, [301, 302, 303, 307, 308, 401, 403], "frontend /control (unauthenticated)");
      },
    });
    checks.push({
      name: "frontend /api/control-token requires a session",
      run: async () => expectStatus(await get(`${cfg.frontend}/api/control-token`), [401, 403], "frontend /api/control-token"),
    });
  }
  return checks;
}


// ─── Authenticated checks ────────────────────────────────────────────────────

function readCreds(env) {
  return { control: env.SMOKE_CONTROL_TOKEN, org: env.SMOKE_ORG_ID, match: env.SMOKE_MATCH_ID, display: env.SMOKE_DISPLAY_TOKEN };
}

function credsMissing(cfg, c) {
  const need = cfg.expect === "legacy"
    ? [["SMOKE_CONTROL_TOKEN", c.control]]
    : [["SMOKE_CONTROL_TOKEN", c.control], ["SMOKE_ORG_ID", c.org], ["SMOKE_MATCH_ID", c.match], ["SMOKE_DISPLAY_TOKEN", c.display]];
  return need.filter(([, v]) => !v).map(([k]) => k);
}

// A viewer socket exactly as a display page opens one (org + match + display
// token, no secret), which remembers the latest state and lets a check wait
// for a state satisfying a predicate.
function openViewer(cfg, c) {
  const auth = cfg.expect === "legacy" ? {} : { orgId: c.org, matchId: c.match, token: c.display };
  return new Promise((resolve, reject) => {
    const socket = io(cfg.relay, { auth, reconnection: false, transports: ["websocket"], timeout: 10_000 });
    const viewer = { socket, state: null, lastSeq: -1, regressions: 0, waiters: [] };
    socket.on("matchStateChange", state => {
      if (viewer.state && state.sequenceId < viewer.lastSeq) viewer.regressions++;
      viewer.lastSeq = Math.max(viewer.lastSeq, state.sequenceId);
      viewer.state = state;
      viewer.waiters = viewer.waiters.filter(w => { if (w.pred(state)) { w.resolve(state); return false; } return true; });
    });
    viewer.waitFor = (pred, ms, what) => new Promise((res, rej) => {
      if (viewer.state && pred(viewer.state)) return res(viewer.state);
      const timer = setTimeout(() => rej(new Error(`viewer never saw ${what} within ${ms}ms`)), ms);
      viewer.waiters.push({ pred, resolve: st => { clearTimeout(timer); res(st); } });
    });
    viewer.close = () => socket.close();
    socket.once("connect_error", err => reject(new Error(`viewer socket refused: ${err.message}`)));
    viewer.waitFor(() => true, 10_000, "an initial state").then(() => resolve(viewer), reject);
  });
}

const control = (cfg, c) => (path, init = {}) =>
  get(`${cfg.relay}${path}`, { method: "POST", headers: { "x-control-secret": c.control }, ...init });

async function readState(cfg, c) {
  const q = cfg.expect === "legacy" ? "" : `?org=${encodeURIComponent(c.org)}&matchId=${encodeURIComponent(c.match)}&token=${encodeURIComponent(c.display)}`;
  const res = await get(`${cfg.relay}/state${q}`);
  expectStatus(res, [200], "relay /state for the smoke match");
  return res.json();
}

function authChecks(cfg, c) {
  const post = control(cfg, c);
  return [
    {
      name: "smoke control token is valid and pinned to the smoke match",
      run: async () => {
        const res = await get(`${cfg.relay}/api/me`, { headers: { "x-control-secret": c.control } });
        expectStatus(res, [200], "relay /api/me with the smoke control token");
        const body = await res.json();
        if (cfg.expect === "multi" && (body.orgId !== c.org || body.matchId !== c.match)) {
          throw new Error(`token resolves to org=${body.orgId} match=${body.matchId}, expected org=${c.org} match=${c.match} (wrong or unpinned token?)`);
        }
      },
      retry: true,
    },
    {
      // Not retried: each attempt mutates the match. The score is put back in
      // `finally` whatever happens, so a failed attempt never leaves it changed.
      name: "score change reaches a live viewer (control token -> relay -> socket), then is restored",
      retry: false,
      run: async () => {
        const viewer = await openViewer(cfg, c);
        const base = viewer.state.home.score;
        try {
          const t0 = Date.now();
          const res = await post("/action/score/home?delta=1");
          expectStatus(res, [200], "POST /action/score/home");
          const body = await res.json();
          if (body.score !== base + 1) throw new Error(`relay reported score ${body.score}, expected ${base + 1}`);
          await viewer.waitFor(st => st.home.score === base + 1, 5000, `home score ${base + 1}`);
          const ms = Date.now() - t0;
          if (ms > 5000) throw new Error(`score took ${ms}ms to reach the viewer`);
          if (viewer.regressions > 0) throw new Error("viewer saw a sequenceId go backwards");
        } finally {
          try {
            const now = await readState(cfg, c);
            if (now.home.score !== base) {
              const delta = Math.max(-99, Math.min(99, base - now.home.score));
              await post(`/action/score/home?delta=${delta}`);
            }
          } finally {
            viewer.close();
          }
        }
      },
    },
    {
      name: "clock start/stop reaches a live viewer",
      retry: false,
      run: async () => {
        const viewer = await openViewer(cfg, c);
        try {
          if (viewer.state.isRunning) await post("/action/stop"); // start from a known state
          await viewer.waitFor(st => !st.isRunning, 5000, "a stopped clock");
          expectStatus(await post("/action/start"), [200], "POST /action/start");
          await viewer.waitFor(st => st.isRunning, 5000, "a running clock");
          expectStatus(await post("/action/stop"), [200], "POST /action/stop");
          await viewer.waitFor(st => !st.isRunning, 5000, "a stopped clock again");
        } finally {
          try { await post("/action/stop"); } finally { viewer.close(); }
        }
      },
    },
  ];
}

async function main() {
  let cfg;
  try { cfg = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }

  console.log(`smoke test: relay=${cfg.relay ?? "-"} frontend=${cfg.frontend ?? "-"} expect=${cfg.expect} wait=${cfg.wait}s`);
  const results = [];
  const checks = buildChecks(cfg);

  if (cfg.relay && cfg.auth !== "off") {
    const creds = readCreds(process.env);
    const missing = credsMissing(cfg, creds);
    if (missing.length === 0) {
      checks.push(...authChecks(cfg, creds));
    } else if (cfg.auth === "required") {
      checks.push({ name: "authenticated smoke checks are configured", run: async () => { throw new Error(`missing ${missing.join(", ")}`); }, retry: false });
    } else {
      console.log(`  SKIP  authenticated checks — not configured (missing ${missing.join(", ")}); see docs/smoke-org.md`);
    }
  }

  for (const check of checks) {
    const t0 = Date.now();
    try {
      await retrying(check.run, check.retry === false ? 0 : cfg.wait);
      console.log(`  ok    ${check.name} (${Date.now() - t0}ms)`);
      results.push({ name: check.name, ok: true });
    } catch (err) {
      console.log(`  FAIL  ${check.name} — ${err instanceof Error ? err.message : err}`);
      results.push({ name: check.name, ok: false });
    }
  }
  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `\n${failed.length}/${results.length} checks failed` : `\nall ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
