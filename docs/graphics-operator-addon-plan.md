# Graphics Operator add-on: scene-driven live graphics product

## Context

Today operators get two options for live graphics: fixed pre-built display URLs
(`/display/basic`, `advanced`, `fullscreen`, `overlay`, `scorebug`) that are static once
dropped into OBS/vMix as a Browser Source, or a raw data feed (REST/`matchStateChange`) for
teams running their own graphics engine (Singular.live, VIZRT) who build everything themselves.
There's no middle tier: a dedicated graphics operator cutting live between scenes (lower-third,
player stat card, headshot+bio) on **one stable Browser Source URL**, independent of the scoring
operator.

The user wants this built as a separate add-on product, including player graphics/photos,
individual player stats, and ingestion of external provider data feeds (Champion Data first — a
sample netball payload was reviewed: `sport.netballMatchStats.team[2]`, ~50 flat stat fields per
team plus a `player[]` array with ~50 fields each). Critically, **payload shape differs by sport
and by provider, and will change over time** — the ingestion design must let a field-mapping
tweak or a new sport/provider ship without a bridge code redeploy, not just work for netball.

Decisions confirmed with the user: scoring operators (`control` role) may also drive graphics
scenes solo (dual-hat small venues), a `Player` roster record is org-wide (not per-sport), and
`/display/graphics` should soft-degrade for orgs without the entitlement — showing the ScoreHub
logo with an upgrade prompt rather than blank or a hard 403.

## Design

Two independent axes, built and phased separately since ingestion is a prerequisite but not the
whole feature:

**Axis A — flexible ingestion.** Raw provider JSON is captured and forwarded almost verbatim,
normalized as late as possible via a declarative field-mapping config, not new rigid per-sport
TypeScript interfaces. This mirrors the precedent already in the codebase: `relay/src/schemas.ts`
already has a generic `sportState: z.object({}).passthrough().optional()` used by
indoor_cricket/softball, and `bridge/src/protocol/championDataParser.ts` already zod-validates
Champion Data payloads for score-critical fields. Graphics-only stats deliberately trade
compile-time field safety for zero-redeploy iteration — a bad/missing mapping entry degrades one
stat tile to blank, it never breaks scoring or crashes a scene.

- Bridge: new `bridge/src/graphics/` module, parallel to `bridge/src/protocol/`.
  `feedMappings/championdata.netball.json` — declarative `{ path, statKey, scope: "team"|"player" }`
  entries. `feedTransform.ts` — `applyFeedMapping(raw, mapping)` walks paths generically, no
  per-sport code, never throws (missing path → undefined). Wired into
  `bridge/src/sources/championDataJsonSource.ts` as a **non-blocking side channel** alongside the
  existing `parseChampionDataJson` call — a graphics-mapping failure must never affect score state.
- `MatchState` gains `graphicsFeed?: { provider, sport, version, stats: Record<string, number|string>, capturedAt }`
  — flattened `{statKey: value}` pairs, not raw passthrough, so the frontend never re-walks paths.
  Reserve `raw` only if a debug view is wanted later.
- Relay: `graphicsFeed` added to `relay/src/schemas.ts` as passthrough, same trust boundary as
  today's `sportState`/`netballStats` (zod object shape + size guard).
- Mapping files ship as bridge-local JSON for Phase A/B (fast to ship, no new infra); the
  transform function is deliberately structured so swapping the mapping source to DB-stored
  per-Org config later (edit without redeploy) is a one-line change, not a rewrite — revisit in
  Phase D if file-based iteration proves too slow in practice.

**Axis B — graphics operator product**, reusing existing patterns throughout:

- **Scene selection**: symmetric to `stateUpdate`/`matchStateChange`. New socket events
  `setScene` (client → relay) / `graphicsSceneUpdate` (relay → room), validated by a new
  `graphicsSceneSchema` in `relay/src/schemas.ts`, using the existing `roomFor(orgId, matchId)`
  room/Redis-adapter fanout in `relay/src/server.ts` — no new infra. Scene state persists
  per-room (mirroring `persistence.ts`) and replays on client reconnect, same as `MatchState`
  does today.
