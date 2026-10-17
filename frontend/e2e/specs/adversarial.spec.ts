import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, getOrgId, waitForLive } from "../helpers/match";
import { clickScoreIncrement, getScore, undo } from "../helpers/score";

test.describe("adversarial: try to break it", () => {
  test("rapid double-click on a score button applies both increments exactly", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Adversarial Double-click" });
    await waitForLive(page);

    // Score adjustments are sent as deltas (adjustScore) and applied by the
    // relay against its own authoritative state, not computed client-side
    // from a possibly-stale copy — so two truly concurrent clicks both land.
    await Promise.all([
      page.getByTestId("score-home-inc-1").click(),
      page.getByTestId("score-home-inc-1").click(),
    ]);
    await page.waitForTimeout(500);
    const finalScore = await getScore(page, "home");
    expect(finalScore).toBe(2);

    await endMatch(page);
  });

  test("undo spam never drives the score negative and throws no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(String(err)));

    await createMatch(page, { sport: "netball", matchName: "E2E Adversarial Undo Spam" });
    await waitForLive(page);

    for (let i = 0; i < 20; i++) await undo(page);
    await expect.poll(() => getScore(page, "home")).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);

    await endMatch(page);
  });

  test("missing matchId/org on a display page shows an empty state, not a crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(String(err)));
    await page.goto("/display/basic");
    await page.waitForTimeout(1000);
    expect(errors, "unauthenticated display page with no params should not throw").toEqual([]);
  });

  test("wrong org id on a display page does not leak the match's live score", async ({ page }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Wrong Org Param", homeName: "SecretHome", visitorName: "SecretVisitor" });
    await waitForLive(page);
    const realOrg = await getOrgId(page);

    const displayPage = await page.context().newPage();
    await displayPage.goto(`/display/basic?org=${realOrg}-wrong&matchId=${matchId}`);
    await displayPage.waitForTimeout(2_000);
    await expect(displayPage.getByText("SecretHome").first()).not.toBeVisible();
    await displayPage.close();

    await endMatch(page);
  });

  test("XSS payload in a team name renders as literal text, not executed", async ({ page }) => {
    let dialogFired = false;
    const xssDialogHandler = async (dialog: import("@playwright/test").Dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    };
    page.on("dialog", xssDialogHandler);

    await createMatch(page, {
      sport: "netball",
      matchName: "E2E XSS",
      homeName: "<script>window.__xssFired=true</script>",
      visitorName: "<img src=x onerror=window.__xssFired2=true>",
    });
    await waitForLive(page);

    const fired = await page.evaluate(() => (window as unknown as { __xssFired?: boolean }).__xssFired);
    const fired2 = await page.evaluate(() => (window as unknown as { __xssFired2?: boolean }).__xssFired2);
    expect(fired).toBeFalsy();
    expect(fired2).toBeFalsy();
    expect(dialogFired, "an XSS payload should never trigger a dialog").toBe(false);
    await expect(page.getByText("<script>window.__xssFired=true</script>", { exact: false }).first()).toBeVisible();

    // Detach before endMatch's own confirm-dialog handling — otherwise this
    // persistent listener races endMatch's page.once("dialog", ...) for the
    // legitimate "End this match?" confirm and both try to handle it.
    page.off("dialog", xssDialogHandler);
    await endMatch(page);
  });

  test("invalid MM:SS clock input does not corrupt the clock into NaN", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Bad Clock Input" });
    await waitForLive(page);

    await page.getByTestId("score-clock").waitFor();
    await page.locator('input[placeholder="MM:SS"]').fill("ab:cd");
    await page.locator('input[placeholder="MM:SS"]').press("Enter");
    await expect(page.getByTestId("score-clock")).not.toContainText("NaN");

    await endMatch(page);
  });

  test("two tabs on the same match: second tab shows the conflict banner and Take Control works", async ({ page, context }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Two-tab Conflict" });
    await waitForLive(page);

    const secondTab = await context.newPage();
    await secondTab.goto(`/control/${matchId}`);
    await expect(secondTab.getByTestId("controller-conflict-banner")).toBeVisible({ timeout: 10_000 });
    await secondTab.getByTestId("take-control").click();
    await expect(secondTab.getByTestId("controller-conflict-banner")).not.toBeVisible();

    await endMatch(secondTab);
  });

  test("reloading /control mid-match resyncs state instead of resetting to defaults", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Reload Resync" });
    await waitForLive(page);
    await clickScoreIncrement(page, "home", 1);
    await expect.poll(() => getScore(page, "home")).toBe(1);

    await page.reload();
    await waitForLive(page);
    await expect.poll(() => getScore(page, "home")).toBe(1);

    await endMatch(page);
  });

  test("direct navigation to a nonexistent matchId does not hang or crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(String(err)));
    await page.goto("/control/00000000-0000-0000-0000-000000000000");
    await expect(page.getByTestId("connection-status")).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test("keyboard-shortcut spam applies every press exactly, none lost", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Keyboard Spam" });
    await waitForLive(page);

    // ScoreTab's keydown handler (frontend/app/control/components/ScoreTab.tsx)
    // sends each press as an adjustScore delta, applied by the relay against
    // its own authoritative state rather than a client-computed absolute
    // value — so rapid-fire presses can't coalesce into fewer net increments.
    const presses = 10;
    for (let i = 0; i < presses; i++) await page.keyboard.press("1");
    await page.waitForTimeout(1_000);
    const finalScore = await getScore(page, "home");
    expect(finalScore).toBe(presses);

    await endMatch(page);
  });

  test("scoring after End Match is rejected, not silently applied", async ({ page }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Score After End" });
    await waitForLive(page);
    await endMatch(page);

    await page.goto(`/control/${matchId}`);
    const scoreButton = page.getByTestId("score-home-inc-1");
    if (await scoreButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await scoreButton.click();
      // If the control UI is still reachable for an ended match, the score
      // must not have actually moved server-side — reload and check it's
      // still 0, since the relay (not the client) is the source of truth.
      await page.reload();
      await expect.poll(() => getScore(page, "home")).toBe(0);
    }
  });
});
