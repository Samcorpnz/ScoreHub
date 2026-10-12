// Pure helpers for cleanup-orphaned-player-photos.ts, split out so the
// safety-critical part (which stored photos count as orphaned) is unit tested.

export interface CleanupArgs {
  apply: boolean;
  confirmHost?: string;
  confirmBucket?: string;
}

export function parseArgs(argv: string[]): CleanupArgs {
  const out: CleanupArgs = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--apply": out.apply = true; break;
      case "--confirm-host": out.confirmHost = argv[++i]; break;
      case "--confirm-bucket": out.confirmBucket = argv[++i]; break;
      default: throw new Error(`unknown argument ${JSON.stringify(flag)}`);
    }
  }
  // Both, because the danger is a mismatched pair: a bucket checked against
  // another environment's database makes every photo in it look orphaned.
  if (out.apply && (!out.confirmHost || !out.confirmBucket)) {
    throw new Error("--apply requires --confirm-host <database host> and --confirm-bucket <bucket> (both printed by a dry run)");
  }
  return out;
}

export interface StoredPhoto { key: string; lastModified?: Date }
export interface RosterPlayer { id: string; orgId: string; photoUrl: string | null }

// Uploads newer than this are left alone: the roster stores the file first and
// saves photoUrl onto the player a moment later, so a just-uploaded photo can
// look unreferenced.
export const MIN_AGE_MS = 60 * 60 * 1000;

export interface CleanupPlan {
  orphaned: { key: string; reason: string }[];
  kept: number;
  skippedRecent: number;
  skippedUnrecognised: string[];
}

// Keys are player-photos/<orgId>/<playerId>.<ext> (see storeImage in
// src/server.ts). A photo is kept only when its player still exists in that
// org and the player's photoUrl points at this exact file.
export function planCleanup(photos: StoredPhoto[], players: RosterPlayer[], now: Date): CleanupPlan {
  const byId = new Map(players.map(p => [p.id, p]));
  const plan: CleanupPlan = { orphaned: [], kept: 0, skippedRecent: 0, skippedUnrecognised: [] };

  for (const photo of photos) {
    const m = /^player-photos\/([^/]+)\/([^/]+)\.[^./]+$/.exec(photo.key);
    if (!m) { plan.skippedUnrecognised.push(photo.key); continue; }
    const [, orgId, playerId] = m;

    const player = byId.get(playerId);
    let reason: string | null = null;
    if (!player) reason = "player no longer exists";
    else if (player.orgId !== orgId) reason = "player belongs to another org";
    else if (!player.photoUrl) reason = "player has no photo set";
    else if (!player.photoUrl.split("?")[0].endsWith(`/${photo.key}`)) reason = "player's photo is a different file";

    if (!reason) { plan.kept++; continue; }
    if (!photo.lastModified || now.getTime() - photo.lastModified.getTime() < MIN_AGE_MS) { plan.skippedRecent++; continue; }
    plan.orphaned.push({ key: photo.key, reason });
  }
  return plan;
}
