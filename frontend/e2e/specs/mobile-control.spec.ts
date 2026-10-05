import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, getOrgId, openControl, openDisplay, waitForLive } from "../helpers/match";
import { resetMatch } from "../helpers/score";

// SA-144: the mobile panel used to ignore the match id and score the org's
// default room, so nothing it did reached the match's displays. These assert
// on what a viewer sees, like control-to-display.spec.ts.
test.describe("mobile control panel", () => {
  test("opens for the same match and its scoring reaches that match's display", async ({ page }) => {
    const { matchId } = await createMatch(page, {
      sport: "netball", matchName: "E2E Mobile", homeName: "Sharks", visitorName: "Eagles",
    });
    await waitForLive(page);
    const org = await getOrgId(page);
    const display = await page.context().newPage();
    await openDisplay(display, { kind: "basic", org, matchId });
    await expect(display.getByText("Sharks").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: /Mobile/ }).click();
    await expect(page).toHaveURL(new RegExp(`/control/mobile\\?matchId=${matchId}`));
    // Same handoff race waitForLive() works around on /control: the full
    // panel's socket may not have released control yet, so take it if asked.
    const status = page.getByTestId("mobile-controller-status");
    await expect(status).toBeVisible({ timeout: 15_000 });
    if (await page.getByTestId("take-control").isVisible().catch(() => false)) {
      await page.getByTestId("take-control").click();
    }
    await expect(status).toContainText("IN CONTROL", { timeout: 15_000 });
    await page.waitForTimeout(500);
    await expect(page.getByText("Sharks")).toBeVisible();

    // First "+1" is the home column, second is the visitor column
    await page.getByText("+1", { exact: true }).first().click();
    await page.getByText("+1", { exact: true }).first().click();
    await page.getByText("+1", { exact: true }).nth(1).click();
    await expect(display.getByTestId("display-score-home")).toHaveText("2", { timeout: 5_000 });
    await expect(display.getByTestId("display-score-visitor")).toHaveText("1");

    await page.getByText(/Undo/).click();
    await expect(display.getByTestId("display-score-visitor")).toHaveText("0", { timeout: 5_000 });

    await display.close();
    await openControl(page, matchId);
    await waitForLive(page);
    await endMatch(page);
  });
});

// SA-143: Reset Match used to replace the whole state with the netball default.
test.describe("reset match", () => {
  test("keeps the sport and its score buttons", async ({ page }) => {
    await createMatch(page, {
      sport: "basketball", matchName: "E2E Reset Keeps Sport", homeName: "Hawks", visitorName: "Owls",
    });
    await waitForLive(page);
    await page.getByTestId("score-home-inc-3").click();
    await expect(page.getByTestId("score-home-value")).toHaveText("3", { timeout: 5_000 });

    await resetMatch(page);
    await expect(page.getByTestId("score-home-value")).toHaveText("0", { timeout: 5_000 });
    // Basketball's 3-point button only exists while the sport is still basketball
    await expect(page.getByTestId("score-home-inc-3")).toBeVisible();
    await expect(page.getByText("Hawks").first()).toBeVisible();

    await endMatch(page);
  });
});
