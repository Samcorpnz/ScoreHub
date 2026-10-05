// The help centre (help.scorehub.co.nz) calls /api/support/* cross-origin
// with the visitor's session cookie, so those routes answer CORS for exactly
// one other origin: this deployment's own help site. The pairing is derived
// from the hostname (app.X ↔ help.X) so production and UAT need no config.

function helpOriginFor(appUrl: URL): string | null {
  if (appUrl.hostname.startsWith("app.")) {
    return `https://help.${appUrl.hostname.slice("app.".length)}`;
  }
  return null;
}

function isLocalDev(origin: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Returns the caller's origin if it may use the support API: the app itself,
 * its paired help site, or localhost in development. Null means reject. A
 * request with no Origin header (same-origin GET, curl) returns "".
 */
export function allowedSupportOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return "";
  // The request URL normally carries the public host; NEXTAUTH_URL covers
  // deployments where a proxy rewrites it.
  const appUrls = [new URL(req.url)];
  if (process.env.NEXTAUTH_URL) appUrls.push(new URL(process.env.NEXTAUTH_URL));
  const allowed = appUrls.some((appUrl) => origin === appUrl.origin || origin === helpOriginFor(appUrl));
  return allowed || isLocalDev(origin) ? origin : null;
}

export function supportCorsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}
