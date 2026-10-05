"use client";

import { useCallback, useState, SubmitEvent } from "react";
import { TurnstileWidget } from "@/app/components/TurnstileWidget";

const SUPPORT_EMAIL = "hello@scorehub.co.nz";
const TURNSTILE_REQUIRED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

const inputStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  outline: "none",
} as const;

// Support is normally behind a login (the help centre's case form), which
// is no use to someone who can't get in. This form is the one signed-out
// route to the team; /api/support/case files it as an unverified request.
export function CantSignIn({ email: initialEmail }: { readonly email: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "failed">("idle");
  const [sentKey, setSentKey] = useState<string | null | undefined>(undefined);
  const [turnstileToken, setTurnstileToken] = useState("");
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus("sending");
    try {
      const res = await fetch("/api/support/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(form),
          turnstileToken,
          category: "login",
          summary: "Can't sign in to ScoreHub",
          page: "/login",
        }),
      });
      if (!res.ok) throw new Error(`support request failed: ${res.status}`);
      setSentKey(((await res.json()) as { key: string | null }).key);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }

  if (sentKey !== undefined) {
    return (
      <p className="text-center text-sm mt-6" role="status" style={{ color: "var(--text-secondary)" }}>
        Request sent{sentKey ? ` (${sentKey})` : ""}. We&apos;ll reply by email.
      </p>
    );
  }

  if (!open) {
    return (
      <p className="text-center text-sm mt-6" style={{ color: "var(--text-secondary)" }}>
        Still can&apos;t sign in?{" "}
        <button type="button" onClick={() => setOpen(true)} style={{ color: "var(--accent)" }}>
          Contact support
        </button>
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Contact support"
      className="rounded-2xl p-6 mt-6 space-y-3"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <p className="text-sm font-bold">Contact support</p>
      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        Tell us what happens when you try to sign in and we&apos;ll reply by email.
      </p>
      <input
        name="email"
        type="email"
        required
        maxLength={254}
        defaultValue={initialEmail}
        placeholder="Your account email"
        aria-label="Your account email"
        autoComplete="email"
        className="w-full rounded-xl px-4 py-3 text-sm"
        style={inputStyle}
      />
      <input
        name="name"
        maxLength={120}
        placeholder="Your name"
        aria-label="Your name"
        autoComplete="name"
        className="w-full rounded-xl px-4 py-3 text-sm"
        style={inputStyle}
      />
      <textarea
        name="details"
        rows={3}
        maxLength={4000}
        placeholder="What happens when you try to sign in?"
        aria-label="What happens when you try to sign in?"
        className="w-full rounded-xl px-4 py-3 text-sm"
        style={inputStyle}
      />
      {/* Honeypot: hidden from people, tempting to bots. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: -9999 }}
      />
      <TurnstileWidget onToken={onTurnstileToken} />
      {status === "failed" && (
        <p className="text-xs font-semibold" role="alert" style={{ color: "var(--danger)" }}>
          We couldn&apos;t send that. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> instead.
        </p>
      )}
      <button
        type="submit"
        disabled={status === "sending" || (TURNSTILE_REQUIRED && !turnstileToken)}
        className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase"
        style={{
          background: "var(--accent-dim)",
          border: "1px solid var(--border-accent)",
          color: "var(--accent)",
          opacity: status === "sending" ? 0.5 : 1,
        }}
      >
        {status === "sending" ? "Sending…" : "Send to support"}
      </button>
    </form>
  );
}
