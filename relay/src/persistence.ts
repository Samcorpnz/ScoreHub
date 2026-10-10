import crypto from "node:crypto";
import { prisma } from "@scorehub/db";
import { MatchState, DEFAULT_MATCH_STATE } from "./types";
import { getOrgAccount, ConcurrentMatchLimitError } from "./entitlements";

// See the Match.displayToken schema comment — every match gets one at
// creation so opening a display link stays a zero-config action.
function newDisplayToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

const SAVE_DEBOUNCE_MS = 2000;

export class MatchNotFoundError extends Error {
  constructor() {
    super("match not found");
    this.name = "MatchNotFoundError";
  }
}

// Thrown when something tries to change a match that has been ended — an
// ENDED match is read-only until it's reopened from the dashboard's History
// tab (frontend POST /api/orgs/[orgId]/matches/[matchId]/reopen).
export class MatchEndedError extends Error {
  constructor() {
    super("This match has ended — reopen it from the dashboard's History tab to make changes");
    this.name = "MatchEndedError";
  }
}

export interface MatchStore {
  orgId: string;
  load(): Promise<MatchState>;
  save(state: MatchState): void;
  flush(): Promise<void>;
}

const stores = new Map<string, MatchStore>();

// Shared by the legacy org-singleton path below and the explicit "create a
// new match" REST endpoint (server.ts POST /match) — both need the same
// free-tier concurrent-LIVE-match gate, so the check lives in one place.
async function createLiveMatch(orgId: string): Promise<string> {
  const account = await getOrgAccount(orgId);
  if (account?.plan === "free") {
    const liveElsewhere = await prisma.match.count({
      where: { status: "LIVE", org: { accountId: account.accountId } },
    });
    if (liveElsewhere > 0) throw new ConcurrentMatchLimitError();
  }
  const created = await prisma.match.create({ data: { orgId, state: DEFAULT_MATCH_STATE as object, displayToken: newDisplayToken() } });
  return created.id;
}

export { createLiveMatch };

// One store per (org, match) pair, lazily created and cached so debounce
// timers persist across calls.
//
// Passing no matchId preserves the original singleton behavior verbatim:
// the org's most recent LIVE match is found-or-created on first access. This
// is what bridges, display links, and any pre-existing /control bookmark
// still use, so none of them needed to change when multi-match support was
// added.
//
// Passing a matchId scopes the store to that exact row (after verifying it
// belongs to orgId). A SCHEDULED match is transitioned to LIVE on first
// access here, behind the same concurrency gate as createLiveMatch — so a
// pre-scheduled fixture can't bypass the free-tier limit just because its
// row already existed.
export function getMatchStore(orgId: string, matchId?: string): MatchStore | null {
  if (!process.env.DATABASE_URL) return null;

  const cacheKey = `${orgId}:${matchId ?? "default"}`;
  const existing = stores.get(cacheKey);
  if (existing) return existing;

  let resolvedId: string | null = null;
  let pending: MatchState | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function resolveMatch(): Promise<string> {
    if (resolvedId) return resolvedId;

    if (matchId) {
      const row = await prisma.match.findUnique({ where: { id: matchId } });
      if (row?.orgId !== orgId) throw new MatchNotFoundError();
      if (row.status === "SCHEDULED") {
        const account = await getOrgAccount(orgId);
        if (account?.plan === "free") {
          const liveElsewhere = await prisma.match.count({
            where: { status: "LIVE", org: { accountId: account.accountId } },
          });
          if (liveElsewhere > 0) throw new ConcurrentMatchLimitError();
        }
        await prisma.match.update({ where: { id: matchId }, data: { status: "LIVE" } });
      }
      resolvedId = matchId;
      return matchId;
    }

    const live = await prisma.match.findFirst({ where: { orgId, status: "LIVE" }, orderBy: { createdAt: "desc" } });
    if (live) {
      resolvedId = live.id;
      return live.id;
    }
    resolvedId = await createLiveMatch(orgId);
    return resolvedId;
  }

  async function writeThrough(state: MatchState): Promise<void> {
    const id = await resolveMatch();
    await prisma.match.update({
      where: { id },
      data: {
        state: state as object,
        sport: state.sport,
        homeName: state.home?.name,
        visitorName: state.visitor?.name,
      },
    });
  }

  const store: MatchStore = {
    orgId,

    async load() {
      const id = await resolveMatch();
      const row = await prisma.match.findUnique({ where: { id } });
      return (row?.state as unknown as MatchState) ?? { ...DEFAULT_MATCH_STATE };
    },

    save(state: MatchState) {
      pending = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const toWrite = pending;
        pending = null;
        if (toWrite) writeThrough(toWrite).catch(err => console.error("[relay] failed to persist match state for org:", orgId, err));
      }, SAVE_DEBOUNCE_MS);
    },

    async flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      const toWrite = pending;
      pending = null;
      if (toWrite) await writeThrough(toWrite);
    },
  };

  stores.set(cacheKey, store);
  return store;
}

// Called when the last socket leaves a match's room (server.ts) so the cache
// doesn't grow forever as orgs accumulate matches over time — unlike the
// legacy org-singleton entry (cacheKey ending in ":default"), of which there
// is only ever one per org, so it's left to live for the process lifetime as
// before.
export async function evictMatchStore(orgId: string, matchId: string): Promise<void> {
  const cacheKey = `${orgId}:${matchId}`;
  const store = stores.get(cacheKey);
  if (!store) return;
  await store.flush().catch(err => console.error("[relay] failed to flush match state on evict:", orgId, matchId, err));
  stores.delete(cacheKey);
}

export function allActiveStores(): MatchStore[] {
  return [...stores.values()];
}
