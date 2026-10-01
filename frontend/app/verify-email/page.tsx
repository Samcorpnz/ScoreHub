"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "../components/primitives";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get("token");
  const [fetchState, setState] = useState<"checking" | "ok" | "error">("checking");
  const [fetchError, setError] = useState<string | null>(null);
  const state = token ? fetchState : "error";
  const error = token ? fetchError : "Missing verification token.";

  useEffect(() => {
    if (!token) return;
    fetch("/api/account/email/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "verification failed");
        setState("ok");
      })
      .catch((e: Error) => {
        setState("error");
        setError(e.message);
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
      <div className="max-w-md w-full">
        <Card title="Email Verification">
          {state === "checking" && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Verifying…</p>
          )}
          {state === "ok" && (
            <>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                Your email address has been updated.
              </p>
              <a href="/login" className="inline-block mt-3 text-xs font-bold" style={{ color: "var(--accent)" }}>
                Sign in →
              </a>
            </>
          )}
          {state === "error" && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
