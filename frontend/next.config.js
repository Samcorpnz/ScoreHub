/** @type {import('next').NextConfig} */

// Fail the build early rather than silently deploying a frontend that can't
// reach the relay. NEXT_PUBLIC_ vars are baked in at build time, so an empty
// value here means every user would get a broken connection with no obvious
// error. Local dev is exempt — localhost is a valid target without this var.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_RELAY_URL) {
  throw new Error(
    "NEXT_PUBLIC_RELAY_URL is not set. Add it to your Vercel project's environment variables (production: https://relay.scorehub.co.nz) before deploying."
  );
}

const { buildCsp } = require("./csp");

// Report-only while the policy is proven against real traffic: nothing is
// blocked. To enforce, move the directives into the Content-Security-Policy
// header below.
const cspOptions = {
  relayUrl: process.env.NEXT_PUBLIC_RELAY_URL || "http://localhost:4000",
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sentryEnvironment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  isDev: process.env.NODE_ENV === "development",
};
const contentSecurityPolicy = buildCsp({ ...cspOptions, report: false });

// Violation reports go to Sentry and include the page's full URL, so they are
// sent only from pages listed here, whose URLs never carry a secret. Display
// links (?token=) and the emailed reset/invite/verify links must stay off this
// list; a page left off it still gets the policy, just without reporting.
const cspReportingSources = [
  "/", "/login", "/signup", "/forgot-password", "/terms", "/privacy",
  "/dashboard", "/setup", "/control/:path*", "/account/:path*",
];
const reportingCspHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: buildCsp(cspOptions) },
];

// Pages opened from an emailed link with a single-use token in the URL: keep
// that URL out of the Referer header and document.referrer of whatever loads next.
const tokenLinkSources = ["/reset-password", "/invite/accept", "/signup/confirm", "/verify-email"];

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Display links carry their token in the URL — never send the path off-site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Clickjacking protection for everything a signed-in user can act on.
// /display/* is left frameable on purpose: venues embed scoreboards in their
// own sites and signage players.
const frameHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
];

const nextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/((?!display/).*)", headers: frameHeaders },
      // Later entries override earlier ones for the same header.
      ...cspReportingSources.map(source => ({ source, headers: reportingCspHeaders })),
      ...tokenLinkSources.map(source => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
  // Allow loading logos from the relay server
  images: {
    remotePatterns: [
      { protocol: "http",  hostname: "localhost" },
      { protocol: "https", hostname: "**"        },
    ],
  },
};

// @sentry/nextjs 11 moved this export out of the package root and into a
// dedicated build-config subpath.
const { withSentryConfig } = require("@sentry/nextjs/config");

// Wraps the build to upload source maps to Sentry so production/UAT stack
// traces are readable instead of minified. No-op without SENTRY_AUTH_TOKEN
// (e.g. local dev) — silentlySkip avoids failing the build when it's unset.
module.exports = withSentryConfig(nextConfig, {
  org: "samcorp-limited",
  project: "scorehub-frontend",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // No replacement while building with Turbopack (`next build` here) — the
  // suggested webpack.treeshake.removeDebugLogging option is webpack-only.
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
