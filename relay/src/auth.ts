import { jwtVerify } from "jose";
import crypto from "node:crypto";
import { prisma, recordAuditEvent } from "@scorehub/db";
import { logger } from "./logger";

// Logged (not just returned as null) only for a secret that was actually
// presented and failed validation — an absent header is the normal shape of
// most unauthenticated requests and would drown genuine signal in noise.
function logAuthFailure(fn: string, reason: string, extra?: Record<string, unknown>): void {
  logger.warn("auth.failure", { fn, reason, ...extra });
  recordAuditEvent({
    eventType: "auth.failure",
    orgId: typeof extra?.orgId === "string" ? extra.orgId : undefined,
    message: `${fn}: ${reason}`,
    metadata: { fn, reason, ...extra },
  });
}

// Used when DATABASE_URL is unset (local dev / Jest) — every connection
// shares one room, matching the relay's original single-tenant behaviour.
export const LEGACY_ROOM_ID = "legacy-single-tenant";

export interface AuthResult {
  orgId: string;
  matchId?: string;
  // Set only for JWT-authenticated control connections (the JWT's `sub`
  // claim, i.e. the logged-in user's id) — used by the relay's controller
  // mutex to recognize a page-navigation handoff (same operator, new socket)
  // vs. a genuinely different controller. Absent for legacy shared-secret
  // auth and ScopedToken callers, where there's no reliable per-user identity.
  userId?: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Constant-time secret comparison for the legacy (no-DB) auth path. Hashing
// first guarantees equal-length buffers for timingSafeEqual and avoids leaking
// the secret's length via an early length-mismatch return.
function secretsEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Bridge devices can't do an interactive login, so they authenticate with a
// long-lived per-org token (see POST /api/orgs/[orgId]/tokens in the frontend).
// Only its SHA-256 hash is ever stored.
export async function verifyBridgeSecret(
  secret: string | undefined,
  legacySecret: string
): Promise<AuthResult | null> {
  if (!secret) return null;

  if (!process.env.DATABASE_URL) {
    if (secretsEqual(secret, legacySecret)) return { orgId: LEGACY_ROOM_ID };
    logAuthFailure("verifyBridgeSecret", "legacy_secret_mismatch");
    return null;
  }

  const token = await prisma.scopedToken.findUnique({ where: { tokenHash: hashToken(secret) } });
  if (token?.type !== "BRIDGE" || token?.revokedAt) {
    logAuthFailure("verifyBridgeSecret", token ? "wrong_type_or_revoked" : "token_not_found", { orgId: token?.orgId });
    return null;
  }
  return { orgId: token.orgId, matchId: token.matchId ?? undefined };
}

// Stream Deck / Control API callers use a long-lived CONTROL ScopedToken (or a
// short-lived control JWT) to authenticate action endpoints without a session.
export async function verifyActionSecret(
  secret: string | undefined,
  legacySecret: string
): Promise<AuthResult | null> {
  if (!secret) return null;

  if (!process.env.DATABASE_URL) {
    return secretsEqual(secret, legacySecret) ? { orgId: LEGACY_ROOM_ID } : null;
  }

  // Accept long-lived CONTROL ScopedTokens first (Stream Deck use-case).
  const token = await prisma.scopedToken.findUnique({ where: { tokenHash: hashToken(secret) } });
  if (token?.type === "CONTROL" && !token?.revokedAt) {
    return { orgId: token.orgId, matchId: token.matchId ?? undefined };
  }

  // Also accept short-lived control JWTs so the operator can test endpoints
  // directly from the control panel without needing a separate token.
  return verifyControlSecret(secret, legacySecret);
}

// The control panel authenticates with a short-lived JWT minted by the
// frontend's /api/control-token route from the logged-in user's session —
// not a long-lived shared secret. Requires ADMIN/OPERATOR role.
export async function verifyControlSecret(
  secret: string | undefined,
  legacySecret: string
): Promise<AuthResult | null> {
  if (!secret) return null;

  if (!process.env.DATABASE_URL) {
    if (secretsEqual(secret, legacySecret)) return { orgId: LEGACY_ROOM_ID };
    logAuthFailure("verifyControlSecret", "legacy_secret_mismatch");
    return null;
  }

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    // Misconfigured multi-tenant deployment — fail closed, but this is a
    // deploy-config bug worth surfacing loudly rather than the usual
    // best-effort audit log (every request will fail identically until fixed).
    logger.error("auth.misconfigured", { fn: "verifyControlSecret", reason: "AUTH_SECRET unset" });
    return null;
  }

