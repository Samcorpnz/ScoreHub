// Pulled out of proxy.ts so this pure redirect decision can be unit tested
// without pulling next-auth (and its next/server import) into the test
// module graph (SA-7).
export function loginRedirectUrl(req: { auth: { user?: unknown } | null; nextUrl: URL }): URL | null {
  if (req.auth?.user) return null;
  const loginUrl = new URL("/login", req.nextUrl.origin);
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
  return loginUrl;
}

// Where /login sends someone after a successful sign-in. `callbackUrl` comes
// from the query string, so it is attacker-controllable: only same-app paths
// and this deployment's own help centre (app.X ↔ help.X, which sends people
// here to log in before contacting support) are honoured. Anything else
// falls back to the dashboard rather than becoming an open redirect.
export function postLoginDestination(
  callbackUrl: string | null,
  appOrigin: string,
): { url: string; external: boolean } {
  const fallback = { url: "/dashboard", external: false };
  if (!callbackUrl) return fallback;
  try {
    // Decide from the URL as the browser will actually parse it, never from
    // the raw string: parsing strips tabs/newlines and treats "\" as "/", so
    // "/\t/evil.example" is really "//evil.example", another site.
    const app = new URL(appOrigin);
    const target = new URL(callbackUrl, app);
    if (target.origin === app.origin) {
      return { url: `${target.pathname}${target.search}${target.hash}`, external: false };
    }
    const pairedHelp = app.hostname.startsWith("app.") && target.origin === `https://help.${app.hostname.slice(4)}`;
    const localDev =
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(app.hostname) &&
      ["localhost", "127.0.0.1"].includes(target.hostname) &&
      ["http:", "https:"].includes(target.protocol);
    return pairedHelp || localDev ? { url: target.href, external: true } : fallback;
  } catch {
    return fallback;
  }
}
