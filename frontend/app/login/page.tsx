"use client";

import { useState, useSyncExternalStore, Suspense, SubmitEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { CantSignIn } from "./CantSignIn";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

// useSyncExternalStore needs a subscribe fn; browser capabilities never change.
const subscribeNever = () => () => {};

// Bounded quantifiers (rather than unbounded `+`) cap backtracking cost even
// though the three `[^\s@]` classes overlap — see typescript:S8786.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;

function fieldErrors(email: string, password: string) {
  let emailError = "";
  if (!email) {
    emailError = "Email is required";
  } else if (!EMAIL_RE.test(email)) {
    emailError = "Enter a valid email address";
  }
  return {
    email: emailError,
    password: password ? "" : "Password is required",
  };
}

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [touched,  setTouched]  = useState<Record<string, boolean>>({});

  const [passkeyBusy,      setPasskeyBusy]      = useState(false);
  const [passkeyError,     setPasskeyError]     = useState("");
  // Once a sign-in attempt has failed, offer the signed-out route to support
  // (it stays visible while they retry). The help centre links here with
  // ?support=1 for people who say they can't log in.
  const [signInFailed,     setSignInFailed]     = useState(searchParams.get("support") === "1");

  // Feature-detect client-side only: the server snapshot is always false, so
  // hydration matches (window.PublicKeyCredential doesn't exist on the server)
  // and the client then re-renders with the real value.
  const passkeySupported = useSyncExternalStore(
    subscribeNever,
    () => "PublicKeyCredential" in window,
    () => false,
  );

  const errors = fieldErrors(email, password);
  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (Object.values(errors).some(Boolean)) return;

    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      setSignInFailed(true);
    } else {
      router.push(callbackUrl);
    }
  }

  async function handlePasskeyLogin() {
    setPasskeyError("");
    setPasskeyBusy(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");

      const optionsRes = await fetch("/api/webauthn/authenticate/options", { method: "POST" });
      if (!optionsRes.ok) throw new Error("couldn't start passkey sign-in");
      const options = await optionsRes.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const result = await signIn("passkey", {
        credential: JSON.stringify(assertion),
        redirect: false,
      });

      if (result?.error) {
        setPasskeyError("Passkey sign-in failed.");
        setSignInFailed(true);
      } else {
        router.push(callbackUrl);
      }
    } catch {
      // startAuthentication throws (e.g. NotAllowedError) if the user
      // cancels the browser's passkey prompt or it times out.
      setPasskeyError("Passkey sign-in was cancelled or failed.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <div className="text-center mb-10">
          <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "var(--accent)" }}>
            SAMCORP
          </p>
          <h1 className="text-3xl font-black tracking-tight">
            Score<span style={{ color: "var(--accent)" }}>Hub</span>
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Sign in to access the control panel
          </p>
          <div
            className="mx-auto mt-4"
            style={{
              width: 32, height: 2,
              background: "var(--accent)",
              boxShadow: "0 0 10px var(--accent-glow)",
            }}
          />
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-8 space-y-5"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            boxShadow: "0 0 40px rgba(0,0,0,0.4)",
          }}
        >
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoFocus
            autoComplete="email"
            error={touched.email ? errors.email : ""}
            onBlur={() => touch("email")}
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            error={touched.password ? errors.password : ""}
            onBlur={() => touch("password")}
          />

          <p className="text-right text-xs -mt-2">
            <a href="/forgot-password" style={{ color: "var(--text-dim)" }}>Forgot password?</a>
          </p>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2 font-semibold"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "var(--danger)",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || Object.values(errors).some(Boolean)}
            className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase transition-opacity"
            style={{
              background: "var(--accent-dim)",
              border: "1px solid var(--border-accent)",
              color: "var(--accent)",
              opacity: loading || Object.values(errors).some(Boolean) ? 0.5 : 1,
              cursor: loading || Object.values(errors).some(Boolean) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>

          {passkeySupported && (
            <>
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={passkeyBusy}
                className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase transition-opacity"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  opacity: passkeyBusy ? 0.5 : 1,
                  cursor: passkeyBusy ? "not-allowed" : "pointer",
                }}
              >
                {passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}
              </button>
              {passkeyError && (
                <p
                  className="text-sm rounded-lg px-3 py-2 font-semibold"
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    color: "var(--danger)",
                  }}
                >
                  {passkeyError}
                </p>
              )}
            </>
          )}
        </form>

        {signInFailed && <CantSignIn email={email} />}

        <p className="text-center text-xs mt-6" style={{ color: "var(--text-dim)" }}>
          Display views are public — only the control panel requires login.
        </p>
        <p className="text-center text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          No account yet? <a href="/signup" style={{ color: "var(--accent)" }}>Sign up</a>
        </p>
      </div>
    </div>
  );
}

function Field({
  label, type, value, onChange, autoFocus, autoComplete, error, onBlur,
}: {
  readonly label: string;
  readonly type: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly autoFocus?: boolean;
  readonly autoComplete?: string;
  readonly error?: string;
  readonly onBlur?: () => void;
}) {
  const borderColor = error ? "var(--danger)" : "var(--border)";
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
      {error && (
        <p className="mt-1.5 text-xs font-semibold" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
