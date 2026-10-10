import { describe, it, expect } from "vitest";
import { buildCsp, sentryReportUri } from "../../csp";

const DSN = "https://abc123@o42.ingest.us.sentry.io/777";

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find(d => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("buildCsp", () => {
  const csp = buildCsp({ relayUrl: "https://relay.scorehub.co.nz", sentryDsn: DSN, sentryEnvironment: "production" });

  it("lets the page reach the relay over both https and wss", () => {
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining(["'self'", "https://relay.scorehub.co.nz", "wss://relay.scorehub.co.nz"]),
    );
  });

  it("allows Stripe and Turnstile scripts and frames", () => {
    expect(directive(csp, "script-src")).toEqual(
      expect.arrayContaining(["https://js.stripe.com", "https://challenges.cloudflare.com"]),
    );
    expect(directive(csp, "frame-src")).toEqual(
      expect.arrayContaining(["https://js.stripe.com", "https://hooks.stripe.com", "https://challenges.cloudflare.com"]),
    );
  });

  it("allows Sentry ingest and reports violations to the project's security endpoint", () => {
    expect(directive(csp, "connect-src")).toContain("https://o42.ingest.us.sentry.io");
    expect(directive(csp, "report-uri")).toEqual([
      "https://o42.ingest.us.sentry.io/api/777/security/?sentry_key=abc123&sentry_environment=production",
    ]);
  });

  it("keeps eval and the HMR socket out of production", () => {
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).not.toContain("ws:");
    expect(directive(buildCsp({ isDev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("locks down object, base and form targets", () => {
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });

  it("uses ws:// for a plain-http relay and omits reporting without a DSN", () => {
    const local = buildCsp({ relayUrl: "http://localhost:4000" });
    expect(directive(local, "connect-src")).toEqual(expect.arrayContaining(["http://localhost:4000", "ws://localhost:4000"]));
    expect(local).not.toContain("report-uri");
  });
});

describe("sentryReportUri", () => {
  it("returns null for a missing or malformed DSN", () => {
    expect(sentryReportUri(undefined)).toBeNull();
    expect(sentryReportUri("not a url")).toBeNull();
    expect(sentryReportUri("https://o42.ingest.sentry.io/777")).toBeNull();
  });
});
