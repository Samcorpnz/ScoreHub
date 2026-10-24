"use client";

import { useCallback, useState, SubmitEvent } from "react";
import { TurnstileWidget } from "@/app/components/TurnstileWidget";
import { Button, ErrorNotice } from "@/app/components/AuthForm";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
const TURNSTILE_REQUIRED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  const emailValid = EMAIL_RE.test(email);
  const canSubmit = emailValid && !loading && (!TURNSTILE_REQUIRED || Boolean(turnstileToken));

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "something went wrong");
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-black tracking-tight mb-3">Check your email</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset your password. It
            expires in 1 hour.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-black tracking-tight">Reset your password</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-8 space-y-5"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "0 0 40px rgba(0,0,0,0.4)" }}
        >
          <div>
            <label htmlFor="forgot-email" className="block text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "var(--text-dim)" }}>
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              autoComplete="email"
              required
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>

          <TurnstileWidget onToken={onTurnstileToken} />

          <ErrorNotice message={error} />

          <Button type="submit" disabled={!canSubmit} label={loading ? "Sending…" : "Send reset link"} />
        </form>

        <p className="text-center text-xs mt-6" style={{ color: "var(--text-dim)" }}>
          <a href="/login" style={{ color: "var(--accent)" }}>Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
