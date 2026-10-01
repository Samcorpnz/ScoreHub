"use client";

import { useEffect, useState } from "react";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

export interface RosterPlayer {
  externalId: string | null;
  provider: string | null;
  firstName: string;
  lastName: string;
  displayName: string | null;
  photoUrl: string | null;
  bio: string | null;
}

// Fetches roster entries for the given live-feed player ids from the relay's
// public /api/graphics/roster route (same unauthenticated trust level as
// /api/graphics/entitlement, since /display/graphics is an OBS Browser Source
// with no session) so scene components can resolve a live graphicsFeed player
// to a photo/bio. Scoped to the ids currently on the feed rather than the
// whole org roster — the endpoint only returns players whose id is passed, so
// the shareable display URL can't be used to dump the org's people database.
const NO_PLAYERS: RosterPlayer[] = [];

export function useRoster(org: string | null | undefined, externalIds: string[]): RosterPlayer[] {
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  // Stable dependency key so the effect only refetches when the actual set of
  // ids changes, not on every render's fresh array identity.
  const idsKey = [...externalIds].sort((a, b) => a.localeCompare(b)).join(",");

  const hasInputs = Boolean(org) && idsKey !== "";

  useEffect(() => {
    if (!org || idsKey === "") return;
    const url = `${RELAY_URL}/api/graphics/roster?org=${encodeURIComponent(org)}&externalId=${encodeURIComponent(idsKey)}`;
    fetch(url)
      .then(res => res.json())
      .then(data => setPlayers(Array.isArray(data.players) ? data.players : []))
      .catch(err => {
        console.warn("[useRoster] failed to fetch roster:", err);
        setPlayers([]);
      });
  }, [org, idsKey]);

  return hasInputs ? players : NO_PLAYERS;
}

// Matches a live feed player (bridge/src/graphics/feedTransform.ts's id,
// which is the provider's externalId) against the fetched roster. Provider
// isn't known on the feed-player object itself, so this matches on
// externalId alone — fine in practice since a single org/match runs one
// provider at a time.
export function findRosterMatch(players: RosterPlayer[], feedPlayerId: string | undefined): RosterPlayer | undefined {
  if (!feedPlayerId) return undefined;
  return players.find(p => p.externalId === feedPlayerId);
}
