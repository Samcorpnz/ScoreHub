// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the config object passed to NextAuth() and each Credentials()
// provider config (there are two: the password provider and, since SA-108,
// the passkey provider), so we can exercise the authorize/jwt/session
// callbacks directly without going through NextAuth's own request/response
// machinery. Providers are distinguished by `id` — only the passkey
// provider sets one explicitly.
let capturedConfig: any;
let capturedCredentialsConfigs: any[];

vi.mock("next-auth", () => ({
  CredentialsSignin: class extends Error {
    code = "credentials";
  },
  default: (config: unknown) => {
    capturedConfig = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => {
    capturedCredentialsConfigs.push(config);
    return { id: "credentials", type: "credentials", ...(config as object) };
  },
}));

const bcryptCompareMock = vi.fn();
vi.mock("bcryptjs", () => ({
  default: { compare: (...a: unknown[]) => bcryptCompareMock(...a) },
}));

const findUniqueMock = vi.fn();
const findManyMock = vi.fn();
const authenticatorFindUniqueMock = vi.fn();
const authenticatorUpdateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    membership: { findMany: (...a: unknown[]) => findManyMock(...a) },
    authenticator: {
      findUnique: (...a: unknown[]) => authenticatorFindUniqueMock(...a),
      update: (...a: unknown[]) => authenticatorUpdateMock(...a),
    },
  },
  Role: {},
  recordAuditEvent: vi.fn(),
}));

const isRateLimitedMock = vi.fn();
const clientIpMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...a: unknown[]) => isRateLimitedMock(...a),
  clientIp: (...a: unknown[]) => clientIpMock(...a),
}));

const verifyAuthenticationResponseMock = vi.fn();
vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: (...a: unknown[]) => verifyAuthenticationResponseMock(...a),
}));

const consumeChallengeMock = vi.fn();
vi.mock("@/lib/webauthn", () => ({
  consumeChallenge: (...a: unknown[]) => consumeChallengeMock(...a),
  rpID: () => "localhost",
  expectedOrigin: () => "http://localhost:3000",
}));

