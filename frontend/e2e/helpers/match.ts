import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { SportType } from "../../app/types";

export interface CreateMatchOptions {
  sport: SportType;
  matchConfig?: Record<string, string>;
  matchName?: string;
  homeName?: string;
  visitorName?: string;
  squads?: { home: string[]; visitor: string[] };
}

export async function createMatch(page: Page, opts: CreateMatchOptions): Promise<{ matchId: string }> {
  await page.goto("/setup");
  await page.getByTestId(`sport-tile-${opts.sport}`).click();

  for (const [key, value] of Object.entries(opts.matchConfig ?? {})) {
    await page.getByTestId(`match-config-${key}-${value}`).click();
  }

  await page.getByTestId("setup-match-name").fill(opts.matchName ?? `E2E ${opts.sport} match`);
  await page.getByTestId("setup-home-name").fill(opts.homeName ?? "Home Team");
  await page.getByTestId("setup-visitor-name").fill(opts.visitorName ?? "Visitor Team");
  await page.getByTestId("setup-submit").click();

  // Free tier allows one concurrent live match per org (relay/src/entitlements.ts).
  // If a previous test in this worker's org failed before reaching endMatch(),
  // every subsequent createMatch would otherwise hang on waitForURL below with
  // no clear signal why — surface it immediately instead.
  const upgradeRequired = page.getByText(/Free plan allows one live match/);
  if (await upgradeRequired.isVisible({ timeout: 2_000 }).catch(() => false)) {
    throw new Error(
      "createMatch: blocked by the free-tier one-concurrent-live-match gate — " +
      "a previous test on this worker likely left a match unended. Check for a failed test earlier in this worker's run."
    );
  }

  if (opts.sport === "cricket") {
    const home = opts.squads?.home ?? ["Player A1", "Player A2"];
    const visitor = opts.squads?.visitor ?? ["Player B1", "Player B2"];
    for (let i = 0; i < home.length; i++) {
      await page.getByTestId(`squad-home-player-${i}`).fill(home[i]);
    }
    for (let i = 0; i < visitor.length; i++) {
      await page.getByTestId(`squad-visitor-player-${i}`).fill(visitor[i]);
    }
    await page.getByTestId("squad-submit").click();
  }

  await page.waitForURL(/\/control\?matchId=/);
  const url = new URL(page.url());
  const matchId = url.searchParams.get("matchId");
  if (!matchId) throw new Error(`createMatch: no matchId in URL after submit (${page.url()})`);
  return { matchId };
}

export async function openControl(page: Page, matchId: string): Promise<void> {
  await page.goto(`/control?matchId=${matchId}`);
}

export type DisplayKind = "basic" | "advanced" | "overlay" | "scorebug" | "fullscreen" | "graphics";

export async function openDisplay(page: Page, opts: {
  kind: DisplayKind;
  org: string;
  matchId?: string;
  position?: string;
  size?: string;
}): Promise<void> {
  const params = new URLSearchParams({ org: opts.org });
  if (opts.matchId) params.set("matchId", opts.matchId);
  if (opts.position) params.set("position", opts.position);
  if (opts.size) params.set("size", opts.size);
  await page.goto(`/display/${opts.kind}?${params.toString()}`);
}

export async function waitForLive(page: Page): Promise<void> {
  await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });
  // The /setup page's own socket doesn't always release the controller
  // token before /control's new socket connects and requests it, landing
  // the operator in "VIEWING ONLY" on a match they just created — reproduced
  // live and here, and it can recur more than once in the first couple of
  // seconds as the old socket's disconnect and the new one's takeControl
  // race each other. Real operators click through it; tests do the same
  // until "IN CONTROL" sticks, rather than assuming one click settles it.
  const conflictBanner = page.getByTestId("controller-conflict-banner");
  // A brief settle delay after "IN CONTROL" first renders: the very first
  // scoring action right after gaining control can be silently dropped —
  // reproduced here (score-home-inc-1 clicked immediately after "IN
  // CONTROL" appears sometimes never reaches the relay). Client state
  // (stateRef.current) needs a moment to catch up with the just-completed
  // controller handshake before it's safe to start pushing updates.
  const pollForControl = async (budgetMs: number): Promise<boolean> => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (await page.getByText("● IN CONTROL").isVisible().catch(() => false)) {
        await page.waitForTimeout(500);
        return true;
      }
      if (await conflictBanner.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.getByTestId("take-control").click().catch(() => {});
      }
      await page.waitForTimeout(300);
    }
    return false;
  };

  if (await pollForControl(15_000)) return;

  // Occasionally the controller handshake gets stuck with neither
  // "IN CONTROL" nor a conflict banner rendered — the socket connected
  // ("LIVE" shows) but never received controllerGranted/controllerConflict.
  // A real operator's next move is to refresh; do the same as a last resort,
  // retrying a few times rather than failing on one unlucky reload — this
  // gets slower to resolve later in a long sequential run (more matches
  // created/ended in the same org puts more load on the relay's debounced
  // persistence writes), so budget generously rather than tuning to the
  // fastest observed case.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });
    if (await pollForControl(10_000)) return;
  }
  throw new Error("waitForLive: never reached IN CONTROL, even after retrying with reloads");
}

export async function endMatch(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "settings" }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByTestId("end-match").click();
  await page.waitForURL("**/dashboard");
}

// The org id isn't in the /control URL, and the Outputs tab no longer prints
// its display links (they're only handed over via Copy URL / Pop Out,
// SA-159) — so read it from the session, the same place the Outputs tab gets
// it. Display pages need it as a query param since they connect
// unauthenticated (see useMatchState.ts).
export async function getOrgId(page: Page): Promise<string> {
  const res = await page.request.get("/api/auth/session");
  const session = await res.json();
  const orgId = session?.user?.activeOrgId;
  if (!orgId) throw new Error(`getOrgId: no activeOrgId in session (status ${res.status()})`);
  return orgId;
}
