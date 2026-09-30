# Smoke-test org (authenticated post-deploy smoke test)

`scripts/smoke.mjs` runs after every deploy (`deploy.yml` for production, `deploy-uat.yml` for UAT).
Its unauthenticated checks need no setup. Its **authenticated** checks drive a real match end to end,
and for that they need a dedicated org that exists only for this purpose.

## What the authenticated checks prove

| Check | Proves |
| --- | --- |
| control token valid and pinned to the smoke match | the deployed relay's DB-backed token auth works |
| score +1 via `POST /action/score/home` reaches a live viewer socket, then is restored | control → relay → Socket.io broadcast → viewer works in the real environment, including Postgres persistence wiring and the proxy |
| clock start/stop reaches a live viewer | the clock path, same route |
| **prod only:** a real browser opens `/display/basic` on the deployed frontend and sees the change, then sees it restored | the deployed frontend is built against the deployed relay and renders what it broadcasts |
| **prod only:** `scorebug` and `fullscreen` layouts render the live match | those layouts aren't broken by the build |

The score is always restored (from the relay's *actual* value, not an assumed +1), even if a check
fails midway, so the smoke match sits at a fixed baseline. UAT skips the browser step: its frontend is
deployed by Vercel's Git integration (no job to wait on) and sits behind Cloudflare Access.

## What gets created

One `Account` (plan `free`, no Stripe), one `Org`, **no users and no memberships**, one permanently
`LIVE` netball match, and one `CONTROL` `ScopedToken` **pinned to that match**. The CI credential can
therefore drive that single match and nothing else: it can't touch any customer org, and it holds no
signing key (`AUTH_SECRET`) and no database access. Nothing auto-ends a match — the only code that
sets `ENDED` is the operator's explicit End Match route, and the only scheduled job is the DB backup —
so it stays usable indefinitely, and a relay serves a match by id whatever its status. The org is named "ScoreHub Smoke Test (do not delete)".

## Provisioning (per environment, once)

You need the target environment's `DATABASE_URL`. **Do this for UAT first.**

```bash
npm run build --workspace=packages/db

# 1. Dry run — read-only. Prints the database host you're pointed at and what it would create.
DATABASE_URL='<target db url>' npm run smoke:provision --workspace=relay -- --env uat

# 2. Apply, confirming the host printed in step 1 (a mismatch is refused before any write).
DATABASE_URL='<target db url>' npm run smoke:provision --workspace=relay -- --env uat --apply --confirm-host <host>
```

It prints the exact `gh variable set` / `gh secret set` commands. Run them. Names:

| | Production | UAT |
| --- | --- | --- |
| variable | `SMOKE_ORG_ID`, `SMOKE_MATCH_ID` | `SMOKE_UAT_ORG_ID`, `SMOKE_UAT_MATCH_ID` |
| secret | `SMOKE_CONTROL_TOKEN`, `SMOKE_DISPLAY_TOKEN` | `SMOKE_UAT_CONTROL_TOKEN`, `SMOKE_UAT_DISPLAY_TOKEN` |

The script is idempotent (re-running reuses what exists). The control token's plaintext is shown only
when created — only its hash is stored. Re-run with `--apply --confirm-host <host> --rotate-token` to
revoke it and mint a new one (then update the GitHub secret).

## Enforcement

Until the credentials exist the authenticated checks are **skipped** with a visible `SKIP` line, so
deploys don't go red before setup. Once configured, set the repo variable **`SMOKE_AUTH_MODE=required`**
so a missing or deleted credential fails the run instead of silently skipping.

Smoke runs are serialised per environment (`concurrency` group) because every run mutates the same
match. A smoke failure marks the workflow run red; it cannot roll the deploy back.

## Running it by hand

```bash
SMOKE_ORG_ID=… SMOKE_MATCH_ID=… SMOKE_DISPLAY_TOKEN=… SMOKE_CONTROL_TOKEN=… \
  node scripts/smoke.mjs --relay https://scorehub-relay-uat.fly.dev --expect multi --auth required
# browser check (needs SMOKE_FRONTEND_URL too):
npx playwright install chromium && npm run test:smoke --workspace=frontend
```

For a frontend behind Cloudflare Access set `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` (a
Zero Trust service token) and the browser check sends them as headers.

## Things to know

- The smoke org's match shows up in any DB-wide match count or analytics; filter on the org name.
- If someone ends or deletes the smoke match, the token check fails with a clear message; re-run the
  provisioning script (it creates a fresh match) and update the two variables.
- `DISPLAY_TOKEN_REQUIRED` on the relay doesn't matter here: the checks always send the display token.
