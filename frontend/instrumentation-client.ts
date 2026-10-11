import * as Sentry from "@sentry/nextjs";
import { scrubTokens } from "@/lib/sentryScrub";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const relayUrl = process.env.NEXT_PUBLIC_RELAY_URL;

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    // Default targets are same-origin only; the control/display pages talk
    // to the relay on a different origin, so it needs to be added explicitly
    // for trace headers to propagate across that boundary.
    tracePropagationTargets: ["localhost", /^\//, ...(relayUrl ? [relayUrl] : [])],
    beforeSend: scrubTokens,
    beforeSendTransaction: scrubTokens,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
