"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  AuthCard, Button, Centered, ErrorNotice, Field, StatusMessage, errorMessage, postJson, useTokenLookup,
} from "@/app/components/AuthForm";

type SignupRequestInfo = { email: string; name: string; orgName: string };

export default function SignupConfirmPage() {
  return (
    <Suspense>
      <SignupConfirmInner />
    </Suspense>
  );
}

function SignupConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const { data: info, loadError } = useTokenLookup<SignupRequestInfo>(
    "/api/signup/confirm", token,
    "This signup link is missing a token.", "this signup link is invalid or has expired",
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function createAccount() {
    setBusy(true);
    setActionError(null);
    try {
      await postJson("/api/signup/confirm", { token, password }, "couldn't create your account");
      const result = await signIn("credentials", { email: info?.email, password, redirect: false });
      if (result?.error) throw new Error("account created — please sign in");
      router.push("/setup");
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <StatusMessage tone="danger">{loadError}</StatusMessage>;
  if (!info) return <StatusMessage>Loading…</StatusMessage>;

  return (
    <Centered>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black tracking-tight">
          Set your password
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          Finishing setup for <strong>{info.orgName}</strong> ({info.email}).
        </p>
      </div>

      <AuthCard>
        <Field
          type="password" placeholder="Password (min. 8 characters)" value={password} onChange={setPassword}
        />
        <Button
          label={busy ? "Creating account…" : "Create account"}
          onClick={createAccount}
          disabled={busy || password.length < 8}
        />
        <ErrorNotice message={actionError} />
      </AuthCard>
    </Centered>
  );
}
