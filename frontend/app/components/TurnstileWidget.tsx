"use client";

import { useEffect, useRef } from "react";

declare global {
  // `var` is what puts it on globalThis (Cloudflare's script assigns it there).
  var turnstile: {
    render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    reset: (id?: string) => void;
  } | undefined;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

// Renders a Cloudflare Turnstile widget when NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is configured; renders nothing otherwise (local dev / self-hosted deploys
// without Turnstile set up — lib/turnstile.ts's server-side check no-ops to
// match, so forms stay usable either way).
export function TurnstileWidget({ onToken }: { readonly onToken: (token: string) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;

    function render() {
      if (!containerRef.current || !globalThis.turnstile || widgetId.current) return;
      widgetId.current = globalThis.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "turnstile-spin-v2",
        callback: onToken,
      });
    }

    if (globalThis.turnstile) {
      render();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", render);
      return () => existing.removeEventListener("load", render);
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", render);
    document.head.appendChild(script);
    // Intentionally leave the script tag in place on unmount — other forms
    // on the same navigation may still need globalThis.turnstile.
  }, [siteKey, onToken]);

  if (!siteKey) return null;

  return <div ref={containerRef} data-action="turnstile-spin-v2" className="flex justify-center" />;
}
