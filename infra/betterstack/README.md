# Better Stack (SA-48/109/110/111)

Terraform for the Better Stack uptime monitors — relay `/health`, relay `/health/deep`
(internal-only, SA-109), frontend `/api/health`, a synthetic Sentry error-rate check
(SA-48), and the marketing/help/downloads Workers (SA-111) — plus the public status page.
Not part of the npm workspace or the `deploy.yml` pipeline — it has its own workflow,
`.github/workflows/infra-betterstack.yml`.

## How changes ship

- **Pull request** touching `infra/betterstack/**`: the workflow runs `terraform fmt -check`,
  `validate` and `plan`. Read the plan in the job log. (PRs from forks get no secrets, so
  they stop at `validate`.)
- **Push to `main`**: plan again, then — only if the plan has changes — `terraform apply`
  behind the same `production` required-reviewer gate as the app deploys. The apply job
  re-plans rather than reusing a saved plan (a saved plan would hold `deep_health_secret` in
  plain text), so check the plan job's log before approving.
- **Manual run** (`workflow_dispatch` on `main`): same as a push; use it to correct drift.

State lives in HCP Terraform (app.terraform.io), workspace `scorehub-betterstack`, which
also provides state locking. It contains `deep_health_secret` in plain text, so keep access
to that workspace tight. The workspace's execution mode must be **Local** (workspace ->
Settings -> General): HCP only stores the state, and Terraform itself runs in GitHub Actions
or on your machine. In the default Remote mode the run would happen on HCP's runners, which
don't have the Better Stack token or `deep_health_secret`.

What the workflow needs in the repo's Actions settings:

| Name | Kind | What it is |
| --- | --- | --- |
| `TF_CLOUD_ORGANIZATION` | variable | The HCP Terraform organization name |
| `TF_API_TOKEN` | secret | HCP Terraform API token (a team token, or a user token on the free tier) |
| `BETTERUPTIME_API_TOKEN` | secret | Better Stack dashboard -> Settings -> API tokens |
| `DEEP_HEALTH_SECRET` | secret | Must match relay's `DEEP_HEALTH_SECRET` (SA-109) |

## Running it locally

For a plan against real state, or an emergency apply:

```bash
cd infra/betterstack
terraform login                      # once; stores an HCP token in ~/.terraform.d
export TF_CLOUD_ORGANIZATION=...
export BETTERUPTIME_API_TOKEN=...
export TF_VAR_deep_health_secret=...
terraform init
terraform plan
```

## Steps Terraform doesn't cover

Better Stack's provider doesn't expose these as resources — do them once in the dashboard
after `apply`:

1. **Sentry -> status page alerting** — Better Stack's *entire* "Importing data" section
   (both the one-click native Sentry connector AND generic Incoming Webhooks/Email
   integrations) sits behind a paid Responder license ($9-34/mo per person) on the plan this
   account is on; confirmed 2026-08-24 by hitting the billing wall on Incoming Webhooks too,
   not just the Sentry app specifically. There is no free way to push Sentry alerts into
   Better Stack's Incident Management.

   Free workaround instead: `betteruptime_monitor.sentry_error_rate` (this config) polls
   `frontend/app/api/health/sentry-error-rate`, a route that queries Sentry's own API for
   recent error volume and returns 503 when it's over threshold. Ordinary uptime monitors
   *are* free, so a Sentry-side spike still shows up on the status page — just via polling
   (one `check_frequency_seconds` cycle of latency) instead of an instant push. Requires a
   `SENTRY_ERROR_MONITOR_TOKEN` env var on the frontend deployment (org:read + project:read +
   event:read scope — see `frontend/.env.example`); the route fails open (reports ok) if the
   token is unset or the Sentry query fails, so a misconfiguration here never manufactures a
   false incident.
2. **On-call (SA-110)** — confirmed 2026-08-24: assigning an on-call user to a schedule
   (`betteruptime_on_call_calendar.on_call_users`) and creating an escalation policy are both
   dashboard-only — the Terraform provider exposes `on_call_users` as computed/read-only and
   has no escalation-policy resource at all. Do once in the dashboard:
   - **On-call** -> the existing "Primary on-call schedule" -> assign the team member(s) who
     should receive incidents.
   - **Escalation policies** -> create one (e.g. "Primary", immediate email + push — matches
     the `email = true` / `push = true` already set on every monitor in this config) -> note
     its ID.
   - Set that ID as `policy_id` on each `betteruptime_monitor` resource in `main.tf` once
     created, so escalation is explicit rather than relying on default team-wide broadcast
     (harmless today with one team member, but won't scale silently if the team grows).
   - **Verify, don't just configure**: trigger a test incident (Better Stack's dashboard has a
     "Send test alert" action per monitor) and confirm it actually lands as push/email within
     the SLA (SA-110's acceptance criteria is 5 minutes) before calling this done.
   - No PagerDuty — ticket explicitly defers that until the on-call rotation grows beyond one
     person.

## Later phases

- **Custom status domain** (`status.scorehub.co.nz`, SA-111) — still blocked by the same
  paid-plan wall as item 1 above; not implemented. Re-confirm cost if/when the Better Stack
  plan is upgraded.
- **Private uat status page** (SA-111) — scoped out (2026-08-24): the frontend uat hostname
  (`app.uat.scorehub.co.nz`) sits behind a two-layer block (Cloudflare Access + Vercel
  deployment protection — see `docs/uat-environment.md`), so a plain monitor would just show
  perpetually down without the same bypass dance documented there for the Stripe webhook fix.
  Revisit if uat monitoring becomes worth that setup cost.
