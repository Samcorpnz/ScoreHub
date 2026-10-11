import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, getOrgId, waitForLive } from "../helpers/match";
import { clickScoreIncrement, endPeriod, getScore, toggleClock } from "../helpers/score";
import { getMatchState } from "../helpers/relay";

// Netball has no bespoke CustomPanel (unlike cricket/softball) — it renders
// through the fully generic ScoreTab, same as basketball. Its rich
// NetballDisplayStats (GS/GA/WA/C/WD/GD/GK, shooting%, feeds, intercepts,
// penalties — see frontend/app/display/components/NetballDisplayStats.tsx)
// is populated only by an external bridge/provider feed (state.netballStats),
// never entered through operator UI, so there's nothing for a browser-driven
// test to click there — this spec covers only the template-driven behavior
// that's actually operator-facing: the 2-point increment, quarters not
// resetting score, the countdown clock, and "no possession" as the default.
test.describe("netball", () => {
  test("has a 2-point increment in addition to the default 1-point", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Netball", homeName: "Silver Ferns", visitorName: "Diamonds" });
    await waitForLive(page);

    // netball's scoreIncrements is [1, 2] — most generic-panel sports only
    // have [1], so this is the one distinguishing scoring behavior worth a
    // dedicated assertion (basketball's own [1,2,3] is already covered by
    // its own spec).
    await expect(page.getByTestId("score-home-inc-1")).toBeVisible();
    await expect(page.getByTestId("score-home-inc-2")).toBeVisible();
    await expect(page.getByTestId("score-home-inc-3")).toHaveCount(0);

    await clickScoreIncrement(page, "home", 2);
    await expect.poll(() => getScore(page, "home")).toBe(2);

    await endMatch(page);
  });

  test("score persists across a quarter end (no resetScoreOnPeriod)", async ({ page }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Netball Persist", homeName: "Silver Ferns", visitorName: "Diamonds" });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    await clickScoreIncrement(page, "home", 2);
    await clickScoreIncrement(page, "home", 1);
    await expect.poll(() => getScore(page, "home")).toBe(3);

    await endPeriod(page);
    // Unlike volleyball/tennis (resetScoreOnPeriod: true), netball's score
    // carries over between quarters. Checked via MatchState rather than the
    // "QTR 2" text, which doesn't actually appear right after END QTR — the
    // control UI shows "QTR BREAK" until REOPEN is pressed, even though
    // state.period has already advanced underneath it.
    await expect.poll(() => getScore(page, "home")).toBe(3);
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).period).toBe("2");

    await endMatch(page);
  });

  test("reaches quarter 4 after three period-ends", async ({ page }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Netball Quarters", homeName: "Silver Ferns", visitorName: "Diamonds" });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    // state.period advances immediately on END QTR even though the visible
    // label shows "QTR BREAK" (not "QTR N") until REOPEN is pressed — see
    // ScoreTab.tsx's periodBreak handling — so this checks MatchState
    // directly rather than DOM text.
    expect((await getMatchState(page.request, orgId, matchId)).period).toBe("1");
    await endPeriod(page);
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).period).toBe("2");
    await endPeriod(page);
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).period).toBe("3");
    await endPeriod(page);
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).period).toBe("4");

    await endMatch(page);
  });

  test("clock counts down from 15:00 when started", async ({ page }) => {
    await createMatch(page, { sport: "netball", matchName: "E2E Netball Clock", homeName: "Silver Ferns", visitorName: "Diamonds" });
    await waitForLive(page);

    await expect(page.getByTestId("score-clock")).toHaveText("15:00");
    await toggleClock(page);
    await expect.poll(async () => (await page.getByTestId("score-clock").textContent()) !== "15:00", {
      timeout: 5_000,
    }).toBe(true);

    // countDown: true means the displayed time decreases, not increases.
    const afterStart = await page.getByTestId("score-clock").textContent();
    expect(afterStart).not.toBeNull();
    const [min, sec] = afterStart!.split(":").map(Number);
    expect(min * 60 + sec).toBeLessThan(15 * 60);

    await endMatch(page);
  });

  test("extra time: ending the fourth quarter puts the length set for the match on the clock", async ({ page }) => {
    const { matchId } = await createMatch(page, { sport: "netball", matchName: "E2E Netball ET", homeName: "Silver Ferns", visitorName: "Diamonds" });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    // Competitions vary the length, so it's set per match (default 7:00).
    await page.getByTestId("score-extra-time").fill("5:00");
    await page.getByTestId("score-extra-time").press("Enter");
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).sportConfig?.extraTimeSeconds).toBe(300);

    // One at a time: END works from the period the panel last heard about.
    for (let quarter = 1; quarter <= 4; quarter++) {
      await endPeriod(page);
      await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).period).toBe(String(quarter + 1));
    }
    await expect(page.getByTestId("score-clock")).toHaveText("05:00");
    await expect(page.getByText("FULL TIME")).toBeVisible();

    await endMatch(page);
  });

  test("Fast5 format: 6:00 quarters, 1/2/3-point shots, and doubled shots in the Power Play", async ({ page }) => {
    const { matchId } = await createMatch(page, {
      sport: "netball", matchConfig: { format: "fast5" }, matchName: "E2E Fast5", homeName: "Fast Ferns", visitorName: "Fast Diamonds",
    });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    await expect(page.getByTestId("score-clock")).toHaveText("06:00");
    await expect(page.getByTestId("score-power-play")).toHaveCount(0);
    await clickScoreIncrement(page, "home", 3);
    await expect.poll(() => getScore(page, "home")).toBe(3);

    // The last two minutes of a quarter: outer and super shots count double.
    await page.locator('input[placeholder="MM:SS"]').fill("2:00");
    await page.locator('input[placeholder="MM:SS"]').press("Enter");
    await expect(page.getByTestId("score-power-play")).toBeVisible();
    await expect(page.getByTestId("score-home-inc-2")).toHaveCount(0);
    await clickScoreIncrement(page, "home", 6);
    await expect.poll(() => getScore(page, "home")).toBe(9);

    // The next quarter is back to 6:00 and standard values.
    await endPeriod(page);
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).clockSeconds).toBe(360);
    await expect(page.getByTestId("score-home-inc-2")).toBeVisible();

    await endMatch(page);
  });

  test("defaults to no possession, and toggling home possession is reflected in match state", async ({ page }) => {
    const { matchId } = await createMatch(page, {
      sport: "netball", matchName: "E2E Netball Possession", homeName: "Silver Ferns", visitorName: "Diamonds",
    });
    await waitForLive(page);
    const orgId = await getOrgId(page);

    // netball's defaultPossession is "none" (unlike basketball's "home"),
    // so at match start neither team has indicated possession.
    let state = await getMatchState(page.request, orgId, matchId);
    expect(state.possession).toBe("none");

    await page.getByRole("button", { name: /Silver Ferns ball/ }).click();
    await expect.poll(async () => (await getMatchState(page.request, orgId, matchId)).possession).toBe("home");

    await endMatch(page);
  });
});
