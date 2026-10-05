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

const nextConfig = {
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
