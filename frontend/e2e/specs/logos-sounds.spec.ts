import path from "path";
import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, getOrgId, openDisplay, waitForLive } from "../helpers/match";
import { grantPlan } from "../helpers/billing";

// This suite reuses one signed-up org for the whole worker's lifetime (see
// fixtures/auth.ts), so tests here can't assume they run before/after any
// other file's billing-state changes to that same org — every test that
// depends on a specific plan sets it explicitly rather than relying on the
// org's default state.

// Logos/sounds upload routes are gated behind requirePlan(["pro", "venue"])
// on the relay (relay/src/server.ts) — grantPlan bypasses Stripe entirely to
// put the worker's org on Pro for these tests (see helpers/billing.ts's own
// doc comment for why that's fine here but not in billing.spec.ts). The
// control page's client-side entitlement state is only read at load, so a
// reload after granting the plan is required for the tabs to stop 403ing.
const TEST_LOGO = path.join(__dirname, "../fixtures/files/test-logo.png");
const TEST_SOUND = path.join(__dirname, "../fixtures/files/test-sound.wav");

test.describe("logos & sounds", () => {
  test("uploads and removes a team logo, and it renders on the display page", async ({ page }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Logos", homeName: "Home FC", visitorName: "Visitor FC" });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    await grantPlan(orgId, "pro");
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });

    await page.getByRole("tab", { name: "logos" }).click();
    await page.getByTestId("logo-home-input").setInputFiles(TEST_LOGO);
    await expect(page.getByTestId("logo-home-preview")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("logo-home-error")).toHaveCount(0);

    // /display/basic doesn't render team logos at all (see
    // frontend/app/display/basic/page.tsx) — scorebug and fullscreen do.
    const displayPage = await page.context().newPage();
    await openDisplay(displayPage, { kind: "scorebug", org: orgId, matchId });
    await expect(displayPage.locator('img[alt="Home FC"]')).toBeVisible({ timeout: 10_000 });
    await displayPage.close();

    await page.getByTestId("logo-home-remove-button").click();
    await expect(page.getByTestId("logo-home-preview")).toHaveCount(0, { timeout: 10_000 });

    await endMatch(page);
  });

  test("uploads a competition logo via the Theme tab", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Comp Logo", homeName: "Home FC", visitorName: "Visitor FC" });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    await grantPlan(orgId, "pro");
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });

    await page.getByRole("tab", { name: "theme" }).click();
    await page.getByTestId("competition-logo-input").setInputFiles(TEST_LOGO);
    await expect(page.getByTestId("competition-logo-preview")).toBeVisible({ timeout: 10_000 });

    await endMatch(page);
  });

  test("adds and removes a sound cue", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Sounds", homeName: "Home FC", visitorName: "Visitor FC" });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    await grantPlan(orgId, "pro");
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });

    await page.getByRole("tab", { name: "audio" }).click();
    await page.locator('input[placeholder="e.g. 2-minute warning"]').fill("2-minute warning");
    await page.locator('input[placeholder="02:00"]').fill("02:00");
    await page.getByTestId("sound-file-input").setInputFiles(TEST_SOUND);
    await page.getByTestId("sound-add-cue").click();

    await expect(page.getByText("2-minute warning")).toBeVisible({ timeout: 10_000 });
    const cueRow = page.locator('[data-testid^="sound-cue-"]').first();
    await cueRow.locator('[data-testid^="sound-cue-remove-"]').click();
    await expect(page.getByText("2-minute warning")).toHaveCount(0);

    await endMatch(page);
  });

  test.describe("plan gating", () => {
    test("Free plan gets an upgrade prompt for logos/theme and a watermark on displays", async ({ page, context }) => {
      const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Logo Gating", homeName: "Home FC", visitorName: "Visitor FC" });
      await waitForLive(page);
      const orgId = await getOrgId(page);

      // Force Free regardless of what earlier tests (in this file or
      // elsewhere) did to this worker's shared org's plan.
      await grantPlan(orgId, "free");
      await page.reload();
      await expect(page.getByTestId("connection-status")).toHaveText("LIVE", { timeout: 15_000 });

      // SA-32: the tabs' controls are replaced by an upgrade prompt.
      await page.getByRole("tab", { name: "logos" }).click();
      await expect(page.getByTestId("branding-upgrade-prompt")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("logo-home-input")).toHaveCount(0);
      await page.getByRole("tab", { name: "theme" }).click();
      await expect(page.getByTestId("branding-upgrade-prompt")).toBeVisible();

      // SA-31: Free-tier displays carry the watermark.
      const displayPage = await context.newPage();
      await openDisplay(displayPage, { kind: "basic", org: orgId, matchId });
      await expect(displayPage.getByTestId("powered-by-watermark")).toBeVisible({ timeout: 10_000 });
      await displayPage.close();

      await endMatch(page);
    });
  });
});
