"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AuthCard, Button, Centered, ErrorNotice, Field, StatusMessage, errorMessage, postJson, useTokenLookup,
} from "@/app/components/AuthForm";

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

  const { data: valid, loadError } = useTokenLookup<unknown>(
    "/api/auth/reset-password", token,
    "This reset link is missing a token.", "this reset link is invalid or has expired",
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function resetPassword() {
    setBusy(true);
    setActionError(null);
    try {
      await postJson("/api/auth/reset-password", { token, password }, "couldn't reset your password");
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <StatusMessage tone="danger">{loadError}</StatusMessage>;
  if (done) return <StatusMessage tone="secondary">Password updated. Redirecting to sign in…</StatusMessage>;
  if (valid === null) return <StatusMessage>Loading…</StatusMessage>;

  return (
    <Centered>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black tracking-tight">Choose a new password</h1>
      </div>

      <AuthCard>
        <Field
          type="password" placeholder="New password (min. 8 characters)" value={password} onChange={setPassword}
        />
        <Button
          label={busy ? "Saving…" : "Save new password"}
          onClick={resetPassword}
          disabled={busy || password.length < 8}
        />
        <ErrorNotice message={actionError} />
      </AuthCard>
    </Centered>
  );
}
