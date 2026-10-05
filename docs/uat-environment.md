# UAT environment (SA-102 follow-up)

**Decision (2026-08-14):** stand up a persistent UAT stack that mirrors
production end-to-end (relay + DB + frontend), instead of relying solely on
local `docker compose up --build` for pre-prod testing. This replaces the
"No hosted staging environment exists" statement in the root `CLAUDE.md`.

**Why branch-scoped Preview env vars instead of a real Vercel Custom
Environment:** tried on 2026-08-15 — the `sam-kerins-projects` team is on
the Hobby plan, and Vercel's Custom Environments feature (`POST
/v9/projects/{id}/custom-environments`) is Pro/Enterprise-only (`"Cannot
create more than 0 custom environments"`). Same story for Rolling
Releases/canary deploys on Production (`vercel rr configure` — `"Your
current plan does not support rolling releases"`). Revisit both if/when the
team upgrades to Pro.

## What exists

| Layer | Resource | Notes |
| --- | --- | --- |
| Frontend | Vercel `uat` git branch (Preview environment, branch-scoped env vars) | Auto-deploys on every push to `uat` via Vercel's GitHub integration — no Actions job needed. Stable branch-alias URL: `https://scoring-app-git-uat-sam-kerins-projects.vercel.app`. Also live at `app.uat.scorehub.co.nz`, gated by Cloudflare Zero Trust Access (see below) rather than open to the internet. |
| Relay | Fly.io app `scorehub-relay-uat` | Config: `fly.uat.toml` (repo root). Single region (`syd`), `min_machines_running = 0` / `auto_stop_machines = true` so it idles to zero cost between test sessions. Deploys via `.github/workflows/deploy-uat.yml` on push to `uat`, or manually: `flyctl deploy -c fly.uat.toml -a scorehub-relay-uat --remote-only` |
| Database | Neon branch `UAT` (project `ScoringApp`, id `patient-morning-97818497`) | Copy-on-write off `production`. No auto-refresh policy yet — reset with `neonctl branches reset UAT --parent` when data drifts too far from useful. |
| Redis | Upstash `ScoreHub-UAT` (pay-as-you-go, `ap-southeast-2`) | Deliberately a separate database from prod's `ScoreHub` — isolates the Socket.io cross-instance adapter and clock tick-lock so UAT traffic can't touch prod's Redis keyspace. |
| Object storage | R2 bucket `scorehub-uat`, custom domain `cdn-uat.scorehub.co.nz` | Access key scoped to this bucket only (Object Read & Write), created via the Cloudflare dashboard (not available through `wrangler`/the account API token used for other Cloudflare ops). Account ID `c0c396b5f4c3cf71c2ecb3821febaf92`. |
| Marketing site | Cloudflare Worker `scorehub-marketing-uat`, custom domain `uat.scorehub.co.nz` | Deploy: `cd marketing && npm run build && npx wrangler deploy --env uat`. Manual only, no CI job. Uses the verified `mail.scorehub.co.nz` Mailgun domain but still routes contact-form submissions to `sam@samcorp.co.nz` instead of `hello@scorehub.co.nz`, to keep UAT test submissions out of the real inbox — see the `uat` env block in `marketing/wrangler.jsonc`. |
| Help centre | Cloudflare Worker `scorehub-help-uat`, custom domain `help.uat.scorehub.co.nz` | Deploy: `cd help && npm run build && npx wrangler deploy --env uat`. Manual only, no CI job. |

UAT hostnames mirror production's structure — bare domain is marketing, `app.` is the frontend, `help.` is the help centre — just with everything nested a level under `uat.`: `uat.scorehub.co.nz` (marketing), `app.uat.scorehub.co.nz` (frontend), `help.uat.scorehub.co.nz` (help centre).

## Access control on `app.uat.scorehub.co.nz`

Unlike marketing and help (public), the frontend on UAT sits behind a **Cloudflare Zero Trust
Access** application (`samcorpltd.cloudflareaccess.com`) scoped to that hostname — visitors hit a
Cloudflare login page before ever reaching Vercel. This is why its DNS record is **Proxied**
(orange cloud) in Cloudflare, unlike every other `*.scorehub.co.nz` record (all DNS-only, grey
cloud) — Access only intercepts traffic that's proxied through Cloudflare's edge.

