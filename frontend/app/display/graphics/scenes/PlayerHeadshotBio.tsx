"use client";

import type { SceneProps } from "./LowerThird";
import { findRosterMatch } from "../../../hooks/useRoster";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

// Headshot+bio scene. Prefers a matched roster entry's photo/bio (Phase C:
// packages/db's Player model + /control/roster) and falls back to an
// initials avatar/no-bio when the live feed player has no roster match —
// additive, so a scene selected before any roster data exists still renders.
export function PlayerHeadshotBio({ payload, state, roster }: SceneProps) {
  const playerId = typeof payload?.playerId === "string" || typeof payload?.playerId === "number"
    ? String(payload.playerId)
    : undefined;
  const player = state.graphicsFeed?.stats.players.find(p => p.id === playerId);

  if (!player) {
    return (
      <Card>
        <span style={{ color: "var(--text-dim)", fontSize: "0.7rem" }}>No live data for selected player</span>
      </Card>
    );
  }

  const rosterMatch = findRosterMatch(roster ?? [], player.id);
  const displayName = rosterMatch?.displayName || player.name;
  let photoSrc: string | null;
  if (!rosterMatch?.photoUrl) {
    photoSrc = null;
  } else if (rosterMatch.photoUrl.startsWith("/player-photos/")) {
    photoSrc = `${RELAY_URL}${rosterMatch.photoUrl}`;
  } else {
    photoSrc = rosterMatch.photoUrl;
  }

  const teamColor = player.team === "home"
    ? (state.home.color || "var(--home-color)")
    : (state.visitor.color || "var(--visitor-color)");
  const initials = player.name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase())
    .slice(0, 2)
    .join("");
  const position = typeof player.stats.position === "string" ? player.stats.position : undefined;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- small overlay headshot from relay/external URL; next/image optimizer adds cost and lazy-load flicker on a live overlay
          <img
            src={photoSrc}
            alt={displayName}
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              objectFit: "cover",
              border: `2px solid ${teamColor}`,
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--bg-elevated)",
              border: `2px solid ${teamColor}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.2rem",
              fontWeight: 800,
              color: teamColor,
              flexShrink: 0,
            }}
          >
            {initials || "?"}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--text-primary)" }}>{displayName}</span>
          <span style={{ fontSize: "0.6rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {[player.team, position].filter(Boolean).join(" · ")}
          </span>
          {rosterMatch?.bio && (
            <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", maxWidth: 240, marginTop: 4 }}>
              {rosterMatch.bio}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Card({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--graphics-card-bg, rgba(7,9,15,0.92))",
        borderRadius: 10,
        padding: "14px 20px",
        boxShadow: "0 4px 32px rgba(0,0,0,0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        minWidth: 280,
      }}
    >
      {children}
    </div>
  );
}
