# ScoreHub Bridge

Reads a venue's Saturn/Vega console (or a ChampionData feed) and pushes match state to the
ScoreHub relay. See the root [CLAUDE.md](../CLAUDE.md) for how this fits into the wider system.

Most operators run the packaged desktop app (Electron) rather than this package directly — see
[Download for Mac](https://downloads.scorehub.co.nz/mac) / [Download for Windows](https://downloads.scorehub.co.nz/windows),
or the [help centre](https://help.scorehub.co.nz/connecting-the-bridge).

## Development

```bash
npm run dev          # headless, ts-node-dev — admin UI at http://localhost:4002
npm run electron:dev # same server, wrapped in the Electron shell (tray icon, native window)
npm test
```

## Desktop app (Electron)

`src/electron/main.ts` wraps the existing admin UI (`src/ui/server.ts`, unchanged) in a
`BrowserWindow`, with a tray icon so the bridge keeps relaying after the window is closed, and a
"Launch at login" toggle. Packaged config (`bridge-config.json`) is stored under Electron's
`userData` path instead of `process.cwd()` (see `BRIDGE_CONFIG_DIR` in `src/controller.ts`).

Build installers locally:

```bash
npm run dist:mac   # → release/*.dmg  (must run on macOS)
npm run dist:win   # → release/*.exe  (must run on Windows, or via CI)
```

Installers are **unsigned** — installing triggers a Gatekeeper/SmartScreen warning that's safe to
click through. Code signing is a separate follow-up (SA-91 explicitly excludes it).

## Cutting a release

1. Bump `version` in `package.json` if relevant (electron-builder uses it for the installer
   filename/metadata).
2. Tag and push: `git tag bridge-v1.2.0 && git push origin bridge-v1.2.0`.
3. `.github/workflows/bridge-release.yml` builds the `.dmg` (macOS runner) and `.exe` (Windows
   runner) in parallel and publishes both as assets on a GitHub Release named after the tag.
4. `downloads.scorehub.co.nz` (see `downloads/` at the repo root) resolves `/mac` and `/windows`
   to the latest matching release automatically — no separate publish step needed there.

Installers are distributed as public GitHub Release assets, not R2/S3 — the repo is public, so
release assets are already public URLs, and `electron-updater` (SA-92, not yet implemented) will
consume the same GitHub release feed natively. See the SA-88 epic for the full rationale.

### In-app update notice (SA-112)

The Electron app checks the GitHub Releases list for the newest published `bridge-v*` release on
launch and every 6 hours, and compares it to its own version. If a newer one exists, the tray menu
shows "Update available — Download" and the status page shows a dismissible banner, both linking to
`downloads.scorehub.co.nz`. The tray menu and status page also have a manual "Check for updates"
action. Nothing is downloaded or installed automatically, and scheduled checks fail silently.
Logic lives in `src/updateChecker.ts`; SA-92 (electron-updater) will replace it.
