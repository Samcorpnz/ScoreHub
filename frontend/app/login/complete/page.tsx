"use client";

import { useEffect } from "react";

// Landing page for the help centre's pop-up login window: /login is opened
// there with callbackUrl=/login/complete, so reaching this page means the
// sign-in worked. Closing the window hands the visitor back to the help
// page, which re-checks who is signed in when it regains focus.
export default function LoginCompletePage() {
  useEffect(() => {
    if (window.opener) window.close();
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{ background: "var(--bg-base)" }}
    >
      <h1 className="text-2xl font-black tracking-tight">You&apos;re signed in</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        You can close this window and go back to the help centre.
      </p>
      <a href="/dashboard" className="mt-6 text-sm" style={{ color: "var(--accent)" }}>
        Go to your dashboard
      </a>
    </div>
  );
}