- **Auth persona**: extend `ScopedTokenType` (`packages/db/prisma/schema.prisma`) from
  `BRIDGE | CONTROL` to `BRIDGE | CONTROL | GRAPHICS`. New `relay/src/auth.ts` function
  `verifyGraphicsSecret`, structurally identical to `verifyActionSecret`/`verifyControlSecret`,
  plus a new `/api/graphics-token` route (parallel to `/api/control-token`) for interactive
  sessions. No new `Role` enum value — follows the `BRIDGE` precedent (device/token-based access,
  not NextAuth membership-based). Per the user's confirmation, `setScene` accepts **both**
  `control`- and `graphics`-scoped connections; every scoring-mutation handler
  (`stateUpdate`, `manualUpdate`, `resetMatch`, `cricket:*`, `undo`, `takeControl`) must explicitly
  reject `graphics`-scoped sockets — this is a security boundary, needs a dedicated relay test.
- **Display route**: new `frontend/app/display/graphics/page.tsx`, sibling to the existing
  `display/*` routes, transparent background (reuse the `overlay`/`scorebug` CSS convention).
  Subscribes to `graphicsSceneUpdate` via a new `useGraphicsScene` hook (modeled directly on
  `frontend/app/hooks/useMatchState.ts`) and to `matchStateChange`/`graphicsFeed` via the existing
  `useMatchState`. Renders via a small scene-type registry
  (`frontend/app/display/graphics/scenes/sceneRegistry.ts`) — one component per scene type
  (`LowerThird.tsx`, `PlayerStatCard.tsx`, `PlayerHeadshotBio.tsx`), mirroring the config-table
  pattern `sport-templates.ts` already established for `displayStats`/`controlPanel` overrides.
  Per-sport stat labels/formatting live in a new sibling `frontend/app/sport-graphics-templates.ts`
  rather than bloating `SportTemplate` itself, since most sports won't use it yet.
  When the org lacks the entitlement or has no scene configured, render the ScoreHub logo with an
  "upgrade your plan" message instead of the scene tree.
- **Graphics operator control UI**: new standalone route `frontend/app/control/graphics/page.tsx`,
  modeled on `frontend/app/control/mobile/page.tsx`'s pattern (independent route/session, not a
  tab bolted onto the existing `control/page.tsx`) — a simple scene picker for Phase A.
