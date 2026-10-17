"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import type { MatchState } from "../../types";

// Ends the match (moves it to History and locks its score). Shared by the
// Settings tab's End Match card and the Score tab's full-time panel.
export function useEndMatch({ matchId, isRunning, push, onEnded }: {
  readonly matchId?: string;
  readonly isRunning: boolean;
  readonly push: (p: Partial<MatchState>) => void | Promise<void>;
  readonly onEnded?: () => void;
}) {
  const { data: session } = useSession();
  const orgId = session?.user?.activeOrgId;
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState("");

  async function endMatch() {
    if (!orgId || !matchId) return;
    if (!globalThis.confirm("End this match? It will move to History and can't be scored unless you reopen it.")) return;
    setEnding(true);
    setEndError("");
    // An ended match is read-only on the relay, so nothing could stop a
    // clock that was left running once this goes through.
    if (isRunning) await push({ isRunning: false });
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches/${matchId}/end`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setEndError(body?.error ?? "Couldn't end the match — try again.");
        setEnding(false);
        return;
      }
      onEnded?.();
    } catch {
      setEndError("Couldn't reach the server — try again.");
      setEnding(false);
    }
  }

  return { canEnd: Boolean(orgId && matchId), endMatch, ending, endError };
}
