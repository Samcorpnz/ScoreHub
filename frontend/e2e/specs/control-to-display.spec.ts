import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, getOrgId, openDisplay, waitForLive } from "../helpers/match";
import { clickScoreDecrement, clickScoreIncrement, endPeriod, reopenPeriod, resetMatch, toggleClock, undo } from "../helpers/score";

// The critical path SA-30's acceptance criteria call out: an operator's
// action in /control must reach viewers on /display via the relay. Other
// specs assert on the control UI or read relay state over REST; these assert
// on what a *viewer* actually sees. Tagged @critical so CI runs them as the
// gating E2E set (see .github/workflows/test.yml) — keep this file small,
// deterministic and fast; anything flaky-prone belongs in a non-critical spec.
//
// Netball is used throughout: generic ScoreTab (no bespoke panel), a 15:00
// countdown clock, and 1/2-point increments.
test.describe("control -> relay -> display", { tag: "@critical" }, () => {
  async function setup(page: Page, name: string) {
    const { matchId } = await createMatch(page, {
      sport: "netball", matchName: `E2E ${name}`, homeName: "Sharks", visitorName: "Eagles",
    });
    await waitForLive(page);
    const org = await getOrgId(page);
    const display = await page.context().newPage();
    await openDisplay(display, { kind: "basic", org, matchId });
    await expect(display.getByText("Sharks").first()).toBeVisible({ timeout: 10_000 });
    return { matchId, org, display };
  }

  const displayScore = (display: Page, side: "home" | "visitor") => display.getByTestId(`display-score-${side}`);
  const displayClock = (display: Page) => display.getByTestId("display-clock");
  const clockToSeconds = (text: string | null) => {
    const [m, s] = (text ?? "0:0").split(":").map(Number);
    return m * 60 + s;
  };

  test("score changes appear on the display for the right team", async ({ page }) => {
    const { display } = await setup(page, "Score");

    await expect(displayScore(display, "home")).toHaveText("0");
    await expect(displayScore(display, "visitor")).toHaveText("0");

    await clickScoreIncrement(page, "home", 2);
    await expect(displayScore(display, "home")).toHaveText("2", { timeout: 5_000 });
    await expect(displayScore(display, "visitor")).toHaveText("0");

    await clickScoreIncrement(page, "visitor", 1);
    await clickScoreIncrement(page, "home", 1);
    await expect(displayScore(display, "home")).toHaveText("3", { timeout: 5_000 });
    await expect(displayScore(display, "visitor")).toHaveText("1");

    await display.close();
    await endMatch(page);
  });

  test("rapid scoring never drops a click on the display", async ({ page }) => {
    const { display } = await setup(page, "Rapid");

    for (let i = 0; i < 10; i++) await clickScoreIncrement(page, "home", 1);
    await expect(displayScore(display, "home")).toHaveText("10", { timeout: 5_000 });

    await display.close();
    await endMatch(page);
  });

  test("decrement and undo are reflected, and a score never goes below zero", async ({ page }) => {
    const { display } = await setup(page, "Undo");

    await clickScoreIncrement(page, "home", 2);
    await expect(displayScore(display, "home")).toHaveText("2", { timeout: 5_000 });

    await clickScoreDecrement(page, "home", 1);
    await expect(displayScore(display, "home")).toHaveText("1", { timeout: 5_000 });

    await undo(page);
    await expect(displayScore(display, "home")).toHaveText("2", { timeout: 5_000 });

    await clickScoreDecrement(page, "visitor", 1);
    await expect(displayScore(display, "visitor")).toHaveText("0");

    await display.close();
    await endMatch(page);
  });

  test("clock: start counts down on the display, stop freezes it", async ({ page }) => {
    const { display } = await setup(page, "Clock");

    await expect(displayClock(display)).toHaveText("15:00");
    await expect(display.getByTestId("display-running-indicator")).toHaveText(/PAUSED/);

    await toggleClock(page);
    await expect(display.getByTestId("display-running-indicator")).toHaveText(/LIVE/, { timeout: 5_000 });
    await expect.poll(async () => clockToSeconds(await displayClock(display).textContent()), { timeout: 8_000 })
      .toBeLessThan(15 * 60);

    await toggleClock(page);
    await expect(display.getByTestId("display-running-indicator")).toHaveText(/PAUSED/, { timeout: 5_000 });
    const frozen = await displayClock(display).textContent();
    await page.waitForTimeout(2_500);
    expect(await displayClock(display).textContent()).toBe(frozen);

    // Control and display agree on the stopped time.
    expect(await page.getByTestId("score-clock").textContent()).toBe(frozen);

    await display.close();
    await endMatch(page);
  });

  test("ending a period shows the break on the display and keeps the score", async ({ page }) => {
    const { display } = await setup(page, "Period");

    await expect(display.getByTestId("display-period")).toHaveText("1");
    await clickScoreIncrement(page, "home", 2);
    await expect(displayScore(display, "home")).toHaveText("2", { timeout: 5_000 });

    await endPeriod(page);
    await expect(display.getByTestId("display-period")).toHaveText(/BREAK/i, { timeout: 5_000 });
    await expect(displayScore(display, "home")).toHaveText("2");

    await reopenPeriod(page);
    await expect(display.getByTestId("display-period")).toHaveText("2", { timeout: 5_000 });

    await display.close();
    await endMatch(page);
  });

  test("reset clears scores on the display", async ({ page }) => {
    const { display } = await setup(page, "Reset");

    await clickScoreIncrement(page, "home", 2);
    await clickScoreIncrement(page, "visitor", 2);
    await expect(displayScore(display, "visitor")).toHaveText("2", { timeout: 5_000 });

    await resetMatch(page);
    await expect(displayScore(display, "home")).toHaveText("0", { timeout: 5_000 });
    await expect(displayScore(display, "visitor")).toHaveText("0");

    await display.close();
    await endMatch(page);
  });

  test("multiple displays stay in sync, and a display opened late gets current state", async ({ page }) => {
    const { matchId, org, display } = await setup(page, "MultiView");

    const scorebug = await page.context().newPage();
    await openDisplay(scorebug, { kind: "scorebug", org, matchId });
    await expect(scorebug.getByText("Sharks")).toBeVisible({ timeout: 10_000 });

    await clickScoreIncrement(page, "home", 2);
    await clickScoreIncrement(page, "visitor", 1);
    await expect(displayScore(display, "home")).toHaveText("2", { timeout: 5_000 });
    await expect(displayScore(scorebug, "home")).toHaveText("2", { timeout: 5_000 });
    await expect(displayScore(scorebug, "visitor")).toHaveText("1");

    // A viewer joining mid-match sees the live score immediately, not zeros.
    const late = await page.context().newPage();
    await openDisplay(late, { kind: "basic", org, matchId });
    await expect(displayScore(late, "home")).toHaveText("2", { timeout: 10_000 });
    await expect(displayScore(late, "visitor")).toHaveText("1");

    // A display that reloads recovers state too (relay restore path).
    await display.reload();
    await expect(displayScore(display, "home")).toHaveText("2", { timeout: 10_000 });

    await late.close();
    await scorebug.close();
    await display.close();
    await endMatch(page);
  });
});
