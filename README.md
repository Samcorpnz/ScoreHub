# ScoreHub System

Live sport scoring display. Reads Saturn/Vega serial console, broadcasts via cloud relay to any browser.

## Architecture

```
Saturn Console (RS422/serial)
      ↓
  bridge/   ← runs on the operator laptop at the venue
      ↓  Socket.io push (authenticated)
  relay/    ← cloud server (Fly.io, multi-region)
      ↓  Socket.io broadcast
  frontend/ ← Next.js app (Vercel)
      ├── /display/basic     — clean scoreboard
      ├── /display/advanced  — with player roster
      ├── /display/overlay   — transparent (OBS/vMix)
      └── /control           — operator panel
```

## Quick Start (local development)

### Option A — Docker Compose (recommended for a first run)
Spins up Postgres, Redis, the relay, and the frontend together — no Neon/Upstash
account needed locally.
```bash
cp .env.example .env   # set AUTH_SECRET (openssl rand -hex 32)
docker compose up --build
```
Then open http://localhost:3000, sign up for an account, and continue to the
control panel. The bridge still runs natively (see step 2 below) — serial
ports don't pass cleanly into Docker on Windows/Mac.

### Option B — run each piece natively
#### 1. Relay
```bash
cd relay
npm install
cp .env.example .env   # set DATABASE_URL, AUTH_SECRET, ALLOWED_ORIGINS
npm run dev            # starts on :4000
```

#### 2. Bridge (venue laptop)
```bash
cd bridge
npm install
cp .env.example .env
# edit .env: set RELAY_URL and either SERIAL_PORT or a ChampionData source
npm run dev
```

#### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # set DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL
npm run dev            # starts on :3000
```

Then open http://localhost:3000

---

## Production Deployment

### Relay → Fly.io (recommended)
1. `fly apps create <name>` (or reuse the existing `scorehub-relay` app)
2. Deploy from repo root: `fly deploy` (uses `fly.toml`, builds `relay/Dockerfile`)
3. Set secrets: `fly secrets set DATABASE_URL=... AUTH_SECRET=... ALLOWED_ORIGINS=... REDIS_URL=...` (`ALLOWED_ORIGINS` is the frontend's deployed origin — production is `https://app.scorehub.co.nz`; `scorehub.co.nz` apex is reserved for the marketing site, not this app. `AUTH_SECRET` must match the frontend's value exactly — see Phase 2/SA-20 in the multi-tenant auth model. Add R2_* vars for logo/sound uploads, see `relay/.env.example`.)
4. Scale into additional regions for failover: `fly scale count 2 --region iad`
5. Note the public anycast URL (e.g. `https://scorehub-relay.fly.dev`). Production also answers on
   `https://relay.scorehub.co.nz` (`fly certs add` plus DNS-only `A`/`AAAA` records in Cloudflare) —
   that is the address the frontend, Bridge app and Stream Deck plugin use.

### Frontend → Vercel
1. Push to GitHub
2. Import the `frontend/` folder in Vercel
3. Set env vars: `NEXT_PUBLIC_RELAY_URL`, `DATABASE_URL`, `AUTH_SECRET` (must match the relay's), `NEXTAUTH_URL` — see `frontend/.env.example` for the full list (Stripe, Resend, Sentry are optional)

### Bridge → venue laptop
The bridge ships a built-in admin UI (port 4002 by default) for picking a COM
port and monitoring connection status — see `bridge/src/ui`. For manual setup:
1. `npm run build` then `npm start` (or just `npm run dev`)
2. Set `RELAY_URL` in `.env` to the Fly.io URL
3. Generate a bridge token from the control panel's Settings tab (Bridge Devices card) and set it as `BRIDGE_SECRET`/the bridge's token field
4. Set `SERIAL_PORT` to your COM port (Windows: `COM3`, Mac/Linux: `/dev/tty.usbserial-XXXX`)

### Human-gated production deploys (SA-12)
`.github/workflows/deploy.yml` runs the full test suite, then deploys relay (Fly.io) and frontend (Vercel) — but only after a manual approval, via a `production` GitHub Environment with required reviewers. This is the only deploy path that should be live; Fly.io's and Vercel's own GitHub-push auto-deploy must be turned off in their dashboards, or every push deploys immediately regardless of this gate. One-time setup (repo admin, in GitHub/Fly.io/Vercel dashboards — not done as part of this change):
1. Repo Settings → Environments → create `production`, add required reviewers.
2. Add repo secrets: `FLY_API_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
3. Fly.io only deploys via this CI workflow — there's no separate "deploy on push" dashboard toggle to disable.
4. In Vercel's project settings, disable the Git integration's auto-deploy (or set the production branch to something other than `main` so pushes don't auto-trigger).

---

## Runbooks

- [Database backups](docs/runbooks/database-backups.md) — current RPO/RTO on free-tier Neon/Upstash, and the daily DIY backup job (SA-57). Paid multi-AZ upgrade deliberately deferred until paying customers exist.
- [Manual control failover](docs/runbooks/manual-control-failover.md) — switching a live match to manual scoring when the bridge/hardware fails (SA-59). Also published to [Confluence](https://samcorp.atlassian.net/wiki/spaces/SA/pages/6651906/Runbook+Manual+Control+Failover+Bridge+Hardware+Failure).

## Serial Protocol

**Saturn/Vega (Swiss Timing)** — spec 0100.073.02 v2.0
- 9600 baud, 8N1, RS422
- Messages framed with STX/ETX + XOR checksum
- Cycle: D (match state) + F1/F2 (player shirts) + F3/F4 (points) + T (time/config) + N (names)

**Score Pilot** — add a new parser in `bridge/src/protocol/` and register it in `bridge/src/index.ts`

---

## Display URLs

| URL | Use |
|-----|-----|
| `/display/basic` | Venue screens, projectors |
| `/display/advanced` | Broadcast monitor, full stats |
| `/display/overlay` | OBS Browser Source (1920×120) |
| `/control` | Operator — manual overrides |

## OBS Setup (overlay)
1. Add a **Browser Source** in OBS
2. URL: `https://your-frontend.vercel.app/display/overlay`
3. Width: 1920, Height: 120
4. Check "Shutdown source when not visible"
5. The background is transparent — no chroma key needed
