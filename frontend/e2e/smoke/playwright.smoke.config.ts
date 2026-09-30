import { defineConfig, devices } from "@playwright/test";

// Post-deploy browser smoke (SA-30) against a LIVE deployment — deliberately
// separate from e2e/playwright.config.ts: no docker-compose stack, no
// globalSetup, no signup. It only needs the smoke org's credentials (see
// docs/smoke-org.md) and the deployed URLs, all from the environment.
//
// Optional Cloudflare Access service-token headers let it reach a frontend
// gated by Zero Trust (e.g. app.uat.scorehub.co.nz).
const extraHTTPHeaders: Record<string, string> = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  extraHTTPHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  extraHTTPHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.smoke\.ts/,
  timeout: 60_000,
  // One retry: a cold serverless function or a scaled-to-zero relay can make the
  // very first request slow. Anything that fails twice is a real failure.
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../playwright-smoke-report" }]],
  use: {
    baseURL: process.env.SMOKE_FRONTEND_URL,
    extraHTTPHeaders,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
