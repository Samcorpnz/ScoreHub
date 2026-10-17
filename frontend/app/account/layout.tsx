"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { OrgSwitcher } from "../components/OrgSwitcher";

export default function AccountLayout({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession({
    required: true,
    onUnauthenticated() {
      router.push("/login?callbackUrl=/account");
    },
  });

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <div className="text-sm" style={{ color: "var(--text-dim)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-4">
          <span className="font-black text-lg tracking-tight">
            Score<span style={{ color: "var(--accent)" }}>Hub</span>
          </span>
          <span className="text-xs px-2 py-1 rounded font-bold tracking-widest uppercase" style={{ background: "var(--bg-elevated)", color: "var(--text-dim)" }}>
            Account
          </span>
        </div>
        <div className="flex items-center gap-4">
          <OrgSwitcher />
          {session?.user?.name && (
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>{session.user.name}</span>
          )}
          <a
            href="/dashboard"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Dashboard
          </a>
          <a
            href="https://help.scorehub.co.nz"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Help
          </a>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Sign out
          </button>
        </div>
      </div>

      {children}
    </div>
  );
}
