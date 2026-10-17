// Shared by auth.ts (server) and the login page (client), so it can't live in
// auth.ts — importing that from a client component would bundle Prisma.

// The `code` on signIn()'s result when a sign-in attempt was rate limited.
export const RATE_LIMITED_CODE = "rate_limited";

export const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait a minute and try again.";
