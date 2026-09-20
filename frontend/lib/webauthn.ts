import { prisma } from "@scorehub/db";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min — a synchronous in-flight ceremony, not an email link

export type WebAuthnChallengePurpose = "registration" | "authentication";

// WebAuthn's RP ID must be a registrable domain suffix of the origin the
// ceremony ran on (no scheme/port). Reusing NEXTAUTH_URL (already
// environment-specific: localhost in dev, uat/prod domains elsewhere) means
// no new env var, and each environment naturally gets its own scoped
// credentials — a passkey registered against localhost won't authenticate
// against prod, which is correct.
export function rpID(): string {
  return new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").hostname;
}

export function expectedOrigin(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export const rpName = "ScoreHub";

// COSE algorithms accepted for new passkeys: EdDSA, ES256, RS256 — the
// @simplewebauthn/server v13 defaults. v14 additionally prefers post-quantum
// ML-DSA-44 first whenever the runtime supports it, which would make the
// algorithm of newly registered passkeys depend on the deploy's Node version.
// Pin explicitly and opt in to PQC deliberately, not via a dependency bump.
export const supportedAlgorithmIDs = [-8, -7, -257];

export async function createChallenge(
  challenge: string,
  purpose: WebAuthnChallengePurpose,
  userId: string | null,
): Promise<void> {
  await prisma.webAuthnChallenge.create({
    data: { challenge, purpose, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

// Consumes (deletes) a matching, unexpired challenge for the given purpose.
// Returns null if not found/expired/wrong purpose — callers must treat null
// as "reject the ceremony", not retry.
export async function consumeChallenge(
  challenge: string,
  purpose: WebAuthnChallengePurpose,
): Promise<{ userId: string | null } | null> {
  const row = await prisma.webAuthnChallenge.findUnique({ where: { challenge } });
  if (!row || row.purpose !== purpose || row.expiresAt < new Date()) return null;
  await prisma.webAuthnChallenge.delete({ where: { id: row.id } });
  return { userId: row.userId };
}
