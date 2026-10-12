/* eslint-disable no-console */
// One-off clean-up of player photos left in R2 before SA-160: until then,
// removing a player (or replacing a photo with another file type) left the old
// file reachable at its public URL. Lists every object under player-photos/ and
// deletes the ones no roster player points at any more.
//
//   # 1. Dry run (read-only): lists what would be deleted, plus the database
//   #    host and bucket you are pointed at.
//   DOTENV_CONFIG_PATH=.env.remote npm run photos:cleanup --workspace=relay
//   # 2. Apply, confirming both from step 1:
//   DOTENV_CONFIG_PATH=.env.remote npm run photos:cleanup --workspace=relay -- --apply --confirm-host <host> --confirm-bucket <bucket>
//
// DATABASE_URL and the R2_* variables come from the environment or, as with
// `npm run dev:remote`, from the env file DOTENV_CONFIG_PATH names.
// The database and the bucket must belong to the same environment. Safe to
// re-run; photos uploaded in the last hour are skipped (see photoCleanupLib).

import "dotenv/config";
import { prisma } from "@scorehub/db";
import { r2Enabled, r2Bucket, listObjects, deleteObjects } from "../src/storage";
import { describeDatabase } from "./provisionLib";
import { parseArgs, planCleanup } from "./photoCleanupLib";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = describeDatabase(process.env.DATABASE_URL);
  if (!r2Enabled) throw new Error("R2 is not configured — set R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL");
  console.log(`target database: host=${db.host} database=${db.database}`);
  console.log(`target bucket:   ${r2Bucket}`);

  if (args.apply && args.confirmHost !== db.host) {
    throw new Error(`--confirm-host ${JSON.stringify(args.confirmHost)} does not match the DATABASE_URL host ${JSON.stringify(db.host)} — refusing to delete`);
  }
  if (args.apply && args.confirmBucket !== r2Bucket) {
    throw new Error(`--confirm-bucket ${JSON.stringify(args.confirmBucket)} does not match R2_BUCKET ${JSON.stringify(r2Bucket)} — refusing to delete`);
  }

  const photos = await listObjects("player-photos/");
  const players = await prisma.player.findMany({ select: { id: true, orgId: true, photoUrl: true } });
  const plan = planCleanup(photos, players, new Date());

  console.log(`\n${photos.length} stored photo(s), ${players.length} roster player(s)`);
  console.log(`  in use: ${plan.kept}   orphaned: ${plan.orphaned.length}   skipped (uploaded in the last hour): ${plan.skippedRecent}`);
  for (const key of plan.skippedUnrecognised) console.log(`  skipped, unrecognised key: ${key}`);
  for (const o of plan.orphaned) console.log(`  orphaned: ${o.key}  (${o.reason})`);

  if (plan.orphaned.length === 0) {
    console.log("\nnothing to delete");
  } else if (!args.apply) {
    console.log(`\ndry run — nothing deleted. Re-run with --apply --confirm-host ${db.host} --confirm-bucket ${r2Bucket}`);
  } else if (plan.kept === 0) {
    // Every photo orphaned and none in use is what a bucket paired with the
    // wrong environment's database looks like.
    throw new Error("no stored photo matches any roster player — this looks like a database/bucket mismatch, refusing to delete");
  } else {
    await deleteObjects(plan.orphaned.map(o => o.key));
    console.log(`\ndeleted ${plan.orphaned.length} photo(s)`);
  }
  await prisma.$disconnect();
}

main().catch(async err => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
