#!/usr/bin/env node
// Post-deploy smoke test (SA-30). Credential-free checks that a deployed relay
// (and optionally frontend) are actually serving, run after deploy.yml /
// deploy-uat.yml. It catches the failure class docker-compose can't: config
// and wiring breakage that only exists in the real environment (missing env
// var, wrong DATABASE_URL, proxy/websocket misrouting, a bad build).
//
//   node scripts/smoke.mjs --relay https://scorehub-relay.fly.dev \
//                          --frontend https://app.scorehub.co.nz [--expect multi|legacy] [--wait 120]
//
// Against a multi-tenant relay (the default expectation) it also proves the
// database round trip works: `GET /state?matchId=<unknown>` must answer a clean
// 400 (a real Prisma lookup returned "no such match"), not a 500 or a hang.
// Exit code: 0 all passed, 1 a check failed, 2 usage error.

import { io } from "socket.io-client";
import crypto from "node:crypto";

function parseArgs(argv) {
  const out = { expect: "multi", wait: 120 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--relay") out.relay = String(v() ?? "").replace(/\/$/, "");
    else if (k === "--frontend") out.frontend = String(v() ?? "").replace(/\/$/, "");
    else if (k === "--expect") out.expect = v();
    else if (k === "--wait") out.wait = Number(v());
    else throw new Error(`unknown argument ${JSON.stringify(k)}`);
  }
  if (!out.relay && !out.frontend) throw new Error("give at least one of --relay / --frontend");
  if (!["multi", "legacy"].includes(out.expect)) throw new Error('--expect must be "multi" or "legacy"');
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

async function main() {
  let cfg;
  try { cfg = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }

  console.log(`smoke test: relay=${cfg.relay ?? "-"} frontend=${cfg.frontend ?? "-"} expect=${cfg.expect} wait=${cfg.wait}s`);
  const results = [];
  for (const check of buildChecks(cfg)) {
    const t0 = Date.now();
    try {
      await retrying(check.run, cfg.wait);
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
