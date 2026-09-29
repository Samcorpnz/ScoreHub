# Testing overview

What runs where, and which parts can block a deploy. (SA-30.)

| Tier | Where | Runs | Blocks a deploy? |
| --- | --- | --- | --- |
| Unit / component / route | vitest (`frontend`), jest (`relay`, `bridge`) | every PR, and `deploy.yml`/`deploy-uat.yml` via `test.yml` | **Yes** (`needs: test`) |
| Bridge → relay contract | `bridge/src/__tests__/relayContract.test.ts` | with the bridge tests | **Yes** |
| E2E `@critical` (control → relay → display) | Playwright, `frontend/e2e/specs/control-to-display.spec.ts` | `test-e2e` job, first step | **When `E2E_CRITICAL_GATE=true`** (see below) |
| E2E everything else | Playwright, other specs | `test-e2e` job, second step | No (informational) |
| E2E `@full-sports` | `sport-rules.spec.ts` | on demand: `npm run test:e2e:full-sports` | No |
| Load test | `relay/loadtest` | manual: *Load test* workflow, or `npm run loadtest --workspace=relay` | No — see [load-testing.md](load-testing.md) |
| Post-deploy smoke | `scripts/smoke.mjs` | after the prod and UAT deploy jobs | Marks the deploy run red; cannot roll back |

## The E2E gate switch

`test-e2e` is `continue-on-error` unless the repo **variable** `E2E_CRITICAL_GATE` is `true`
(Settings → Secrets and variables → Actions → Variables). Until it is set the whole job is
informational, exactly as before SA-30, so the `@critical` spec can prove itself stable in CI first.
Once it has been green for a bake-in period, set the variable to `true`: from then on a red
`@critical` spec (or a broken E2E stack) fails `test.yml`, and because both deploy workflows
`needs: test`, blocks the deploy. The rest of the E2E suite stays informational either way (billing
needs live Stripe test-mode calls). To un-gate in an emergency, delete/unset the variable — no code
change or revert needed.

`@critical` tests must stay small, deterministic and fast. Anything flake-prone belongs in a
non-critical spec.

## Running things locally

```bash
npm test                                 # all unit/component/contract tests
docker compose up -d --build             # stack for E2E / load test
npm run test:e2e:critical                # just the gating E2E set
npm run test:e2e                         # everything except @full-sports
npm run loadtest --workspace=relay -- --matches 20 --viewers 10   # flags: docs/load-testing.md
node scripts/smoke.mjs --relay http://localhost:4000 --expect multi
```

## The bridge → relay contract

The relay validates every `stateUpdate` with `matchStateSchema` and, on a failure, drops it with only
a `console.warn` — the display silently freezes on stale data. `relayContract.test.ts` runs Saturn
frames (a golden cycle, arbitrary serial chunking, line noise, and a seeded 3,000-frame fuzz over
every message type) through the real parser and validates each resulting state against the relay's
real schema, so drift between the bridge's forked `types.ts` and the relay's schema fails in CI
instead of at a venue. The bridge's `tsc` build excludes `__tests__` so this test can import the
relay's schema.
