# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System overview

Live sport scoring display. Three deployables, data flowing one direction:

```
Saturn/Vega Console (RS422/serial)
      ↓
  bridge/   ← runs on the operator's venue laptop; parses serial protocol
      ↓  Socket.io push (authenticated)
  relay/    ← cloud server (Fly.io, multi-region), holds live MatchState in memory
      ↓  Socket.io broadcast
  frontend/ ← Next.js app (Vercel) — /display/* (viewers) and /control (operator)
```

`packages/types` (`@scorehub/types`) and `packages/db` (`@scorehub/db`, Prisma) are shared
workspaces consumed by both `frontend` and `relay`. This is an npm workspaces monorepo — always
run installs from the repo root (`npm install`), not inside a sub-package.

Three more standalone sites live alongside the app, each its own Cloudflare Worker (not part of the
npm workspace, not on Vercel): `marketing/` (public marketing site, linked from `app.scorehub.co.nz`),
`help/` (help centre, linked from the marketing footer and app nav — see commit
`d74e766`), and `downloads/` (`downloads.scorehub.co.nz` — a thin redirect Worker, no static site;
resolves `/mac` and `/windows`, plus `/` via User-Agent sniffing, to a 302 at the latest bridge
installer published as a GitHub Release asset by the `bridge-release` CI pipeline (SA-91).
Installers are **not** stored in R2/S3 — the repo is public, so release assets are already public
URLs, and `electron-updater` (SA-92) consumes the GitHub release feed natively; see the SA-88 epic
for the full decision). All three build/deploy independently of `frontend/`'s Vercel pipeline, but
share its gating: `deploy.yml`'s `deploy-marketing`/`deploy-help`/`deploy-downloads` jobs push to
Cloudflare Workers on every push to `main`, behind the same `production` GitHub Environment
required-reviewer gate as relay/frontend (needs a `CLOUDFLARE_API_TOKEN` repo secret, scoped to
account `c0c396b5f4c3cf71c2ecb3821febaf92`). UAT (`uat` branch) is ungated: `help/` auto-deploys on
every push to `uat` (`deploy-uat.yml`'s `deploy-help-uat` job), while `marketing/` and `downloads/`
are still manual — `cd marketing && npm run build && npx wrangler deploy --env uat` (same pattern
for `downloads/`), see `docs/uat-environment.md`. **When a change touches user-facing naming, pricing,
plans/add-ons, feature descriptions, URLs/routes, or anything else these sites reference, check
`marketing/` and `help/` for content that now needs updating too** — they're easy to forget since
they build and deploy independently of `frontend/`.

## Commands

Run from repo root unless noted. Each sub-package (`frontend`, `relay`, `bridge`, `packages/db`)
has its own `package.json`; use `--workspace=<name>` or `cd` into it.

```bash
npm run dev:relay          # relay on :4000
npm run dev:frontend       # frontend on :3000 (bridge has no root script — cd bridge && npm run dev)
npm run build:relay
npm run build:frontend
npm run db:migrate         # prisma migrate dev, from packages/db

npm test                   # all workspaces, --if-present
npm test --workspace=relay
npm test --workspace=frontend      # vitest
npm test --workspace=bridge        # jest — protocol parser tests
```

E2E, load and smoke tests (full picture in `docs/testing.md`): `npm run test:e2e:critical` runs
the gating `@critical` Playwright set (needs `docker compose up`); whether it actually blocks
deploys is switched by the `E2E_CRITICAL_GATE` repo variable, not by code. `npm run loadtest
--workspace=relay` drives N concurrent matches against a relay (`docs/load-testing.md`; never
point it at production — it seeds orgs/matches into the DB it's given). `node scripts/smoke.mjs`
runs after each deploy; its authenticated half uses a dedicated smoke org (`docs/smoke-org.md`) and is
skipped until that org's credentials are configured.

Single test file:
```bash
cd relay && npx jest src/__tests__/entitlements.test.ts
cd bridge && npx jest src/__tests__/saturnParser.test.ts
cd frontend && npx vitest run app/__tests__/sportTemplates.test.ts
```

Frontend also needs, before `next build`/`npx tsc --noEmit` will succeed, `@scorehub/db` built
first: `npm run build --workspace=packages/db`. CI (`.github/workflows/test.yml`) runs, per
package: `npm audit --omit=dev --audit-level=high`, then (frontend only) `tsc --noEmit`, `eslint`,
tests, `next build`.

Docker Compose (`docker-compose.yml`) spins up Postgres, Redis, relay, and frontend together for
local dev without needing Neon/Upstash accounts — the bridge still runs natively since serial
ports don't pass cleanly into containers.

## Adding a new sport

The codebase is config-driven. A "drop-in" sport (standard scoring, no bespoke control panel)
touches exactly 4 files:

1. `packages/types/index.ts` — add to the `SportType` union
2. `frontend/app/sport-templates.ts` — add a `SportTemplate` object (`scoreIncrements`,
   `resetScoreOnPeriod`, optional `matchConfig` for match-creation config fields, optional
   `controlPanel` component override)
3. `relay/src/schemas.ts` — add to the Zod `sportSchema` enum
4. `relay/src/server.ts` — add to `SPORT_DEFAULT_CLOCK` (and `SPORT_RESET_SCORE_ON_PERIOD` if
   the sport zeroes scores between games/sets)

Sports with bespoke state or UI (cricket, softball, indoor cricket) additionally define a state
type in `packages/types/sports/<sport>.ts`, added to the `sportState` discriminated union
(`state.sport` narrows it), and can supply a custom `ScoreTab` panel component instead of the
generic one. See `docs/multi-sport-expansion-plan.md` for the full phased rollout, per-sport
scoring rules, and rationale for this architecture (it replaced hardcoded `if (sport ===
"netball")` branches scattered across the control UI).

Adding a new console/protocol source (beyond Saturn/Vega): write a parser in
`bridge/src/protocol/` and register it in `bridge/src/index.ts`.

## Auth & multi-tenancy model

Three distinct credential types accepted by the relay (`relay/src/auth.ts`), each serving a
different caller:

- **Control JWT** — short-lived, minted by the frontend's `/api/control-token` route from the
  logged-in user's session (requires ADMIN/MANAGER/OPERATOR role). Used by the control panel.
- **CONTROL ScopedToken** — long-lived, DB-backed (hashed with SHA-256, never stored raw), for
  Stream Deck / webhook callers that can't do an interactive login.
- **BRIDGE ScopedToken** — long-lived, per-org, generated from the control panel's Settings tab;
  authenticates the venue-laptop bridge process.

When `DATABASE_URL` is unset (local dev / Jest, or a self-hosted single-tenant deployment with no
billing), all three auth functions fall back to comparing against a shared `legacySecret` and
route everything into `LEGACY_ROOM_ID` — there's no org/account model to check. Don't assume
`DATABASE_URL` is always set when touching `relay/src/auth.ts`, `entitlements.ts`, or
`persistence.ts`.

Plan gating (`relay/src/entitlements.ts`) — e.g. Free tier's one-concurrent-live-match limit — is
also a no-op in legacy mode. `requirePlan()` middleware must run after `controlAuth` (needs
`req.orgId`) and after rate-limiting, so unauthenticated requests are throttled before hitting DB
lookups.

Prisma schema (`packages/db/prisma/schema.prisma`): `Account` → `Org` (hierarchical, self-referencing
`parentOrgId`) → `Membership` (role-based) → `User`; `Match`, `Invitation`, `ScopedToken`,
`StripeEvent`, `EmailChangeRequest` round out the model.

## Billing (Stripe)

Two entirely separate Stripe accounts, not live/test modes of one account — a test-mode API key
authenticates against a different `acct_...` ID than the live key, so anything set up in one
(products, prices, webhook endpoints) does not exist in the other and has to be replicated by
hand:

- **Live** — `acct_1Tl1p7HOooda4q8p` (`sk_live_51Tl1p7...`), used by `frontend/.env.vercel.production`.
- **Test** — `acct_1Tl1swHwavOcrAr0` (`sk_test_51Tl1sw...`), used by `frontend/.env.local` and
  `frontend/.env.vercel.preview`.

Catalog: `ScoreHub Pro` ($89/mo, $890/yr), `ScoreHub Venue` ($349/mo, $3,490/yr), and the
`ScoreHub Graphics` add-on ($29/mo, $290/yr — requires an active Pro or Venue plan; see
`requireAddOn("graphics-operator")` in `relay/src/entitlements.ts`), and the `ScoreHub Data Feed`
add-on ($39/mo, $390/yr; `STRIPE_PRICE_ID_DATA_FEED`/`_ANNUAL`) — it gates both the third-party
data feed and console bridging: BRIDGE token creation and the relay's `bridge` socket handshake
both require `data-feed` in `Account.addOns` (see `relay/src/matchPicker.ts`). All prices are NZD, and the
annual price is always 10x the monthly price (2 months free). `frontend/lib/plans.ts` maps
plan/add-on names to `STRIPE_PRICE_ID_*` env vars in both directions — adding a price in Stripe
without adding its env var (in `.env.example`, `.env.local`, and both `.env.vercel.*` files) means
checkout 500s with "not configured".

`.env.vercel.production`/`.env.vercel.preview` are gitignored local snapshots of whatever's
actually configured in the Vercel dashboard — editing them locally does not push the change to
Vercel; that still needs `vercel env add` or the dashboard.

## Serial protocol (bridge)

**Saturn/Vega (Swiss Timing)**, spec 0100.073.02 v2.0 — 9600 baud, 8N1, RS422. Messages are
framed with STX/ETX + XOR checksum. Cycle: `D` (match state) + `F1`/`F2` (player shirts) +
`F3`/`F4` (points) + `T` (time/config) + `N` (names). Parser: `bridge/src/protocol/saturnParser.ts`.

ChampionData is a second, non-serial source (`bridge/src/sources/championData*`) — JSON polling
or scraping — for sports where no physical console feeds the bridge.

## Deployment

Human-gated: `.github/workflows/deploy.yml` triggers on every push to `main`, runs the full test
suite, then deploys relay (Fly.io) and frontend (Vercel), gated behind the `Production` GitHub
Environment. That environment's `required_reviewers` protection rule (added 2026-07-03, one
reviewer: the repo owner) is what actually pauses the workflow for approval — the `environment:`
key in the YAML alone does nothing if the environment has no protection rules configured, which
was the case for weeks (every push deployed immediately, no gate). Check
`gh api repos/Samcorpnz/ScoreHub/environments/production` if this ever needs re-verifying; the
name is matched case-insensitively. Fly.io's own git-push auto-deploy must also stay disabled in
its dashboard — otherwise every push deploys immediately, bypassing this gate. Vercel's GitHub
integration stays connected, because UAT and PR previews depend on it, but `frontend/vercel.json`
sets `git.deploymentEnabled.main` to `false` so it never deploys `main`; without that file the
integration ships every push to `main` to production within seconds, ahead of tests and approval
(which is what was happening until 2026-10-05). To re-verify, check that the GitHub deployments
list (`gh api repos/Samcorpnz/ScoreHub/deployments`) has no `vercel[bot]` entries with
environment `Production` for new `main` commits.
The production relay's public address is `https://relay.scorehub.co.nz` (a Fly certificate on
`scorehub-relay` plus DNS-only `A`/`AAAA` records in Cloudflare; `scorehub-relay.fly.dev` still
answers). It is baked into Bridge installers and the Stream Deck plugin as their default (SA-146),
so it must keep working even if the relay moves host. The Stream Deck plugin download served by the
control panel is a committed file, `frontend/public/scorehub.streamDeckPlugin` — rebuild it with
`cd stream-deck-plugin && npm run package` whenever the plugin changes, or customers keep getting
the old one.
`AUTH_SECRET` must be identical between relay and frontend deployments (it's the shared JWT
signing key for control tokens). Required-reviewer environment protection is free on GitHub for
public repos (like this one) regardless of plan — only private repos need Team/Enterprise for it.

A hosted UAT environment exists as of 2026-08-14/15 — see `docs/uat-environment.md` for the full
stack (dedicated Fly relay, Neon DB branch, Upstash, R2 bucket, and `uat`-branch-scoped Vercel
Preview env vars) and its known gaps. It's built on branch-scoped Preview env vars rather than a
true Vercel Custom Environment or Rolling Release, because the `sam-kerins-projects` Vercel team
is on the Hobby plan and both those features are Pro/Enterprise-only (confirmed 2026-08-15). UAT
has no required-reviewer gate — it's not customer-facing, so pushes to `uat` deploy immediately,
unlike `main`. `docker compose up --build` locally is still the fastest inner-loop check before
pushing to `uat` or `main`.
