import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, getOrgId, waitForLive } from "../helpers/match";
import { grantPlan, fillEmbeddedCheckout } from "../helpers/billing";

// Requires a `stripe listen --forward-to http://localhost:3000/api/billing/webhook`
// process running against the Stripe *test-mode* account (see docker-compose.yml's
// STRIPE_* env vars and CLAUDE.md's Billing section) for the duration of this
// file — checkout.session.completed has to actually reach
// frontend/app/api/billing/webhook/route.ts for Account.plan to flip.
// Without it, every test here times out waiting for "Finishing up your
// upgrade…" to clear. See .github/workflows/test.yml's e2e job for how the
// CLI is started/torn down in CI.
//
// Serial, and each test builds on the previous one's real Stripe state (one
// real subscription created in the first test, reused by the add-on/cancel/
// portal tests below) rather than each performing its own checkout — running
// four real Stripe Elements checkouts per file would be needlessly slow and
// flaky for state that doesn't need re-creating.
test.describe.configure({ mode: "serial" });

// Skip (don't fail) when the Stripe test-mode secrets aren't configured —
// CI resolves missing STRIPE_TEST_* secrets to empty strings and skips the
// `stripe listen` step, so checkout can never complete. Every non-billing
// spec is designed to run without Stripe (see test.yml's e2e job env notes).
test.skip(!process.env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY not set — Stripe checkout cannot run");

test.describe("billing", () => {
  let orgId: string;

  test("upgrade to Pro (monthly) via embedded checkout", async ({ page }) => {
    // Billing tests don't need a live match — this one dates from when the
    // Outputs tab's display links were the only way to learn the worker's
    // orgId (getOrgId now reads the session instead).
    await createMatch(page, { sport: "netball", matchName: "E2E Billing Setup", homeName: "Home", visitorName: "Visitor" });
    await waitForLive(page);
    orgId = await getOrgId(page);
    await endMatch(page);

    // Force a clean starting point regardless of what an earlier file did to
    // this worker's shared org (see fixtures/auth.ts).
    await grantPlan(orgId, "free");

    await page.goto("/account");
    await page.getByRole("button", { name: "Upgrade to Pro" }).click();
    await fillEmbeddedCheckout(page);

    await expect(page.getByText("Finishing up your upgrade…")).toBeVisible({ timeout: 15_000 });
    // Generous budget: the UI's own waitForPlanChange polls for up to ~12s,
    // plus however long the Stripe CLI takes to forward the webhook.
    await expect(page.getByText("Pro plan")).toBeVisible({ timeout: 60_000 });
  });

  test("add the Graphics Operator add-on on top of Pro", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByText("Pro plan")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Add Graphics" }).click();
    await fillEmbeddedCheckout(page);

    await expect(page.getByRole("button", { name: "Cancel add-on" })).toBeVisible({ timeout: 60_000 });
  });

  test("downgrading lets the current period run out rather than revoking immediately", async ({ page }) => {
    await page.goto("/account");
    await page.getByRole("button", { name: "Downgrade to Free" }).click();
    await expect(page.getByText(/Cancels on/)).toBeVisible({ timeout: 10_000 });

    // Resume so later tests in this worker (or a later run reusing this same
    // Stripe test-mode subscription) aren't left mid-cancellation.
    await page.getByRole("button", { name: "Resume subscription" }).click();
    await expect(page.getByText(/Renews/)).toBeVisible({ timeout: 10_000 });
  });

  test("billing portal redirects to Stripe's hosted portal", async ({ page }) => {
    await page.goto("/account");
    await page.getByRole("button", { name: "Manage billing" }).click();
    await page.waitForURL(/billing\.stripe\.com/, { timeout: 15_000 });
    expect(page.url()).toContain("billing.stripe.com");
  });
});
