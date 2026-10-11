# Competitive plan: event log, results out, competitions, integrations

## Context

A review of the NZ market (October 2026) put the alternatives to ScoreHub into four groups:

- **Sport-mandated platforms** — Sporty (NZ Rugby, Netball NZ, Touch NZ, NZRL, NZ Football),
  PlayHQ (NZ Cricket, Hockey NZ), GameDay and Glory League (basketball). They own the official
  result because a national body chose them. None of them drives a venue screen or a stream
  overlay, except Glory League, which ships its own courtside scoreboard.
- **Browser scoreboard and overlay tools** — Keep The Score, ScoreLayer, free OBS plugins. They do
  what ScoreHub does, from about US$10 a month, with no console bridging, no multi-court
  tooling and no NZ focus.
- **Automated broadcast graphics and cameras** — LIGR, Pixellot, Spiideo, Veo, Sportway. Spiideo
  already accepts scoring data over an API from timekeeping systems.
- **Scoreboard hardware** — NZ and Australian LED board makers, each with their own software.

The conclusion: ScoreHub should not chase club administration (members, registrations, payments,
websites). It should be the display layer that works with or without those platforms, and close
the gaps that make an organiser reach for a second tool.

What the codebase lacks today, checked against `main` at `7ec9af0`:

- No record of what happened in a match. `MatchState` is a snapshot; the only history is the
  in-memory undo stack in `relay/src/server.ts`, which is lost on restart and never exposed.
- No way to get a result out except polling `GET /api/data-feed/state` or reading the dashboard.
- `Match.competition` is a free-text string. There are no standings, grades or public pages.
- The control panel needs a live connection to score.

## Strategy

1. Be the score source other systems plug into: competition platforms want the final result,
   camera platforms want timestamped events, our own graphics want both.
2. Cover the tournament organiser who is not on a mandated platform, so they need one tool.
3. Sell against cheap overlay tools on what they lack: console bridging, multi-court control,
   NZ sports.

Out of scope: member databases, registrations, payments, website building, hosting or storing
video, and reading scoreboards from video.

## Phases

Each phase is its own branch and PR. Later phases depend on Phase 1.

### Phase 1 — Match event log and results out

The foundation. Three audiences use it: competition platforms, camera platforms, our graphics.

**Event log.** Every state change in the relay already funnels through `setState()` (plus the
undo handler, which writes directly). Events are derived there by diffing the previous and next
`MatchState`, not by instrumenting each socket handler, so a new handler or sport cannot forget
to log.

- `packages/types`: `MatchEvent` — `seq`, `type`, `at` (ISO timestamp), `clockSeconds`, `period`,
  both scores after the event, and for score events `side` and `delta`.
- Types: `score`, `period`, `clock_start`, `clock_stop`, `break_start`, `break_end`, `reset`.
  An undo shows up as a `score` event with a negative delta; consumers treat it as a correction.
- `relay/src/matchEvents.ts`: pure `diffMatchEvents(prev, next, at)`. Clock ticks produce nothing.
- Storage: a `MatchEvent` table keyed by `(matchId, seq)`, written in batches on the same debounce
  as match state. In legacy mode (no `DATABASE_URL`) events are held in memory only.
- Read: `GET /api/data-feed/events?matchId=&since=` behind the Data Feed add-on, the same auth as
  `/api/data-feed/state`. There is no live socket emit of events yet; nothing consumes one, and
  outbound webhooks below are the push channel.

**Results export.** `GET /api/orgs/[orgId]/matches/export` returns ended matches as CSV (sport,
competition, teams, scores, scheduled and ended times), filtered like the dashboard's History
tab, with a download button there. Pro and Venue, matching fixture upload.

**Outbound webhooks.** The inbound `/action/*` scoring routes used to be called "webhooks"; they
are now the **Control API**, which frees the name for this. Per-org endpoints that receive `match.ended` and, optionally, live
`match.event` payloads, signed with HMAC. Needs: an endpoint model and management UI, a delivery
outbox so the frontend's end-match route and the relay can both enqueue, retries, and blocking
of private network addresses. Data Feed add-on.

Build order inside the phase: event log, results export, then webhooks.

Status: event log and results export are built on `feat/match-event-log`. Webhooks are not
started. Known limit of the log: for cricket, softball and indoor cricket it follows team totals
only; ball-by-ball detail stays in `sportState`.

### Phase 2 — Positioning and pricing

- Marketing and help: a "use ScoreHub alongside your competition platform" page; comparison copy
  against overlay tools; a Data Feed page rewritten around events and webhooks.
- Pricing: test a cheaper club or season tier. `$89`/mo sits against US$10 overlay tools and a
  free club platform. **Needs an owner decision before any Stripe or code change.**

### Phase 3 — Competitions, standings and public pages

- Promote `Match.competition` to a `Competition` model with grades and a points scheme
  (win/draw/loss/bonus), backfilled from the existing strings.
- Standings computed from ended matches; recomputed on end and reopen.
- Public, no-login competition page: live scores, ladder, upcoming fixtures. Embeddable.
- Public match page with an optional stream embed (YouTube or Facebook URL on the match).
- Fixture CSV upload accepts a grade and round.

### Phase 4 — Integrations

In order of reach. Each needs the other party's cooperation, so the conversations start now.

- Competition platforms: Sporty (SKED), PlayHQ, GameDay. Import fixtures, push results back.
  Fallback until an API is agreed: fixture CSV import in each platform's export format.
- Camera platforms: one proof point first. Spiideo has a documented scoring API; Glory League
  has the NZ footprint but ships its own scoreboard, so may see us as a rival.
- Open questions: which camera systems are installed in NZ venues and in what numbers; which
  have open APIs.

### Phase 5 — Offline-tolerant scoring

Queue control-panel actions when the socket drops and replay them on reconnect. The hard part
is the relay's single-controller lock and in-memory state: replay needs rules for what happens
if another scorer took control, or the match was ended, while the device was offline. Delta
events (`adjustScore`) replay safely; absolute `manualUpdate` patches do not.

### Phase 6 — Team sheets and player events

Extend the event log with player-attributed events (scorer, card, substitution) and a per-match
team sheet drawn from the existing `Player` roster. Scope is what our graphics and the results
export use. Eligibility and stand-down tracking stay with the governing-body platforms.

### Phase 7 — Hardware partners and phone-as-camera (exploratory)

- Approach LED scoreboard suppliers about bundling ScoreHub as the software that drives their
  boards. Commercial, not code.
- Spike: stream from a phone with the scorebug burned in, for clubs with no OBS setup.

## Decisions needed from the owner

- Pricing: whether to add a club or season tier, and at what price.
- Whether to approach Sporty, PlayHQ, GameDay and Glory League, and on what terms.
- Whether live `match.event` webhooks belong in the Data Feed add-on or a higher tier.
