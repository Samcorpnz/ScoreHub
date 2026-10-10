import { test, expect } from "../fixtures/auth";
import { createMatch, endMatch, waitForLive } from "../helpers/match";
import { bowlBall, completeOver, startInnings, takeWicket, waitForCricketPanel } from "../helpers/cricket";

test.describe("cricket", () => {
  test("squad entry seeds batters/bowler, ball-by-ball scoring, wide, and wicket", async ({ page }) => {
    await createMatch(page, {
      sport: "cricket",
      matchConfig: { format: "t20" },
      matchName: "E2E Cricket",
      homeName: "Titans",
      visitorName: "Warriors",
      squads: {
        home: ["A Smith", "B Jones", "C Adams"],
        visitor: ["D Brown", "E White", "F Green"],
      },
    });
    await waitForLive(page);
    await waitForCricketPanel(page);

    await startInnings(page);
    await expect(page.getByText("A Smith *")).toBeVisible();
    await expect(page.getByText("D Brown")).toBeVisible();

    await bowlBall(page, { runs: 4 });
    await expect(page.getByTestId("cricket-score")).toContainText("4/0");

    // A wide adds a run but doesn't count as a legal ball (over stays 0.1)
    await bowlBall(page, { runs: 0, modifier: "wide" });
    await expect(page.getByTestId("cricket-score")).toContainText("5/0");
    await expect(page.getByTestId("cricket-score")).toContainText("0.1 ov");

    await takeWicket(page, { type: "bowled", nextBatterIndex: 2 });
    await expect(page.getByTestId("cricket-score")).toContainText("5/1");

    await completeOver(page, 1);

    await endMatch(page);
  });

  test.describe("formats", () => {
    for (const format of ["t20", "odi", "test"] as const) {
      test(`can create a ${format} match`, async ({ page }) => {
        await createMatch(page, {
          sport: "cricket",
          matchConfig: { format },
          matchName: `E2E Cricket ${format}`,
          squads: { home: ["P1", "P2"], visitor: ["P3", "P4"] },
        });
        await waitForLive(page);
        await waitForCricketPanel(page);
        await expect(page.getByText(new RegExp(format.toUpperCase()))).toBeVisible();
        await endMatch(page);
      });
    }
  });
});
