// Shared building blocks for the token-link auth pages (signup confirm, reset
// password, invite accept) and the email-entry forms (signup, forgot password).
import { useEffect, useState } from "react";

export function Centered({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
      {children}
    </div>
  );
}

export function StatusMessage({ children, tone = "dim" }: {
  readonly children: React.ReactNode; readonly tone?: "dim" | "secondary" | "danger";
}) {
  const color = { dim: "var(--text-dim)", secondary: "var(--text-secondary)", danger: "var(--danger)" }[tone];
  return (
    <Centered>
      <p className="text-sm" style={{ color }}>{children}</p>
    </Centered>
  );
}

export function AuthCard({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="w-full max-w-sm rounded-2xl p-8 space-y-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}

export function ErrorNotice({ message }: { readonly message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      className="text-sm rounded-lg px-3 py-2 font-semibold"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--danger)" }}
    >
      {message}
    </p>
  );
}

export function Field({
  type, placeholder, value, onChange,
}: { readonly type: string; readonly placeholder: string; readonly value: string; readonly onChange: (v: string) => void }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl px-4 py-3 text-sm font-semibold"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
    />
  );
}

export function Button({ label, onClick, disabled, type = "button" }: {
  readonly label: string; readonly onClick?: () => void; readonly disabled?: boolean; readonly type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
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

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * GETs `${url}?token=…` once for a token-link page. `loadError` also covers a
 * missing token, so callers render it before anything else.
 */
export function useTokenLookup<T>(url: string, token: string, missingTokenMessage: string, invalidMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${url}?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? invalidMessage);
        setData(body);
      })
      .catch(e => setFetchError(errorMessage(e)));
  }, [url, token, invalidMessage]);

  return { data, loadError: token ? fetchError : missingTokenMessage };
}

/** POSTs JSON and throws the server's `error` (or `fallback`) on a non-2xx response. */
export async function postJson(url: string, body: unknown, fallback: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? fallback);
  return data;
}
