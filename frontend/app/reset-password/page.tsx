"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [valid, setValid] = useState<boolean | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const loadError = token ? fetchError : "This reset link is missing a token.";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? "this reset link is invalid or has expired");
        setValid(true);
      })
      .catch(e => setFetchError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  async function resetPassword() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't reset your password");
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Centered>
        <p className="text-sm" style={{ color: "var(--danger)" }}>{loadError}</p>
      </Centered>
    );
  }

  if (done) {
    return (
      <Centered>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Password updated. Redirecting to sign in…
        </p>
      </Centered>
    );
  }

  if (valid === null) {
    return (
      <Centered>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>Loading…</p>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black tracking-tight">Choose a new password</h1>
      </div>

      <div
        className="w-full max-w-sm rounded-2xl p-8 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <Field
          type="password" placeholder="New password (min. 8 characters)" value={password} onChange={setPassword}
        />
        <Button
          label={busy ? "Saving…" : "Save new password"}
          onClick={resetPassword}
          disabled={busy || password.length < 8}
        />

        {actionError && (
          <p
            className="text-sm rounded-lg px-3 py-2 font-semibold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--danger)" }}
          >
            {actionError}
          </p>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
      {children}
    </div>
  );
}

function Field({
  type, placeholder, value, onChange,
}: { readonly type: string; readonly placeholder: string; readonly value: string; readonly onChange: (v: string) => void }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl px-4 py-3 text-sm font-semibold"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
    />
  );
}

function Button({ label, onClick, disabled }: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase transition-opacity"
      style={{
        background: "var(--accent-dim)",
        border: "1px solid var(--border-accent)",
        color: "var(--accent)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