  try {
    const key = new TextEncoder().encode(authSecret);
    const { payload } = await jwtVerify(secret, key);
    const orgId = payload.orgId as string | undefined;
    const role = payload.role as string | undefined;
    const matchId = payload.matchId as string | undefined;
    if (!orgId || !["ADMIN", "MANAGER", "OPERATOR"].includes(role ?? "")) {
      logAuthFailure("verifyControlSecret", "invalid_role_or_missing_org", { orgId, role, userId: payload.sub });
      return null;
    }
    return { orgId, matchId, userId: payload.sub };
  } catch {
    logAuthFailure("verifyControlSecret", "jwt_verify_failed");
    return null;
  }
}

// Data Feed add-on persona: third-party consumers (Singular.live, VIZRT, a
// physical console's own read-back if it ever needs one) that can't do an
// interactive login. Long-lived DATA_FEED ScopedToken only — unlike
// verifyGraphicsSecret there's no JWT fallback, since this credential is
// never minted for ScoreHub's own UI, only for the org's Settings-tab token
// generation flow (see POST /api/orgs/[orgId]/tokens).
export async function verifyDataFeedSecret(
  secret: string | undefined,
  legacySecret: string
): Promise<AuthResult | null> {
  if (!secret) return null;

  if (!process.env.DATABASE_URL) {
    if (secretsEqual(secret, legacySecret)) return { orgId: LEGACY_ROOM_ID };
    logAuthFailure("verifyDataFeedSecret", "legacy_secret_mismatch");
    return null;
  }

  const token = await prisma.scopedToken.findUnique({ where: { tokenHash: hashToken(secret) } });
  if (token?.type !== "DATA_FEED" || token?.revokedAt) {
    logAuthFailure("verifyDataFeedSecret", token ? "wrong_type_or_revoked" : "token_not_found", { orgId: token?.orgId });
    return null;
  }
  return { orgId: token.orgId, matchId: token.matchId ?? undefined };
}

// Graphics Operator add-on persona. Deliberately separate from
// verifyControlSecret even though it accepts the same two credential shapes
// (long-lived GRAPHICS ScopedToken, or a short-lived JWT minted by the
// frontend's /api/graphics-token route) — a graphics-scoped connection must
// NEVER be treated as a control connection by server.ts's socket handlers.
// This is the auth-layer half of that boundary; server.ts additionally never
// registers scoring-mutation listeners (manualUpdate, stateUpdate,
// cricket:*, undo, resetMatch) for a socket authenticated via this function.
export async function verifyGraphicsSecret(
  secret: string | undefined,
  legacySecret: string
): Promise<AuthResult | null> {
  if (!secret) return null;

  if (!process.env.DATABASE_URL) {
    if (secretsEqual(secret, legacySecret)) return { orgId: LEGACY_ROOM_ID };
    logAuthFailure("verifyGraphicsSecret", "legacy_secret_mismatch");
    return null;
  }

  const token = await prisma.scopedToken.findUnique({ where: { tokenHash: hashToken(secret) } });
  if (token?.type === "GRAPHICS" && !token?.revokedAt) {
    return { orgId: token.orgId, matchId: token.matchId ?? undefined };
  }

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    logger.error("auth.misconfigured", { fn: "verifyGraphicsSecret", reason: "AUTH_SECRET unset" });
    return null;
  }

  try {
    const key = new TextEncoder().encode(authSecret);
    const { payload } = await jwtVerify(secret, key);
    const orgId = payload.orgId as string | undefined;
    const role = payload.role as string | undefined;
    const matchId = payload.matchId as string | undefined;
    if (!orgId || role !== "graphics") {
      logAuthFailure("verifyGraphicsSecret", "invalid_role_or_missing_org", { orgId, role });
      return null;
    }
    return { orgId, matchId };
  } catch {
    logAuthFailure("verifyGraphicsSecret", "jwt_verify_failed", { orgId: token?.orgId });
    return null;
  }
}
