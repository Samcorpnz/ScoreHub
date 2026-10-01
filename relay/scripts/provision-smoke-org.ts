/* eslint-disable no-console */
// Provision (or inspect) the dedicated smoke-test org used by scripts/smoke.mjs's
// authenticated checks (SA-30). It creates ONE account/org with NO users and NO
// billing, one permanently-LIVE match, and a CONTROL token pinned to that match
// — so the CI credential can drive that single match and nothing else.
//
//   # 1. Dry run (read-only): shows what exists / what would be created and the
//   #    database host you are pointed at.
//   DATABASE_URL=<target db> npm run smoke:provision --workspace=relay -- --env uat
//   # 2. Apply, confirming the host from step 1:
//   DATABASE_URL=<target db> npm run smoke:provision --workspace=relay -- --env uat --apply --confirm-host <host>
//
// Idempotent: re-running reuses what exists. The control token's plaintext is
// only ever shown when it is created (only its hash is stored); pass
// --rotate-token to revoke the old one and mint another. See docs/smoke-org.md.

import { prisma } from "@scorehub/db";
import { DEFAULT_MATCH_STATE } from "../src/types";
import {
  parseArgs, describeDatabase, githubNames, hashToken, newToken, newDisplayToken,
  SMOKE_ACCOUNT_NAME, SMOKE_ORG_NAME, SMOKE_TOKEN_LABEL,
} from "./provisionLib";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = describeDatabase(process.env.DATABASE_URL);
  console.log(`target database: host=${db.host} database=${db.database}  (env label: ${args.env})`);

  if (args.apply && args.confirmHost !== db.host) {
    throw new Error(`--confirm-host ${JSON.stringify(args.confirmHost)} does not match the DATABASE_URL host ${JSON.stringify(db.host)} — refusing to write`);
  }

  let account = await prisma.account.findFirst({ where: { name: SMOKE_ACCOUNT_NAME } });
  let org = account ? await prisma.org.findFirst({ where: { accountId: account.id, name: SMOKE_ORG_NAME } }) : null;
  let match = org ? await prisma.match.findFirst({ where: { orgId: org.id, status: "LIVE" }, orderBy: { createdAt: "asc" } }) : null;
  const activeTokens = match
    ? await prisma.scopedToken.findMany({ where: { orgId: match.orgId, matchId: match.id, type: "CONTROL", label: SMOKE_TOKEN_LABEL, revokedAt: null } })
    : [];

  const plan: string[] = [];
  if (!account) plan.push("create account");
  if (!org) plan.push("create org");
  if (!match) plan.push("create LIVE match");
  else if (!match.displayToken) plan.push("assign the match a display token");
  if (activeTokens.length === 0) plan.push("create CONTROL token pinned to the match");
  else if (args.rotateToken) plan.push(`revoke ${activeTokens.length} existing CONTROL token(s) and create a new one`);
  console.log(plan.length ? `plan: ${plan.join("; ")}` : "plan: nothing to create — smoke org already provisioned");

  if (!args.apply) {
    if (plan.length) console.log("\ndry run — no changes made. Re-run with --apply --confirm-host " + db.host);
    if (match) printIds(args.env, org!.id, match.id, match.displayToken ?? undefined, undefined);
    await prisma.$disconnect();
    return;
  }

  account = account ?? await prisma.account.create({ data: { name: SMOKE_ACCOUNT_NAME, plan: "free" } });
  org = org ?? await prisma.org.create({ data: { accountId: account.id, name: SMOKE_ORG_NAME } });
  if (!match) {
    const state = {
      ...DEFAULT_MATCH_STATE,
      matchName: "ScoreHub smoke test (do not delete)",
      home: { ...DEFAULT_MATCH_STATE.home, name: "Smoke Home" },
      visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Smoke Visitor" },
    };
    match = await prisma.match.create({
      data: {
        orgId: org.id, status: "LIVE", sport: "netball", homeName: "Smoke Home", visitorName: "Smoke Visitor",
        state: state as unknown as object, displayToken: newDisplayToken(),
      },
    });
  } else if (!match.displayToken) {
    match = await prisma.match.update({ where: { id: match.id }, data: { displayToken: newDisplayToken() } });
  }

  let plaintext: string | undefined;
  if (args.rotateToken && activeTokens.length) {
    await prisma.scopedToken.updateMany({ where: { id: { in: activeTokens.map(t => t.id) } }, data: { revokedAt: new Date() } });
  }
  if (activeTokens.length === 0 || args.rotateToken) {
    plaintext = newToken();
    await prisma.scopedToken.create({
      data: { orgId: org.id, matchId: match.id, type: "CONTROL", tokenHash: hashToken(plaintext), label: SMOKE_TOKEN_LABEL },
    });
  }

  console.log("\napplied.");
  printIds(args.env, org.id, match.id, match.displayToken ?? undefined, plaintext);
  await prisma.$disconnect();
}

function printIds(env: "prod" | "uat" | "local", orgId: string, matchId: string, displayToken: string | undefined, controlToken: string | undefined) {
  const n = githubNames(env);
  console.log("\n─── GitHub Actions config ─────────────────────────────");
  console.log("Variables (not secret):");
  console.log(`  gh variable set ${n.orgId} --body ${orgId}`);
  console.log(`  gh variable set ${n.matchId} --body ${matchId}`);
  console.log("Secrets:");
  console.log(displayToken ? `  gh secret set ${n.displayToken} --body ${displayToken}` : "  (match has no display token yet)");
  console.log(controlToken
    ? `  gh secret set ${n.controlToken} --body ${controlToken}     # shown ONCE — only its hash is stored`
    : `  ${n.controlToken}: not shown (only a hash is stored). Re-run with --apply --rotate-token to issue a new one.`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
