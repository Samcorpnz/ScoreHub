"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import {
  AuthCard, Button, Centered, ErrorNotice, Field, StatusMessage, errorMessage, postJson, useTokenLookup,
} from "@/app/components/AuthForm";

type InvitationInfo = { email: string; orgName: string; role: string; accountExists: boolean };

export default function InviteAcceptPage() {
  return (
    <Suspense>
      <InviteAcceptInner />
    </Suspense>
  );
}

function InviteAcceptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const { data: session, status: sessionStatus, update: updateSession } = useSession();

  const { data: info, loadError } = useTokenLookup<InvitationInfo>(
    "/api/invitations/accept", token,
    "This invitation link is missing a token.", "this invitation is invalid or has expired",
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function acceptAsLoggedInUser() {
    setBusy(true);
    setActionError(null);
    try {
      await postJson("/api/invitations/accept", { token }, "couldn't accept this invitation");
      router.push("/dashboard");
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function loginThenAccept() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await signIn("credentials", {
        email: info?.email,
        password: loginPassword,
        redirect: false,
      });
      if (result?.error) throw new Error("incorrect password");
      await updateSession();
      await acceptAsLoggedInUser();
    } catch (e) {
      setActionError(errorMessage(e));
      setBusy(false);
    }
  }

  async function createAccountAndAccept() {
    setBusy(true);
    setActionError(null);
    try {
      await postJson("/api/invitations/accept", { token, name, password, acceptedTerms }, "couldn't create your account");

      const result = await signIn("credentials", { email: info?.email, password, redirect: false });
      if (result?.error) throw new Error("account created — please sign in");
      router.push("/dashboard");
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <StatusMessage tone="danger">{loadError}</StatusMessage>;
  if (!info || sessionStatus === "loading") return <StatusMessage>Loading…</StatusMessage>;

  const loggedInAsInvitee = session?.user?.email === info.email;

  let inviteAction: React.ReactNode;
  if (loggedInAsInvitee) {
    inviteAction = (
      <Button label={busy ? "Joining…" : `Join ${info.orgName}`} onClick={acceptAsLoggedInUser} disabled={busy} />
    );
  } else if (info.accountExists) {
    inviteAction = (
      <>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Log in as {info.email} to accept this invitation.
        </p>
        <Field type="password" placeholder="Password" value={loginPassword} onChange={setLoginPassword} />
        <Button label={busy ? "Signing in…" : "Log in and join"} onClick={loginThenAccept} disabled={busy || !loginPassword} />
      </>
    );
  } else {
    inviteAction = (
      <>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Create an account to join {info.orgName}.
        </p>
        <Field type="text" placeholder="Your name" value={name} onChange={setName} />
        <Field type="password" placeholder="Password (min. 8 characters)" value={password} onChange={setPassword} />
        <label className="flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I agree to the <a href="/terms" target="_blank" style={{ color: "var(--accent)" }}>Terms &amp; Conditions</a>
          </span>
        </label>
        <Button
          label={busy ? "Creating account…" : "Create account and join"}
          onClick={createAccountAndAccept}
          disabled={busy || !name || password.length < 8 || !acceptedTerms}
        />
      </>
    );
  }

  return (
    <Centered>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black tracking-tight">
          Join <span style={{ color: "var(--accent)" }}>{info.orgName}</span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          You&apos;ve been invited as <strong>{info.role}</strong> ({info.email}).
        </p>
      </div>

      <AuthCard>
        {inviteAction}
        <ErrorNotice message={actionError} />
      </AuthCard>
    </Centered>
  );
}
