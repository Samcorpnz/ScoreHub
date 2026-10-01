# Relay load testing

SA-30's second acceptance criterion: *a load test confirms the target concurrent-match count holds
up.* The tool lives in [`relay/loadtest/`](../relay/loadtest) and drives a running relay over
Socket.io exactly as the control panel and display pages do.

## What it simulates

Per simulated match: **1 controller** (a control JWT, so it takes the same auth path as the real
control panel) sending timestamped `adjustScore` events, plus **N viewers** on the display path
(`orgId` + `matchId` + display token). It reports:

| Metric | Meaning |
| --- | --- |
| connect success / dropped mid-run | sockets that connected, and sockets that disconnected on their own |
| latency p50/p95/p99/max | controller action → a viewer's socket receives the new score |
| relay `/health` p95/max | sampled once a second while under load; a saturated event loop shows here first |
| diverged viewers | viewers whose final score ≠ the controller's. **Any non-zero value is a dropped or reordered update** |
| sequence regressions | a viewer receiving a `sequenceId` lower than one it already saw |

The exit code is `0` on PASS, `1` on a threshold breach, `2` on a usage/setup error, so it can gate a
job. Defaults: p95 ≤ 500ms, p99 ≤ 1500ms, ≥ 99.5% of sockets connect, zero diverged viewers.

## Running it

Multi mode (default, the production shape) seeds one `Org` + `LIVE` `Match` per simulated match
directly in the database behind `DATABASE_URL` (bypassing the free-tier one-live-match gate), mints
control JWTs with `AUTH_SECRET`, then deletes what it created. `DATABASE_URL` and `AUTH_SECRET` must be
the **same values the target relay uses**.

```bash
# local stack
docker compose up -d --build
DATABASE_URL=postgresql://scorehub:scorehub@localhost:5432/scorehub \
AUTH_SECRET=<same as .env> \
npm run loadtest --workspace=relay -- --url http://localhost:4000 --matches 50 --viewers 10 --duration 60
```

Legacy mode (a relay started **without** `DATABASE_URL`) has a single shared room, so it can only
measure fan-out for one match (`--mode legacy`, `CONTROL_SECRET` env). It cannot answer the
concurrent-matches question.

`--help`-style flags: `--url --matches --viewers --duration --rate --ramp --mode --keep-data --json
--p95 --p99 --min-connect --max-diverged`. See [`relay/loadtest/lib.ts`](../relay/loadtest/lib.ts).

**Never point this at production** — it writes orgs/matches into whichever database you give it. UAT
(`docs/uat-environment.md`) is the right target for a realistic, multi-region-shaped run.

### Practical limits

- Raise the file-descriptor limit on **both** the load generator and the relay host
  (`ulimit -n 10000`). Without it, connects fail around ~700 sockets and the tool reports that as a
  failed connect rate rather than a false pass.
- The generator uses WebSocket transport only (no long-polling upgrade). Real browsers start on
  polling, so real handshakes cost slightly more than measured here.
- One generator process is single-threaded; for several thousand sockets run more than one, or use a
  bigger box. Run it from a different machine than the relay, otherwise you measure both at once.
- Latency is measured on the generator's clock end to end, so it includes the generator's own event
  loop. If generator CPU is saturated the numbers get worse, never better.

## Deciding the target

The ticket does not state a target concurrent-match count, and the code does not encode one, so the
defaults above are placeholders. Pick the number from the business side (e.g. peak simultaneous live
matches on match-day weekends × viewers per match) and record it here:

> **Target:** _TBD_ concurrent matches × _TBD_ viewers each, score rate _TBD_/s

Then run stepped loads (e.g. 25 → 50 → 100 → 200 matches) and note where p95 latency or connect
success first breaks. That knee, not the pass/fail at one size, is the capacity answer.

## Manual workflow

`.github/workflows/load-test.yml` (Actions → *Load test* → Run workflow) brings up the docker-compose
stack on a runner and runs this with the inputs you choose. A shared-CPU runner is a smoke test of
correctness and gross regressions, not a capacity measurement — use UAT for that.
