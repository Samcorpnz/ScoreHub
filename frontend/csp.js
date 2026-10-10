// Content-Security-Policy for the app, built once at build time by
// next.config.js (plain CommonJS so it can be required from there).
//
// Static, not nonce-based: nonces need every page rendered per request, and
// the display pages are served to whole crowds from the static cache. The
// cost is 'unsafe-inline' in script-src (Next's bootstrap scripts are inline),
// so this policy limits where scripts, connections and frames may come from
// rather than blocking injected inline script outright.

// Sentry accepts CSP violation reports on a per-project endpoint derived from
// the DSN: https://<key>@<host>/<projectId>
function sentryReportUri(dsn, environment) {
  if (!dsn) return null;
  let url;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = url.pathname.replace(/^\/+/, "");
  if (!url.username || !projectId) return null;
  const params = new URLSearchParams({ sentry_key: url.username });
  if (environment) params.set("sentry_environment", environment);
  return `https://${url.host}/api/${projectId}/security/?${params}`;
}

function origins(httpUrl) {
  if (!httpUrl) return [];
  try {
    const url = new URL(httpUrl);
    const ws = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    return [url.origin, ws];
  } catch {
    return [];
  }
}

/** @param {{ relayUrl?: string, sentryDsn?: string, sentryEnvironment?: string, isDev?: boolean, report?: boolean }} [options] */
function buildCsp({ relayUrl, sentryDsn, sentryEnvironment, isDev = false, report = true } = {}) {
  const relay = origins(relayUrl);
  const sentryIngest = sentryDsn ? origins(sentryDsn).slice(0, 1) : [];
  const stripeScript = ["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com"];
  const turnstile = "https://challenges.cloudflare.com";

  const directives = {
    "default-src": ["'self'"],
    // 'unsafe-eval' is dev-only: React uses eval to rebuild server stacks.
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...stripeScript, turnstile],
    // Components style with inline `style` attributes, which nonces can't cover.
    // Google Fonts: display themes load their chosen font at runtime.
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    // Logos and player photos can be any https URL a customer supplies.
    "img-src": ["'self'", "data:", "blob:", "https:", ...relay.slice(0, 1)],
    "media-src": ["'self'", "blob:", "https:", ...relay.slice(0, 1)],
    "connect-src": [
      "'self'",
      ...relay,
      ...sentryIngest,
      "https://api.stripe.com",
      "https://checkout.stripe.com",
      // Dev only: Turbopack's HMR socket.
      ...(isDev ? ["ws:"] : []),
    ],
    "frame-src": ["'self'", turnstile, ...stripeScript, "https://hooks.stripe.com"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };

  // A violation report carries the page's full URL, query string included, so
  // callers turn reporting off for pages whose URL holds a token.
  const reportUri = report ? sentryReportUri(sentryDsn, sentryEnvironment) : null;
  if (reportUri) directives["report-uri"] = [reportUri];

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

module.exports = { buildCsp, sentryReportUri };
