import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export type BallOutcome = 0 | 1 | 2 | 3 | 4 | 6;
export type Modifier = "none" | "wide" | "noBall" | "bye" | "legBye";
export type WicketType =
  | "bowled" | "caught" | "lbw" | "run out" | "stumped"
  | "hit wicket" | "obstructed field" | "handled ball";

// The relay's freshly-created match state can occasionally still be in
// flight when /control's first render happens — landing on the generic
// fallback panel (state.sport not yet "cricket") instead of CricketTab,
// since getTemplate() falls back to the last SPORT_TEMPLATES entry for an
// unrecognised sport. Reproduced in CI (a "can create a t20 match" run
// rendered the generic Faults/±1/±2 panel instead of the cricket score
// header). waitForLive only confirms the socket + controller handshake, not
// that sport-specific fields landed, so poll for the cricket panel
// separately and reload as a last resort — same fallback waitForLive uses
// for its own controller-handshake race.
export async function waitForCricketPanel(page: Page): Promise<void> {
  const cricketScore = page.getByTestId("cricket-score");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await cricketScore.isVisible().catch(() => false)) return;
    await page.waitForTimeout(250);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });
    if (await cricketScore.isVisible({ timeout: 10_000 }).catch(() => false)) return;
  }
  throw new Error("waitForCricketPanel: CricketTab never rendered, even after retrying with reloads");
}

export async function startInnings(page: Page): Promise<void> {
  await page.getByTestId("cricket-start-innings").click();
}

export async function bowlBall(page: Page, opts: { runs: BallOutcome; modifier?: Modifier }): Promise<void> {
  if (opts.modifier && opts.modifier !== "none") {
    await page.getByTestId(`cricket-modifier-${opts.modifier}`).click();
  }
  await page.getByTestId(`cricket-runs-${opts.runs}`).click();
}

export async function takeWicket(page: Page, opts: { type: WicketType; nextBatterIndex?: number }): Promise<void> {
  await page.getByTestId("cricket-wicket-open").click();
  const typeSlug = opts.type.replace(/ /g, "_");
  await page.getByTestId(`cricket-wicket-type-${typeSlug}`).click();
  if (opts.nextBatterIndex !== undefined) {
    await page.getByTestId("cricket-next-batter-select").selectOption(String(opts.nextBatterIndex));
  }
  await page.getByTestId("cricket-wicket-confirm").click();
}

export async function completeOver(page: Page, nextBowlerIndex: number): Promise<void> {
  await page.getByTestId("cricket-bowler-select").selectOption(String(nextBowlerIndex));
  await page.getByTestId("cricket-bowler-set").click();
}

export async function startNextInnings(page: Page): Promise<void> {
  await page.getByTestId("cricket-start-next-innings").click();
}

export async function declareInnings(page: Page): Promise<void> {
  await page.getByTestId("cricket-declare").click();
}

export async function getScoreText(page: Page): Promise<string> {
  return (await page.getByTestId("cricket-score").textContent()) ?? "";
}
