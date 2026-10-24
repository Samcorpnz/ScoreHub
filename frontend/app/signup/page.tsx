"use client";

import { useCallback, useState, SubmitEvent } from "react";
import { TurnstileWidget } from "@/app/components/TurnstileWidget";
import { Button, ErrorNotice } from "@/app/components/AuthForm";

// Bounded quantifiers (rather than unbounded `+`) cap backtracking cost even
// though the three `[^\s@]` classes overlap — see typescript:S8786.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;

const TURNSTILE_REQUIRED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

function fieldErrors(name: string, orgName: string, email: string, acceptedTerms: boolean) {
  let emailError = "";
  if (!email) {
    emailError = "Email is required";
  } else if (!EMAIL_RE.test(email)) {
    emailError = "Enter a valid email address";
  }

  return {
    name: name.trim() ? "" : "Name is required",
    orgName: orgName.trim() ? "" : "Organization name is required",
    email: emailError,
    acceptedTerms: acceptedTerms ? "" : "You must agree to the terms and conditions",
  };
}

export default function SignupPage() {
  const [name,          setName]          = useState("");
  const [orgName,       setOrgName]       = useState("");
  const [email,         setEmail]         = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error,         setError]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [touched,       setTouched]       = useState<Record<string, boolean>>({});
  const [submitted,     setSubmitted]     = useState(false);

  const errors = fieldErrors(name, orgName, email, acceptedTerms);
  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setTouched({ name: true, orgName: true, email: true, acceptedTerms: true });
    if (Object.values(errors).some(Boolean)) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, orgName, email, acceptedTerms, turnstileToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Signup failed");
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !Object.values(errors).some(Boolean) && !loading && (!TURNSTILE_REQUIRED || Boolean(turnstileToken));

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-black tracking-tight mb-3">Check your email</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            We&apos;ve sent a confirmation link to <strong>{email}</strong>. Click it to set your password and
            finish creating your account. The link expires in 24 hours.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "var(--accent)" }}>
            SAMCORP
          </p>
          <h1 className="text-3xl font-black tracking-tight">
            Score<span style={{ color: "var(--accent)" }}>Hub</span>
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Create your account and organization
          </p>
          <div
            className="mx-auto mt-4"
            style={{ width: 32, height: 2, background: "var(--accent)", boxShadow: "0 0 10px var(--accent-glow)" }}
          />
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-8 space-y-5"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "0 0 40px rgba(0,0,0,0.4)" }}
        >
          <Field
            label="Your name" type="text" value={name} onChange={setName}
            autoFocus autoComplete="name"
            error={touched.name ? errors.name : ""} onBlur={() => touch("name")}
          />
          <Field
            label="Organization name" type="text" value={orgName} onChange={setOrgName}
            autoComplete="organization"
            error={touched.orgName ? errors.orgName : ""} onBlur={() => touch("orgName")}
          />
          <Field
            label="Email" type="email" value={email} onChange={setEmail}
            autoComplete="email"
            error={touched.email ? errors.email : ""} onBlur={() => touch("email")}
          />

          <div>
            <label className="flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                onBlur={() => touch("acceptedTerms")}
                className="mt-0.5"
              />
              <span>
                I agree to the <a href="/terms" target="_blank" style={{ color: "var(--accent)" }}>Terms of Use</a> and{" "}
                <a href="/privacy" target="_blank" style={{ color: "var(--accent)" }}>Privacy Policy</a>
              </span>
            </label>
            {touched.acceptedTerms && errors.acceptedTerms && (
              <p className="mt-1.5 text-xs font-semibold" style={{ color: "var(--danger)" }}>
                {errors.acceptedTerms}
              </p>
            )}
          </div>

          <TurnstileWidget onToken={onTurnstileToken} />

          <ErrorNotice message={error} />

          <Button type="submit" disabled={!canSubmit} label={loading ? "Sending confirmation…" : "Create Account"} />
        </form>

        <p className="text-center text-xs mt-6" style={{ color: "var(--text-dim)" }}>
          Already have an account? <a href="/login" style={{ color: "var(--accent)" }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}

function Field({
  label, type, value, onChange, autoFocus, autoComplete, error, hint, onBlur,
}: {
  readonly label: string;
  readonly type: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly autoFocus?: boolean;
  readonly autoComplete?: string;
  readonly error?: string;
  readonly hint?: string;
  readonly onBlur?: () => void;
}) {
  const borderColor = error ? "var(--danger)" : "var(--border)";
  let fieldMessage: React.ReactNode = null;
  if (error) {
    fieldMessage = (
      <p className="mt-1.5 text-xs font-semibold" style={{ color: "var(--danger)" }}>
        {error}
      </p>
    );
  } else if (hint) {
    fieldMessage = (
      <p className="mt-1.5 text-xs" style={{ color: "var(--text-dim)" }}>
        {hint}
      </p>
    );
  }
  return (
    <div>
      <label
        className="block text-xs font-bold tracking-widest uppercase mb-2"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          e.target.style.borderColor = borderColor;
          onBlur?.();
        }}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        required
        aria-invalid={!!error}
        className="w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all"
        style={{
          background: "var(--bg-elevated)",
          border: `1px solid ${borderColor}`,
          color: "var(--text-primary)",
          outline: "none",
        }}
        onFocus={(e) => (e.target.style.borderColor = "var(--border-accent)")}
      />
      {fieldMessage}
    </div>
  );
}
