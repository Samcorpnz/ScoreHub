/**
 * VLC-style "update available" check (SA-112).
 *
 * Polls the GitHub Releases list for the newest published `bridge-v*` release
 * and compares it with the running version. It never downloads or installs
 * anything — the operator is pointed at downloads.scorehub.co.nz and installs
 * manually. Superseded by electron-updater once SA-92/SA-94 land.
 *
 * Automatic (scheduled) checks fail silently so nothing surfaces mid-event;
 * only a user-initiated check reports errors.
 */

export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "error";

export interface UpdateState {
  currentVersion: string;
  status: UpdateStatus;
  latestVersion: string | null;
  downloadUrl: string | null;
  checkedAt: number | null;
}

export interface UpdateCheckerOptions {
  currentVersion: string;
  platform?: NodeJS.Platform;
  repo?: string;
  tagPrefix?: string;
  checkIntervalMs?: number;
  /** Manual re-checks within this window of the last completed check reuse its result. */
  manualDebounceMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onChange?: (state: UpdateState) => void;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
}

const DEFAULT_REPO = "Samcorpnz/ScoreHub";
const DEFAULT_TAG_PREFIX = "bridge-v";
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MANUAL_DEBOUNCE_MS = 10_000;
const FETCH_TIMEOUT_MS = 10_000;
const DOWNLOADS_BASE = "https://downloads.scorehub.co.nz";

/** Parses "1.2.3" (optionally "v"-prefixed, with a -prerelease/+build suffix) into [major, minor, patch]. */
export function parseVersion(raw: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is strictly newer than `current`; unparseable input is never "newer". */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function downloadUrlForPlatform(platform: NodeJS.Platform): string {
  if (platform === "darwin") return `${DOWNLOADS_BASE}/mac`;
  if (platform === "win32") return `${DOWNLOADS_BASE}/windows`;
  // Anything else: the root path sniffs the User-Agent itself.
  return `${DOWNLOADS_BASE}/`;
}

export class UpdateChecker {
  private readonly currentVersion: string;
  private readonly platform: NodeJS.Platform;
  private readonly repo: string;
  private readonly tagPrefix: string;
  private readonly intervalMs: number;
  private readonly manualDebounceMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly onChange?: (state: UpdateState) => void;

  private state: UpdateState;
  private inFlight: Promise<UpdateState> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: UpdateCheckerOptions) {
    this.currentVersion = opts.currentVersion;
    this.platform = opts.platform ?? process.platform;
    this.repo = opts.repo ?? DEFAULT_REPO;
    this.tagPrefix = opts.tagPrefix ?? DEFAULT_TAG_PREFIX;
    this.intervalMs = opts.checkIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.manualDebounceMs = opts.manualDebounceMs ?? DEFAULT_MANUAL_DEBOUNCE_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.state = {
      currentVersion: this.currentVersion,
      status: "idle",
      latestVersion: null,
      downloadUrl: null,
      checkedAt: null,
    };
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  /** Runs one check now (without awaiting it), then repeats on the interval. */
  start(): void {
    if (this.timer) return;
    void this.check(false);
    this.timer = setInterval(() => void this.check(false), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Resolves with the post-check state. A `manual` check surfaces failures as
   * status "error" and is debounced; an automatic one swallows failures and
   * keeps whatever state it had before.
   */
  check(manual: boolean): Promise<UpdateState> {
    if (this.inFlight) return this.inFlight;

    if (
      manual &&
      this.state.checkedAt !== null &&
      this.state.status !== "error" &&
      this.now() - this.state.checkedAt < this.manualDebounceMs
    ) {
      return Promise.resolve(this.getState());
    }

    const previous = this.state;
    if (manual) this.setState({ ...previous, status: "checking" });

    this.inFlight = this.fetchLatest()
      .then((latest) => {
        this.setState(this.resultState(latest));
        return this.getState();
      })
      .catch(() => {
        if (manual) this.setState({ ...previous, status: "error" });
        else this.setState(previous);
        return this.getState();
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private resultState(latestVersion: string | null): UpdateState {
    const available = latestVersion !== null && isNewerVersion(latestVersion, this.currentVersion);
    return {
      currentVersion: this.currentVersion,
      status: available ? "available" : "up-to-date",
      latestVersion: available ? latestVersion : null,
      downloadUrl: available ? downloadUrlForPlatform(this.platform) : null,
      checkedAt: this.now(),
    };
  }

  /** Newest published bridge release's version, or null if there is none. */
  private async fetchLatest(): Promise<string | null> {
    const response = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/releases?per_page=30`, {
      headers: {
        "User-Agent": "scorehub-bridge-update-check",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub releases lookup failed: ${response.status}`);

    const releases = (await response.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) throw new Error("Unexpected GitHub response");

    // Highest version wins rather than first-listed: GitHub orders by creation
    // date, which a re-cut or backported tag can put out of version order.
    let best: string | null = null;
    for (const release of releases) {
      if (release.draft || release.prerelease || !release.tag_name.startsWith(this.tagPrefix)) continue;
      const version = release.tag_name.slice(this.tagPrefix.length);
      if (!parseVersion(version)) continue;
      if (best === null || isNewerVersion(version, best)) best = version;
    }
    return best;
  }

  private setState(next: UpdateState): void {
    this.state = next;
    this.onChange?.(this.getState());
  }
}