**Do not switch that record to DNS-only** to "fix" the domain-misconfigured warning in
`vercel domains inspect app.uat.scorehub.co.nz` — that warning is cosmetic in this setup (Vercel
can't complete its own DNS-based verification while Cloudflare proxies the record) and the site
works fine regardless; unproxying it would remove the Access gate instead. Vercel's own
project-level deployment protection (Vercel Authentication / SSO) is left enabled as normal —
Cloudflare Access already gates this hostname before requests reach Vercel, so it doesn't add a
second login for testers, and turning it off project-wide would also strip protection from every
ad-hoc PR preview deployment (Vercel's Hobby plan has no per-branch protection setting — see the
Custom Environments note above). Confirmed 2026-08-22: `app.uat.scorehub.co.nz` **is** correctly
assigned to the `uat` git branch (not falling back to Production) — verified via the Vercel API,
which showed the branch's latest deployment's `alias` list including this hostname.

**Two-layer protection means server-to-server callers (webhooks) need two bypasses, not one** —
learned the hard way fixing Stripe's UAT webhook (2026-08-22). Cloudflare Access and Vercel
Authentication both gate this hostname independently; a caller that can't do an interactive login
(Stripe, cron, CI) needs an exception carved out of **each** layer for the specific path it calls,
or it 403s/401s. See the Stripe entry under Known gaps for the concrete recipe.

## Secrets

`AUTH_SECRET` is a **distinct** value from production, set identically on
both the Fly app and the Vercel `uat` branch — this is what lets the
frontend's `/api/control-token` JWTs verify against the UAT relay. It must
never be reused across environments (a UAT token must not verify against
prod, or vice versa).

- Fly: `fly secrets list -a scorehub-relay-uat` (values not readable back —
  see `fly secrets set` history / your password manager if rotating)
- Vercel: `vercel env ls` — filter for `Branch uat`, or
  `vercel env pull --environment=preview --git-branch=uat`

## Known gaps / not yet done

- **CORS**: confirmed — `ALLOWED_ORIGINS` on the relay matches the actual
  Vercel branch-alias URL (`https://scoring-app-git-uat-sam-kerins-projects.vercel.app`),
  verified against a live deployment after the first `uat` push.
- **Stripe webhook — fixed 2026-08-22, see below for the working recipe.** The original
  branch-alias endpoint URL was replaced with the custom domain, and two separate protection
  layers had to be bypassed to get Stripe's server-to-server POSTs through:
  1. **Cloudflare Access**: created a second, path-scoped Access application at
     `app.uat.scorehub.co.nz/api/billing/webhook` (account `c0c396b5f4c3cf71c2ecb3821febaf92`,
     app id `1b770d26-2f5b-49c4-9b9a-b548711e123b`) with a single `bypass` policy (`everyone`).
     A more specific application path takes precedence over the broader domain-level app that
     gates the rest of the site, so only this one path is public.
  2. **Vercel Authentication**: the "custom domains are exempt from Vercel Authentication"
     behavior only applies to a **Production** domain — `app.uat.scorehub.co.nz` is a Preview
     (branch) domain, so it still sits behind the login wall. Generated a Protection Bypass for
     Automation secret (`PATCH /v1/projects/{id}/protection-bypass`, empty body — the `vercel
     api` CLI needs `--input -` piped `{}` to avoid a 415, since an empty invocation sends no
     body at all) and appended it as a query param on the endpoint URL registered in Stripe.
     **Do not** add `x-vercel-set-bypass-cookie=true` — that makes Vercel 307-redirect once to
     set a cookie, which is meant for browsers that follow redirects, not one-shot webhook
     POSTs; Stripe just sees the 307 and fails.
  3. The endpoint URL now registered in Stripe (test mode, "UAT" endpoint) is:
     `https://app.uat.scorehub.co.nz/api/billing/webhook?x-vercel-protection-bypass=<secret>`
     (secret is the sensitive `STRIPE_WEBHOOK_SECRET`-adjacent Vercel value, not committed here —
     see the project's Protection Bypass for Automation setting, or `vercel env ls` won't show it
     since it isn't a regular env var, though `isEnvVar: true` on the bypass token means it's
     also injected as `VERCEL_AUTOMATION_BYPASS_SECRET` at runtime if ever needed from code).
  4. Separately, the `uat`-branch-scoped `STRIPE_WEBHOOK_SECRET` on Vercel had never actually
     matched the endpoint's real signing secret (`whsec_...`, visible via "Reveal" in the Stripe
     dashboard) — this alone would have caused "invalid signature" errors even once the two
     protection layers were bypassed. Fixed via `vercel env add STRIPE_WEBHOOK_SECRET preview
     --git-branch uat --force --sensitive`, then a `vercel redeploy <latest-uat-deployment>
     --target preview` (env var changes need a fresh deployment to reach running functions).
  5. The unrelated `git-main`-alias webhook endpoint in Stripe (stray, not the real production
     one; it lived in the live account's test mode and its target URL returned 410) was
     deleted on 2026-10-05.
- **Mailgun**: UAT shares the generic Preview environment's Mailgun config, now on
  the verified `mail.scorehub.co.nz` domain (SA-107) — real emails send to real addresses
  on signup/invite flows tested in UAT.
- **Sentry**: `uat`-branch-scoped `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`,
  `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, and `SENTRY_ENVIRONMENT` are now set on
  Vercel (2026-08-15).
- **Generic (non-`uat`) Vercel Preview env**: checked 2026-10-05 against a PR
  preview deployment. The branch-unscoped `DATABASE_URL` points at the Neon
  `dev` branch, not production (a read-only request to the preview woke the
  `dev` compute endpoint). The branch-unscoped `NEXT_PUBLIC_RELAY_URL`,
  however, is `https://scorehub-relay.fly.dev` — the **production** relay —
  so every ad-hoc PR preview talks to the production relay. Both values are
  Sensitive in Vercel and can't be read back, so re-verify the same way if
  they're ever changed.

## Redeploying / resetting

- Redeploy relay only: `flyctl deploy -c fly.uat.toml -a scorehub-relay-uat --remote-only`
- Reset UAT data back to a copy of prod: `neonctl branches reset UAT --parent --project-id patient-morning-97818497` (or via Neon console)
- Wake a scaled-to-zero relay: any request to `https://scorehub-relay-uat.fly.dev/health` triggers `auto_start_machines`
