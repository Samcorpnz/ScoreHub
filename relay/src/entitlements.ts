import { Request, Response, NextFunction } from "express";
import { prisma, recordAuditEvent } from "@scorehub/db";
import { logger } from "./logger";

function logPermissionDenied(orgId: string, reason: string, extra?: Record<string, unknown>): void {
  logger.warn("permission.denied", { orgId, reason, ...extra });
  recordAuditEvent({
    eventType: "permission.denied",
    orgId,
    message: reason,
    metadata: { reason, ...extra },
  });
}

// Thrown by persistence.ts when a Free-tier account tries to bring up a
// second concurrent live match across any of its orgs. Caught at the HTTP
// route / socket call sites that can trigger match creation.
export class ConcurrentMatchLimitError extends Error {
  constructor() {
    super("Free plan allows one live match at a time across your account — upgrade to Pro for concurrent matches");
    this.name = "ConcurrentMatchLimitError";
  }
}

interface OrgAccount {
  accountId: string;
  plan: string;
  addOns: string[];
}

// In legacy single-tenant mode (no DATABASE_URL — self-hosted, no billing
// system at all) there's nothing to gate, so callers get an unrestricted
// result rather than being locked to "free".
export async function getOrgAccount(orgId: string): Promise<OrgAccount | null> {
  if (!process.env.DATABASE_URL) return null;
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { accountId: true, account: { select: { plan: true, addOns: true } } },
  });
  if (!org) return null;
  return { accountId: org.accountId, plan: org.account.plan, addOns: org.account.addOns };
}

// Used both by requireAddOn (HTTP) and directly at socket-auth time (the
// graphics token/socket handshake can't run Express middleware) — legacy
// single-tenant mode has no add-on concept, so it's unrestricted there too,
// same as requirePlan.
export async function orgHasAddOn(orgId: string, name: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true;
  const account = await getOrgAccount(orgId);
  return account?.addOns.includes(name) ?? false;
}

// Plans that unlock display branding (logos, theme) and drop the Free-tier
// "Powered by ScoreHub" watermark (SA-31/SA-32).
export const BRANDING_PLANS = ["pro", "venue"];

// Plan counterpart to orgHasAddOn, for call sites that can't run requirePlan
// as Express middleware (socket handlers, public display endpoints).
// Unrestricted in legacy single-tenant mode, same as requirePlan.
export async function orgHasPlan(orgId: string, allowed: string[]): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true;
  const account = await getOrgAccount(orgId);
  return account !== null && allowed.includes(account.plan);
}

function upgradeMessage(allowed: string[]): string {
  const names = allowed.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" or ");
  return `This feature requires the ${names} plan — upgrade at /account/billing`;
}

function addOnUpgradeMessage(name: string): string {
  return `This feature requires the ${name} add-on — upgrade at /account/billing`;
}

// Express middleware factory gating a route behind one or more plans. Must
// run after controlAuth, which sets req.orgId — and, per the Phase 3
// rate-limiting bug, after controlRateLimit too, so unauthenticated requests
// are still throttled before any of this runs.
export function requirePlan(allowed: string[]) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!process.env.DATABASE_URL) {
      next();
      return;
    }
    const orgId = (req as any).orgId as string | undefined;
    if (!orgId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const account = await getOrgAccount(orgId);
    if (!account || !allowed.includes(account.plan)) {
      logPermissionDenied(orgId, "plan_not_allowed", { allowed, plan: account?.plan, path: req.path });
      res.status(403).json({ error: upgradeMessage(allowed) });
      return;
    }
    next();
  };
}

// Express middleware factory gating a route behind a named add-on (orthogonal
// to `plan` — see Account.addOns). Same ordering requirement as requirePlan:
// after controlAuth (needs req.orgId) and controlRateLimit.
export function requireAddOn(name: string) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!process.env.DATABASE_URL) {
      next();
      return;
    }
    const orgId = (req as any).orgId as string | undefined;
    if (!orgId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!(await orgHasAddOn(orgId, name))) {
      logPermissionDenied(orgId, "addon_not_active", { addOn: name, path: req.path });
      res.status(403).json({ error: addOnUpgradeMessage(name) });
      return;
    }
    next();
  };
}