describe("auth.ts", () => {
  beforeEach(async () => {
    vi.resetModules();
    capturedCredentialsConfigs = [];
    findUniqueMock.mockReset();
    findManyMock.mockReset();
    authenticatorFindUniqueMock.mockReset();
    authenticatorUpdateMock.mockReset();
    bcryptCompareMock.mockReset();
    isRateLimitedMock.mockReset().mockReturnValue(false);
    clientIpMock.mockReset().mockReturnValue("127.0.0.1");
    verifyAuthenticationResponseMock.mockReset();
    consumeChallengeMock.mockReset();
    await import("../auth");
  });

  function passwordProviderConfig() {
    return capturedCredentialsConfigs.find((c) => c.id === undefined);
  }
  function passkeyProviderConfig() {
    return capturedCredentialsConfigs.find((c) => c.id === "passkey");
  }

  describe("authorize", () => {
    function authorize(credentials: unknown) {
      return passwordProviderConfig().authorize(credentials, new Request("http://localhost"));
    }

    it("returns null when email is missing", async () => {
      await expect(authorize({ password: "secret" })).resolves.toBeNull();
    });

    it("returns null when password is missing", async () => {
      await expect(authorize({ email: "a@b.com" })).resolves.toBeNull();
    });

    it("returns null when credentials fields aren't strings", async () => {
      await expect(authorize({ email: 123, password: {} })).resolves.toBeNull();
    });

    it("rate-limits repeated attempts by IP+email", async () => {
      isRateLimitedMock.mockReturnValue(true);
      // Thrown with its own code, so the login page can say "wait a minute"
      // instead of "Invalid email or password." (SA-161).
      await expect(authorize({ email: "a@b.com", password: "secret" })).rejects.toMatchObject({ code: "rate_limited" });
      expect(isRateLimitedMock).toHaveBeenCalledWith("login:127.0.0.1:a@b.com", 10, 60_000);
      expect(findUniqueMock).not.toHaveBeenCalled();
    });

    it("returns null when no user exists for the email", async () => {
      findUniqueMock.mockResolvedValue(null);
      const result = await authorize({ email: "nobody@b.com", password: "secret" });
      expect(result).toBeNull();
    });

    it("returns null when the password doesn't match", async () => {
      findUniqueMock.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: "A",
        passwordHash: "hash",
        memberships: [],
      });
      bcryptCompareMock.mockResolvedValue(false);
      const result = await authorize({ email: "a@b.com", password: "wrong" });
      expect(result).toBeNull();
    });

    it("returns the user with mapped memberships and first org as active on success", async () => {
      findUniqueMock.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: "A",
        passwordHash: "hash",
        memberships: [
          { orgId: "org-1", role: "ADMIN", org: { name: "Org One" } },
          { orgId: "org-2", role: "OPERATOR", org: { name: "Org Two" } },
        ],
      });
      bcryptCompareMock.mockResolvedValue(true);
      const result = await authorize({ email: "a@b.com", password: "correct" });
      expect(result).toEqual({
        id: "u1",
        name: "A",
        email: "a@b.com",
        memberships: [
          { orgId: "org-1", orgName: "Org One", role: "ADMIN" },
          { orgId: "org-2", orgName: "Org Two", role: "OPERATOR" },
        ],
        activeOrgId: "org-1",
      });
    });

    it("sets activeOrgId to null when the user has no memberships", async () => {
      findUniqueMock.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: "A",
        passwordHash: "hash",
        memberships: [],
      });
      bcryptCompareMock.mockResolvedValue(true);
      const result = await authorize({ email: "a@b.com", password: "correct" });
      expect(result).toMatchObject({ activeOrgId: null, memberships: [] });
    });
  });

  describe("passkey provider authorize", () => {
    function authorizePasskey(credentials: unknown) {
      return passkeyProviderConfig().authorize(credentials, new Request("http://localhost"));
    }

    function validClientDataJSON(challenge: string) {
      return Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:3000" })).toString(
        "base64url",
      );
    }

    function assertionCredential(overrides: { id?: string; clientDataJSON?: string } = {}) {
      return {
        id: overrides.id ?? "cred-1",
        response: { clientDataJSON: overrides.clientDataJSON ?? validClientDataJSON("chal-1") },
      };
    }

    it("returns null when credential is missing", async () => {
      await expect(authorizePasskey({})).resolves.toBeNull();
    });

    it("returns null when credential isn't valid JSON", async () => {
      await expect(authorizePasskey({ credential: "not-json" })).resolves.toBeNull();
    });

    it("rate-limits repeated attempts by IP", async () => {
      isRateLimitedMock.mockReturnValue(true);
      await expect(authorizePasskey({ credential: JSON.stringify(assertionCredential()) })).rejects.toMatchObject({ code: "rate_limited" });
      expect(isRateLimitedMock).toHaveBeenCalledWith("login-passkey:127.0.0.1", 10, 60_000);
      expect(authenticatorFindUniqueMock).not.toHaveBeenCalled();
    });

    it("returns null when no authenticator matches the credential id", async () => {
      authenticatorFindUniqueMock.mockResolvedValue(null);
      const result = await authorizePasskey({ credential: JSON.stringify(assertionCredential({ id: "unknown" })) });
      expect(result).toBeNull();
    });

    it("returns null when clientDataJSON has no challenge", async () => {
      authenticatorFindUniqueMock.mockResolvedValue({ id: "auth-1", credentialId: "cred-1" });
      const badClientData = Buffer.from(JSON.stringify({ type: "webauthn.get" })).toString("base64url");
      const result = await authorizePasskey({
        credential: JSON.stringify(assertionCredential({ clientDataJSON: badClientData })),
      });
      expect(result).toBeNull();
      expect(consumeChallengeMock).not.toHaveBeenCalled();
    });

    it("returns null when the challenge is expired/unknown", async () => {
      authenticatorFindUniqueMock.mockResolvedValue({ id: "auth-1", credentialId: "cred-1" });
      consumeChallengeMock.mockResolvedValue(null);
      const result = await authorizePasskey({ credential: JSON.stringify(assertionCredential()) });
      expect(result).toBeNull();
      expect(verifyAuthenticationResponseMock).not.toHaveBeenCalled();
    });

    it("returns null when verification fails", async () => {
      authenticatorFindUniqueMock.mockResolvedValue({
        id: "auth-1",
        credentialId: "cred-1",
        publicKey: Buffer.from("pubkey").toString("base64url"),
        counter: BigInt(5),
        transports: ["internal"],
        user: { id: "u1", email: "a@b.com", name: "A", memberships: [] },
      });
      consumeChallengeMock.mockResolvedValue({ userId: null });
      verifyAuthenticationResponseMock.mockResolvedValue({ verified: false });
      const result = await authorizePasskey({ credential: JSON.stringify(assertionCredential()) });
      expect(result).toBeNull();
      expect(authenticatorUpdateMock).not.toHaveBeenCalled();
    });

    it("returns null when verifyAuthenticationResponse throws", async () => {
      authenticatorFindUniqueMock.mockResolvedValue({
        id: "auth-1",
        credentialId: "cred-1",
        publicKey: Buffer.from("pubkey").toString("base64url"),
        counter: BigInt(5),
        transports: ["internal"],
        user: { id: "u1", email: "a@b.com", name: "A", memberships: [] },
      });
      consumeChallengeMock.mockResolvedValue({ userId: null });
      verifyAuthenticationResponseMock.mockRejectedValue(new Error("bad signature"));
      const result = await authorizePasskey({ credential: JSON.stringify(assertionCredential()) });
      expect(result).toBeNull();
    });

    it("updates the counter/lastUsedAt and returns the same user shape as the password provider on success", async () => {
      authenticatorFindUniqueMock.mockResolvedValue({
        id: "auth-1",
        credentialId: "cred-1",
        publicKey: Buffer.from("pubkey").toString("base64url"),
        counter: BigInt(5),
        transports: ["internal"],
        user: {
          id: "u1",
          email: "a@b.com",
          name: "A",
          memberships: [
            { orgId: "org-1", role: "ADMIN", org: { name: "Org One" } },
            { orgId: "org-2", role: "OPERATOR", org: { name: "Org Two" } },
          ],
        },
      });
      consumeChallengeMock.mockResolvedValue({ userId: null });
      verifyAuthenticationResponseMock.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      const result = await authorizePasskey({ credential: JSON.stringify(assertionCredential()) });

      expect(authenticatorUpdateMock).toHaveBeenCalledWith({
        where: { id: "auth-1" },
        data: { counter: BigInt(6), lastUsedAt: expect.any(Date) },
      });
      expect(result).toEqual({
        id: "u1",
        name: "A",
        email: "a@b.com",
        memberships: [
          { orgId: "org-1", orgName: "Org One", role: "ADMIN" },
          { orgId: "org-2", orgName: "Org Two", role: "OPERATOR" },
        ],
        activeOrgId: "org-1",
      });
    });
  });

  describe("jwt callback", () => {
    function jwt(args: any) {
      return capturedConfig.callbacks.jwt(args);
    }

    it("seeds the token from the user object on initial sign-in", async () => {
      const token: any = {};
      const user = {
        memberships: [{ orgId: "org-1", orgName: "Org One", role: "ADMIN" }],
        activeOrgId: "org-1",
      };
      const result = await jwt({ token, user, trigger: "signIn" });
      expect(result.memberships).toEqual(user.memberships);
      expect(result.activeOrgId).toBe("org-1");
    });

    it("leaves the token unchanged when there's no user and no update trigger", async () => {
      const token = { memberships: [{ orgId: "org-1", orgName: "Org One", role: "ADMIN" }], activeOrgId: "org-1" };
      const result = await jwt({ token, user: undefined, trigger: "update" as const, session: undefined });
      expect(result).toBe(token);
    });

    it("re-fetches memberships and switches activeOrgId on a valid org-switch update", async () => {
      const token: any = { sub: "u1", memberships: [], activeOrgId: "org-1" };
      findManyMock.mockResolvedValue([
        { orgId: "org-1", role: "ADMIN", org: { name: "Org One" } },
        { orgId: "org-2", role: "OPERATOR", org: { name: "Org Two" } },
      ]);
      const result = await jwt({
        token,
        user: undefined,
        trigger: "update",
        session: { activeOrgId: "org-2" },
      });
      expect(result.activeOrgId).toBe("org-2");
      expect(result.memberships).toEqual([
        { orgId: "org-1", orgName: "Org One", role: "ADMIN" },
        { orgId: "org-2", orgName: "Org Two", role: "OPERATOR" },
      ]);
    });

    it("ignores an org-switch update to an org the user isn't a member of", async () => {
      const token: any = { sub: "u1", memberships: [{ orgId: "org-1", orgName: "Org One", role: "ADMIN" }], activeOrgId: "org-1" };
      findManyMock.mockResolvedValue([
        { orgId: "org-1", role: "ADMIN", org: { name: "Org One" } },
      ]);
      const result = await jwt({
        token,
        user: undefined,
        trigger: "update",
        session: { activeOrgId: "org-not-a-member" },
      });
      // token.activeOrgId stays as it was — the fresh list didn't contain the target org
      expect(result.activeOrgId).toBe("org-1");
    });

    it("does not query the DB when trigger is 'update' but session has no activeOrgId", async () => {
      const token: any = { sub: "u1", activeOrgId: "org-1" };
      const result = await jwt({ token, user: undefined, trigger: "update", session: {} });
      expect(findManyMock).not.toHaveBeenCalled();
      expect(result.activeOrgId).toBe("org-1");
    });
  });

  describe("session callback", () => {
    function session(args: any) {
      return capturedConfig.callbacks.session(args);
    }

    it("populates session.user from the token, deriving activeRole from the matching membership", async () => {
      const token = {
        sub: "u1",
        memberships: [
          { orgId: "org-1", orgName: "Org One", role: "ADMIN" },
          { orgId: "org-2", orgName: "Org Two", role: "OPERATOR" },
        ],
        activeOrgId: "org-2",
      };
      const result = await session({ session: { user: {} }, token });
      expect(result.user.id).toBe("u1");
      expect(result.user.memberships).toEqual(token.memberships);
      expect(result.user.activeOrgId).toBe("org-2");
      expect(result.user.activeRole).toBe("OPERATOR");
    });

    it("defaults memberships to [] and activeOrgId/activeRole to null when the token has none", async () => {
      const token = { sub: "u1" };
      const result = await session({ session: { user: {} }, token });
      expect(result.user.memberships).toEqual([]);
      expect(result.user.activeOrgId).toBeNull();
      expect(result.user.activeRole).toBeNull();
    });

    it("does not set user.id when the token has no sub", async () => {
      const token = { memberships: [], activeOrgId: null };
      const result = await session({ session: { user: { id: "preexisting" } }, token });
      expect(result.user.id).toBe("preexisting");
    });
  });
});
