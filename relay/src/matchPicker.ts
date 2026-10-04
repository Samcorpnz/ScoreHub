import { prisma } from "@scorehub/db";
import { verifyBridgeSecret, AuthResult } from "./auth";
import { orgHasAddOn } from "./entitlements";

// Console bridging is part of the paid Data Feed add-on (SA-114) — the same
// add-on that gates the third-party data feed. Shown verbatim in the Bridge
// app's log, so it says what to do about it.
export const BRIDGE_ADDON_REQUIRED_MESSAGE =
  "Connecting a console requires the Data Feed add-on — an Admin can add it under Account → Billing";

export type BridgeAccess =
  | { ok: true; orgId: string; matchId?: string }
  | { ok: false; error: string };

// Resolves a bridge socket handshake. Returns null for a bad/absent secret
// (the caller treats that like any other unauthenticated connection), and a
// refusal with a human-readable reason when the token is good but the org
// isn't entitled or asked for a match it doesn't own.
//
// A token pinned to a match always wins. An unpinned ("All matches") token
// lets the Bridge app choose the match itself (SA-145) — without that, its
// data lands in the org's default room, which no match's displays watch.
export async function resolveBridgeAccess(
  secret: string | undefined,
  legacySecret: string,
  requestedMatchId: string | undefined,
): Promise<BridgeAccess | null> {
  const result = await verifyBridgeSecret(secret, legacySecret);
  if (!result) return null;
  if (!(await orgHasAddOn(result.orgId, "data-feed"))) {
    return { ok: false, error: BRIDGE_ADDON_REQUIRED_MESSAGE };
  }
  if (result.matchId || !requestedMatchId || !process.env.DATABASE_URL) {
    return { ok: true, orgId: result.orgId, matchId: result.matchId };
  }
  const match = await prisma.match.findUnique({ where: { id: requestedMatchId }, select: { orgId: true, status: true } });
  if (match?.orgId !== result.orgId) {
    return { ok: false, error: "The selected match wasn't found — pick a match again in the Bridge app" };
  }
  if (match.status === "ENDED") {
    return { ok: false, error: "The selected match has ended — pick a current match in the Bridge app" };
  }
  return { ok: true, orgId: result.orgId, matchId: requestedMatchId };
}

export interface SelectableMatch {
  id: string;
  name: string;
  sport: string | null;
  status: string;
  scheduledAt: string | null;
  displayToken?: string | null;
}

export interface MatchPickerList {
  orgId: string;
  // Set when the caller's token is pinned — the picker has nothing to choose.
  pinnedMatchId: string | null;
  matches: SelectableMatch[];
}

// Matches a Bridge or Stream Deck token may attach to: the org's live and
// upcoming ones (or just the pinned one). `includeDisplayToken` is for
// CONTROL-token callers only — the Stream Deck plugin needs it to open its
// read-only state socket once DISPLAY_TOKEN_REQUIRED is on.
export async function listSelectableMatches(auth: AuthResult, includeDisplayToken: boolean): Promise<MatchPickerList> {
  if (!process.env.DATABASE_URL) {
    return { orgId: auth.orgId, pinnedMatchId: null, matches: [] };
  }
  const rows = await prisma.match.findMany({
    where: {
      orgId: auth.orgId,
      status: { in: ["LIVE", "SCHEDULED"] },
      ...(auth.matchId ? { id: auth.matchId } : {}),
    },
    select: { id: true, status: true, sport: true, homeName: true, visitorName: true, scheduledAt: true, displayToken: true },
    orderBy: [{ status: "desc" }, { scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return {
    orgId: auth.orgId,
    pinnedMatchId: auth.matchId ?? null,
    matches: rows.map(row => ({
      id: row.id,
      name: `${row.homeName || "Home"} v ${row.visitorName || "Visitor"}`,
      sport: row.sport,
      status: row.status,
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      ...(includeDisplayToken && { displayToken: row.displayToken }),
    })),
  };
}