- **Player roster**: new Prisma model `Player` (org-scoped, matching the `Membership`/`ScopedToken`
  convention), with `externalId`/`provider` fields to join a live `graphicsFeed` player stat to a
  photo/bio. Photo uploads reuse the **existing** R2/local-disk upload pattern already used for
  team logos and sounds (`relay/src/storage.ts`'s `r2Enabled`/`putObject`, wired through
  `relay/src/server.ts`'s multer routes) — no new storage infra needed. Admin CRUD at
  `frontend/app/control/roster/page.tsx`.
- **Entitlement**: new `Account.addOns String[] @default([])` column (simplest model for a single
  add-on today) and `requireAddOn(name)` middleware in `relay/src/entitlements.ts`, structurally
  parallel to the existing `requirePlan(allowed)`. Applied at socket-auth time (fail fast) to the
  graphics token endpoint and `setScene` handler, and to roster CRUD routes. No-op in legacy
  single-tenant mode, matching all existing entitlement checks.

## Phasing

1. **Phase A — MVP, ingestion pattern proven end-to-end (netball/Champion Data only).**
   Bridge mapping module + one mapping file; `graphicsFeed` on `MatchState`/schemas; `setScene`/
   `graphicsSceneUpdate` + persistence; `GRAPHICS` ScopedTokenType + `verifyGraphicsSecret` +
   `/api/graphics-token` with the socket role-gate as a hard requirement; `Account.addOns` +
   `requireAddOn`; `/display/graphics` with 2–3 scene types (lower-third, basic stat card),
   including the soft-degrade "upgrade your plan" state; minimal `control/graphics` scene picker.
   Exit criteria: an operator selects "netball player stat card for player X" and it updates live
   on the OBS source within ~1s, gated behind the add-on.
2. **Phase B — generalize.** Add mapping files for 2–3 more already-supported sports using the
   *same* `applyFeedMapping`, proving the no-redeploy thesis. Build out
   `sport-graphics-templates.ts` and remaining scene types. Add scene preview thumbnails to the
   operator UI before it ships broadly — important gap if skipped.
3. **Phase C — player photo/bio management.** `Player` model + migration (org-wide, per user's
   confirmation), roster admin UI, photo upload wired to existing R2 storage, `externalId`
   auto-matching with manual-override UI for unmatched players.
4. **Phase D — additional providers.** New mapping file(s) + a new bridge source module only if
   transport differs (e.g. websocket push vs. polling — reuse `championDataJsonSource.ts`'s
   polling shell where the transport matches). Revisit file-based vs. DB-stored mapping config
   here if iteration speed demands it.

Explicitly deferred (flag if the user wants any pulled forward): Stripe/billing wiring for
purchasing the add-on itself; multi-operator scene-control concurrency (Phase A uses last-write-
wins, same as `matchStateChange` today); a visual/customizable scene template editor (scenes are
hardcoded React components per type through Phase B).

### Phase C0 — graphics scene look-and-feel (theme wiring)

Added per user request before roster/photo work: give graphics scenes the same per-match branding
control operators already have for other display outputs, rather than inventing a new theming
system. `MatchState.displayTheme` (`packages/types/index.ts` — `primaryColor`, `backgroundColor`,
`font`, `textScale`, `competitionLogoUrl`) is already editable per-match via
`frontend/app/control/components/ThemeTab.tsx` and applied via `frontend/app/hooks/useDisplayTheme.ts`
on every other `/display/*` route, but `/display/graphics` and its scenes didn't call it, and
separately hardcoded team colors instead of reading `state.home.color`/`state.visitor.color` the
way `ScoreTab.tsx` already does.

- `display/graphics/page.tsx` now calls `useDisplayTheme(state.displayTheme)`, applying
  `--accent`/`--accent-dim`/`fontFamily`/`--text-scale` to the root wrapper. The theme's
  `backgroundColor` is deliberately *not* applied to the wrapper background (must stay transparent
  for OBS/vMix compositing) — instead it's converted to an rgba tint via a local `hexToRgba()` and
  exposed as the `--graphics-card-bg` CSS var, which `LowerThird`/`PlayerStatCard`/
  `PlayerHeadshotBio` now use for their card backgrounds (`var(--graphics-card-bg, rgba(7,9,15,0.92))`
  — falls back to the old hardcoded value if rendered outside that wrapper, e.g. in tests).
- The three graphics scenes now read `state.home.color`/`state.visitor.color` with the existing
  CSS-var fallback, matching `ScoreTab.tsx`. Known pre-existing gap, not fixed here to avoid
  unrelated scope creep: `display/basic`/`advanced`/`overlay` and the non-graphics
  `*DisplayStats` components still hardcode the CSS vars instead of reading team colors.
- No new admin UI needed — `ThemeTab.tsx`'s existing color pickers/font field/competition-logo
  uploader become the graphics customization UI for free, since it's the same `displayTheme` field.

## Critical files

- `relay/src/server.ts` — `setScene`/`graphicsSceneUpdate` handling, room-scoped scene state,
  role-gate rejecting `graphics`-scoped sockets from scoring-mutation handlers.
- `relay/src/auth.ts` — `verifyGraphicsSecret`, parallel to `verifyControlSecret`/`verifyActionSecret`.
- `relay/src/schemas.ts` — `graphicsFeed` + `graphicsSceneSchema`, following existing `.passthrough()` precedent.
- `relay/src/entitlements.ts` — `requireAddOn`, parallel to `requirePlan`.
- `bridge/src/sources/championDataJsonSource.ts`, new `bridge/src/graphics/feedTransform.ts` +
  `feedMappings/*.json` — the config-driven ingestion layer, this plan's core technical bet.
- `packages/db/prisma/schema.prisma` — `ScopedTokenType` extension (`GRAPHICS`), new `Player`
  model, `Account.addOns` column.
- `frontend/app/sport-templates.ts` (precedent) and new `frontend/app/sport-graphics-templates.ts`.
- `frontend/app/control/mobile/page.tsx` and `frontend/app/hooks/useMatchState.ts` — direct
  structural templates for the new `control/graphics` route and `useGraphicsScene` hook.
- `relay/src/storage.ts` — reused as-is for player photo uploads.

## Verification

- `npm test --workspace=relay` — new tests for `requireAddOn`, `verifyGraphicsSecret`, and the
  critical security assertion that a `graphics`-scoped socket emitting `manualUpdate`/`stateUpdate`
  is rejected.
- `npm test --workspace=bridge` — `applyFeedMapping` unit tests (missing path → undefined, doesn't
  throw on malformed mapping or payload).
- `npm test --workspace=frontend` (vitest) — `sceneRegistry` resolves known scene types,
  `sport-graphics-templates.ts` coverage test mirroring the existing `sportTemplates.test.ts` pattern.
- `npx tsc --noEmit` / `eslint` per package (CI parity).
- Manual, Phase A exit criteria: `docker compose up --build`, run a bridge instance against a
  Champion Data netball fixture (or mocked payload), open `/control/graphics` and
  `/display/graphics` as separate browser sessions, confirm scene switches propagate live, confirm
  an org without the add-on sees the upgrade-prompt degrade state instead of scenes.

## Status

- [x] Plan drafted and approved (2026-07-04)
- [x] Phase A — MVP (2026-07-04): bridge feed-mapping ingestion (netball/championdata), relay
      graphicsFeed passthrough, GRAPHICS ScopedTokenType + verifyGraphicsSecret + /api/graphics-token,
      Account.addOns + requireAddOn, setScene/graphicsSceneUpdate with role-gate security tests,
      /display/graphics (lowerThird + playerStatCard scenes, upgrade-prompt soft-degrade), minimal
      /control/graphics scene picker. Not yet done: manual docker-compose end-to-end smoke test
      (automated tsc/eslint/jest/vitest all pass; browser verification still pending).
- [x] Phase B — generalize (2026-07-04): best-guess championdata.basketball.json and
      championdata.cricket.json feed mappings (no real sample payload for these two providers yet,
      unlike netball — field paths follow Champion Data's usual conventions but are unverified;
      correcting them once a real feed is seen is a JSON edit, proving the no-redeploy thesis).
      frontend/app/sport-graphics-templates.ts adds per-sport stat labels + display ordering for
      netball/basketball/cricket, wired into LowerThird and PlayerStatCard (falls back to a generic
      camelCase-split label for sports with no template). Added the playerHeadshotBio scene
      (initials-avatar placeholder — real photos are Phase C) and scene preview thumbnails in
      control/graphics. All new/updated tests passing (bridge 57/57, frontend tsc/eslint clean,
      155 relevant vitest tests).
- [x] Phase C0 — graphics scene look-and-feel (2026-07-04): wired `useDisplayTheme` into
      `display/graphics/page.tsx` (accent/font/text-scale, plus a `--graphics-card-bg` tint derived
      from the theme's backgroundColor without breaking OBS transparency), and switched
      `LowerThird`/`PlayerStatCard`/`PlayerHeadshotBio` to read `state.home.color`/
      `state.visitor.color` instead of hardcoded CSS vars. Also fixed a pre-existing `tsc` break in
      `SoftballTab.tsx` (missing `sendScoreAdjust` prop destructure) found while verifying this
      branch's build is clean. New `graphicsSceneTheme.test.tsx` (4 tests); full frontend suite
      192/192 passing, tsc/eslint clean.
- [x] Phase C — player photo/bio management (2026-07-04): `Player` CRUD routes
      (`frontend/app/api/orgs/[orgId]/players[/[playerId]]`, gated by ADMIN/MANAGER/OPERATOR + the
      graphics-operator add-on, mirroring the invitations/graphics-token route patterns); relay
      `POST/DELETE /api/player-photo/:playerId` (dual R2/disk storage, `requireAddOn` instead of
      `requirePlan`, copies the logo-upload multer pattern) and a public
      `GET /api/graphics/roster?org=` read route (same trust level as `/api/graphics/entitlement`);
      new standalone `/control/roster` page (create/edit/delete players, photo upload, plus a "Live
      match — unmatched players" section for manual-only linking of a live feed player's
      provider/externalId to a roster entry, no fuzzy matching); `useRoster`/`findRosterMatch` hook
      wired into `PlayerStatCard`/`PlayerHeadshotBio` (shows roster photo/displayName/bio when
      matched, falls back to the existing initials-avatar/feed-name rendering when not — additive,
      non-breaking). No new migration needed (the `Player` model already existed from Phase A).
      New tests: `graphics-roster.test.ts` (relay, 3 tests) and `useRoster.test.ts` (frontend, 3
      tests). Full suites passing: relay 144/144, frontend 195/195, both tsc-clean.
- [x] Phase D — additional providers (2026-07-04): built the multi-provider registry/transport
      split as testing infra rather than a real vendor integration (no second real provider was
      named yet — user confirmed to prove the pattern with a mock/synthetic provider). Added
      `feedMappings/mockpush.netball.json`, a deliberately differently-shaped payload (nested
      `match.teams`/`roster`/`stats`, vs. Champion Data's flat fields) registered under provider id
      `mockpush`, proving `findFeedMapping` keys on provider+sport rather than sport alone. Added
      `bridge/src/sources/mockPushSource.ts` — an event-driven push source (any `EventEmitter`,
      modeling a websocket "message" feed) rather than HTTP polling
      (`championDataJsonSource.ts`'s "Path 1"), reusing `applyFeedMapping`/`buildGraphicsFeed`
      unchanged and never touching score state (graphics-feed-only, no score parser of its own).
      Deliberately **not** wired into `BridgeController`'s operator-facing `SourceType` — it's a
      test/dev harness proving the registry design, not a shippable source, so it stays out of the
      production source picker. New `mockPushSource.test.ts` (4 tests: builds a feed from a pushed
      payload, teardown stops listening, never throws on malformed input, no-ops for a sport with
      no mockpush mapping). Full bridge suite 61/61 passing, tsc clean. Revisit file-based vs.
      DB-stored mapping config (noted as a possible future step above) once/if a second *real*
      provider is named.
- [x] Output options (2026-10-19): per-output overrides in `DisplayTheme.outputs` (font, background
      colour/image for fullscreen/basic/advanced, and score/clock/name/period size multipliers applied
      as `--*-scale` CSS vars by `useDisplayTheme(theme, output)`); the relay holds `outputs` unchanged
      for orgs without the add-on (`withoutUnentitledBranding`) and gates `?output=` background
      uploads. `?key=green|blue` on overlay/scorebug/graphics swaps transparency for chroma
      `#00B140`/`#0047BB` (`useChromaKey`, checked against `/api/graphics/entitlement`). "Data out":
      `GET /api/graphics/data?token=&format=json|xml|csv` (`relay/src/graphicsDataFeed.ts`) — a flat
      record for vMix/OBS data sources, authenticated by a new read-only `GRAPHICS_DATA` ScopedToken
      (query-string friendly, so deliberately not GRAPHICS or DATA_FEED). The clock is sent as both
      `clockDisplay` (computed per request) and `clockSeconds`/`clockAnchorMs`/`clockDirection`; with no
      relay anchor (bridge-driven) the relay uses when it last received state, extrapolating at most 2s.
