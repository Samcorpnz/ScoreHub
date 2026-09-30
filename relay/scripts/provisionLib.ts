// Pure helpers for provision-smoke-org.ts, split out so the safety-critical
// parts (which database are we pointed at, what will change) are unit tested.

import crypto from "node:crypto";

export const SMOKE_ACCOUNT_NAME = "ScoreHub Smoke Test (do not delete)";
export const SMOKE_ORG_NAME = "ScoreHub Smoke Test (do not delete)";
export const SMOKE_TOKEN_LABEL = "smoke-test";

export type TargetEnv = "prod" | "uat" | "local";

export interface ProvisionArgs {
  env: TargetEnv;
  apply: boolean;
  confirmHost?: string;
  rotateToken: boolean;
}

export function parseArgs(argv: string[]): ProvisionArgs {
  const out: ProvisionArgs = { env: "local", apply: false, rotateToken: false };
  let sawEnv = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--env": {
        const v = argv[++i];
        if (v !== "prod" && v !== "uat" && v !== "local") throw new Error(`--env must be prod, uat or local (got ${JSON.stringify(v)})`);
        out.env = v;
        sawEnv = true;
        break;
      }
      case "--apply": out.apply = true; break;
      case "--rotate-token": out.rotateToken = true; break;
      case "--confirm-host": out.confirmHost = argv[++i]; break;
      default: throw new Error(`unknown argument ${JSON.stringify(flag)}`);
    }
  }
  // --env only names the GitHub variables in the output, but forcing an
  // explicit choice stops "I thought I was pointed at UAT" mistakes.
  if (!sawEnv) throw new Error("--env prod|uat|local is required");
  if (out.apply && !out.confirmHost) throw new Error("--apply requires --confirm-host <database host> (printed by a dry run) so writes only ever go to the database you meant");
  return out;
}

// The host (and database name) of a Postgres URL, for display and for the
// --confirm-host check. Never returns credentials.
export function describeDatabase(url: string | undefined): { host: string; database: string } {
  if (!url) throw new Error("DATABASE_URL is not set");
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("DATABASE_URL is not a valid URL"); }
  return { host: u.hostname, database: u.pathname.replace(/^\//, "") };
}

// Env-var names for the GitHub Actions config, per target. Prod uses the bare
// SMOKE_* names, UAT SMOKE_UAT_*.
export function githubNames(env: TargetEnv): { orgId: string; matchId: string; displayToken: string; controlToken: string } {
  const p = env === "uat" ? "SMOKE_UAT_" : "SMOKE_";
  return { orgId: `${p}ORG_ID`, matchId: `${p}MATCH_ID`, displayToken: `${p}DISPLAY_TOKEN`, controlToken: `${p}CONTROL_TOKEN` };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Same shape the frontend's POST /api/orgs/[orgId]/tokens mints: 32 random
// bytes as hex; only the SHA-256 is stored.
export function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function newDisplayToken(): string {
  return crypto.randomBytes(24).toString("hex");
}
