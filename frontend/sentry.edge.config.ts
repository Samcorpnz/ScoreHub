import * as Sentry from "@sentry/nextjs";
import { scrubTokens } from "@/lib/sentryScrub";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend: scrubTokens,
    beforeSendTransaction: scrubTokens,
  });
}
