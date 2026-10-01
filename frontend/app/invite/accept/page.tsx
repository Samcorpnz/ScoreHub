"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

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

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const loadError = token ? fetchError : "This invitation link is missing a token.";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? "this invitation is invalid or has expired");
        setInfo(data);
      })
      .catch(e => setFetchError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  async function acceptAsLoggedInUser() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't accept this invitation");
      router.push("/dashboard");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
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
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function createAccountAndAccept() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password, acceptedTerms }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't create your account");

      const result = await signIn("credentials", { email: info?.email, password, redirect: false });
      if (result?.error) throw new Error("account created — please sign in");
      router.push("/dashboard");
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

  if (!info || sessionStatus === "loading") {
    return (
      <Centered>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>Loading…</p>
      </Centered>
    );
  }

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

      <div
        className="w-full max-w-sm rounded-2xl p-8 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        {inviteAction}

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
