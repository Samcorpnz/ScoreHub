import { test, expect } from "@playwright/test";

// The one thing no unauthenticated check can prove: the DEPLOYED frontend is
// wired to the DEPLOYED relay, and renders what the relay broadcasts. A score
// is changed through the relay's REST API (with the smoke org's match-pinned
// CONTROL token) and must appear in a real browser on the real display page.
// If the frontend were built against the wrong relay URL, or the socket path
// broke in the browser, this fails while every relay-only check still passes.
//
// The score is always put back, so the smoke match stays at its baseline.

const env = {
  frontend: process.env.SMOKE_FRONTEND_URL,
  relay: process.env.SMOKE_RELAY_URL,
  org: process.env.SMOKE_ORG_ID,
  match: process.env.SMOKE_MATCH_ID,
  display: process.env.SMOKE_DISPLAY_TOKEN,
  control: process.env.SMOKE_CONTROL_TOKEN,
};
const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => `SMOKE_${k.toUpperCase()}`);

test.describe("deployed display page", () => {
  test.skip(missing.length > 0, `not configured (missing ${missing.join(", ")}) — see docs/smoke-org.md`);

  test("shows a score change made through the relay, then shows it restored", async ({ page }) => {
    const relay = env.relay!.replace(/\/$/, "");
    const stateUrl = `${relay}/state?org=${env.org}&matchId=${env.match}&token=${env.display}`;
    const setScore = async (delta: number) => {
      const res = await fetch(`${relay}/action/score/home?delta=${delta}`, { method: "POST", headers: { "x-control-secret": env.control! } });
      expect(res.status, `POST /action/score/home?delta=${delta}`).toBe(200);
    };

    // Not a browser on ScoreHub's origin, so the relay wants the control token
    // before it serves the display feed (DISPLAY_ORIGIN_REQUIRED, SA-159).
    const baseline = (await (await fetch(stateUrl, { headers: { "x-control-secret": env.control! } })).json()).home.score as number;
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(String(err)));

    await page.goto(`/display/basic?org=${env.org}&matchId=${env.match}&token=${env.display}`);
    const score = page.getByTestId("display-score-home");
    await expect(score).toHaveText(String(baseline), { timeout: 30_000 });

    try {
      await setScore(1);
      await expect(score).toHaveText(String(baseline + 1), { timeout: 10_000 });
    } finally {
      // Restore from the relay's actual current value, not an assumed +1: if the
      // increment applied but the assertion failed, this still lands on baseline.
      const now = (await (await fetch(stateUrl, { headers: { "x-control-secret": env.control! } })).json()).home.score as number;
      if (now !== baseline) await setScore(Math.max(-99, Math.min(99, baseline - now)));
    }
    await expect(score).toHaveText(String(baseline), { timeout: 10_000 });
    expect(errors, "page errors while rendering the display").toEqual([]);
  });

  test("the scorebug and fullscreen layouts render the same live match", async ({ page }) => {
    const qs = `org=${env.org}&matchId=${env.match}&token=${env.display}`;
    for (const layout of ["scorebug", "fullscreen"]) {
      await page.goto(`/display/${layout}?${qs}`);
      await expect(page.getByTestId("display-score-home"), `${layout} layout`).toBeVisible({ timeout: 30_000 });
    }
  });
});
