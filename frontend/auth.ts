import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { prisma, Role, recordAuditEvent } from "@scorehub/db";
import { isRateLimited, clientIp } from "@/lib/rateLimit";
import { consumeChallenge, expectedOrigin, rpID } from "@/lib/webauthn";
import { logger } from "@/lib/logger";

// Logged only for a login attempt that was actually made (an email+password
// or a credential was presented) and failed — not for the "form submitted
// empty" case, which is client-side validation noise, not a security event.
function logLoginFailure(provider: "credentials" | "passkey", reason: string, extra?: Record<string, unknown>): void {
  logger.warn("auth.failure", { provider, reason, ...extra });
  recordAuditEvent({
    eventType: "auth.failure",
    actor: typeof extra?.email === "string" ? extra.email : undefined,
    message: `login failed via ${provider}: ${reason}`,
    metadata: { provider, reason, ...extra },
  });
}

export type SessionMembership = {
  orgId: string;
  orgName: string;
  role: Role;
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      memberships: SessionMembership[];
      activeOrgId: string | null;
      activeRole: Role | null;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    memberships?: SessionMembership[];
    activeOrgId?: string | null;
  }
}

/**
 * Users are real, DB-backed accounts created via /signup (see
 * app/api/signup/route.ts) or by accepting an invitation (see
 * app/api/invitations/accept/route.ts). Passwords are hashed with bcrypt.
 *
 * A user can belong to multiple orgs (one Membership row per org). The JWT
 * carries the full membership list plus an `activeOrgId` pointer; the
 * session exposes the active org's role as `activeRole`. Switching orgs goes
 * through POST /api/session/switch-org, which re-verifies the membership
 * against the DB before updating the JWT — the membership list cached in
 * the token is never trusted for the switch itself, only for display/picker
 * purposes.
 *
 * Env var: AUTH_SECRET — also shared with the relay so it can verify
 * control-panel tokens minted by /api/control-token.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        // Throttle by IP+email so credential stuffing against one account
        // from one source can't run unbounded (SA-81).
        const key = `login:${clientIp(request)}:${email.toLowerCase()}`;
        if (isRateLimited(key, 10, 60_000)) {
          logLoginFailure("credentials", "rate_limited", { email });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { memberships: { include: { org: true } } },
        });
        if (!user) {
          logLoginFailure("credentials", "unknown_email", { email });
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          logLoginFailure("credentials", "wrong_password", { email, userId: user.id });
          return null;
        }

        const memberships: SessionMembership[] = user.memberships.map((m) => ({
          orgId: m.orgId,
          orgName: m.org.name,
          role: m.role,
        }));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          memberships,
          activeOrgId: memberships[0]?.orgId ?? null,
        };
      },
    }),
    // SA-108: passkey sign-in. Verification happens here (in-process, same as
    // the credentials provider above calling bcrypt.compare directly) rather
    // than via a separate "verify" API route, so it returns the same user
    // shape the credentials provider does and rides the same jwt/session
    // callbacks below unchanged. The frontend calls
    // signIn("passkey", { credential: JSON.stringify(assertionResponse) })
    // after /api/webauthn/authenticate/options + @simplewebauthn/browser's
    // startAuthentication() produce that assertion.
    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: { credential: { label: "Credential", type: "text" } },
      async authorize(credentials, request) {
        const raw = typeof credentials?.credential === "string" ? credentials.credential : undefined;
        if (!raw) return null;

        const key = `login-passkey:${clientIp(request)}`;
        if (isRateLimited(key, 10, 60_000)) {
          logLoginFailure("passkey", "rate_limited");
          return null;
        }

        let response: AuthenticationResponseJSON;
        try {
          response = JSON.parse(raw);
        } catch {
          logLoginFailure("passkey", "malformed_credential");
          return null;
        }

        const authenticator = await prisma.authenticator.findUnique({
          where: { credentialId: response.id },
          include: { user: { include: { memberships: { include: { org: true } } } } },
        });
        if (!authenticator) {
          logLoginFailure("passkey", "unknown_credential");
          return null;
        }

        let clientData: { challenge?: string };
        try {
          clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
        } catch {
          logLoginFailure("passkey", "malformed_client_data", { userId: authenticator.userId });
          return null;
        }
        if (!clientData.challenge) {
          logLoginFailure("passkey", "missing_challenge", { userId: authenticator.userId });
          return null;
        }

        const challengeRow = await consumeChallenge(clientData.challenge, "authentication");
        if (!challengeRow) {
          logLoginFailure("passkey", "expired_or_replayed_challenge", { userId: authenticator.userId });
          return null;
        }

        let verification;
        try {
          verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: clientData.challenge,
            expectedOrigin: expectedOrigin(),
            expectedRPID: rpID(),
            credential: {
              id: authenticator.credentialId,
              publicKey: Buffer.from(authenticator.publicKey, "base64url"),
              counter: Number(authenticator.counter),
              transports: authenticator.transports as AuthenticatorTransport[],
            },
          });
        } catch {
          logLoginFailure("passkey", "verification_error", { userId: authenticator.userId });
          return null;
        }
        if (!verification.verified) {
          logLoginFailure("passkey", "verification_failed", { userId: authenticator.userId });
          return null;
        }

        await prisma.authenticator.update({
          where: { id: authenticator.id },
          data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
        });

        const user = authenticator.user;
        const memberships: SessionMembership[] = user.memberships.map((m) => ({
          orgId: m.orgId,
          orgName: m.org.name,
          role: m.role,
        }));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          memberships,
          activeOrgId: memberships[0]?.orgId ?? null,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60, // 12 hours
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.memberships = (user as { memberships: SessionMembership[] }).memberships;
        token.activeOrgId = (user as { activeOrgId: string | null }).activeOrgId;
      }
      // Org switching: POST /api/session/switch-org re-verifies the target
      // membership against the DB, then the client calls useSession().update()
      // with the new orgId. Re-fetch the membership list from the DB here
      // too (rather than trusting the token's own cached list) — a brand
      // new membership granted mid-session wouldn't be in the cached list
      // yet, so checking against it would make switching into a just-added
      // org silently fail until the next full login.
      if (trigger === "update" && session?.activeOrgId && token.sub) {
        const memberships = await prisma.membership.findMany({
          where: { userId: token.sub },
          include: { org: true },
        });
        const fresh: SessionMembership[] = memberships.map((m) => ({
          orgId: m.orgId,
          orgName: m.org.name,
          role: m.role,
        }));
        if (fresh.some((m) => m.orgId === session.activeOrgId)) {
          token.memberships = fresh;
          token.activeOrgId = session.activeOrgId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.memberships = token.memberships ?? [];
      session.user.activeOrgId = token.activeOrgId ?? null;
      session.user.activeRole =
        session.user.memberships.find((m) => m.orgId === session.user.activeOrgId)?.role ?? null;
      return session;
    },
  },
});
