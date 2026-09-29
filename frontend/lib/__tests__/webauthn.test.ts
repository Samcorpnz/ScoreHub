// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findUniqueMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    webAuthnChallenge: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      delete: (...a: unknown[]) => deleteMock(...a),
    },
  },
}));

import { rpID, expectedOrigin, rpName, supportedAlgorithmIDs, createChallenge, consumeChallenge } from "../webauthn";

describe("webauthn helpers", () => {
  const originalUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    findUniqueMock.mockReset();
    createMock.mockReset();
    deleteMock.mockReset();
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = originalUrl;
  });

  describe("rpID", () => {
    it("returns the hostname of NEXTAUTH_URL", () => {
      process.env.NEXTAUTH_URL = "https://app.scorehub.co.nz";
      expect(rpID()).toBe("app.scorehub.co.nz");
    });

    it("strips a port from a localhost URL", () => {
      process.env.NEXTAUTH_URL = "http://localhost:3000";
      expect(rpID()).toBe("localhost");
    });

    it("falls back to localhost when NEXTAUTH_URL is unset", () => {
      delete process.env.NEXTAUTH_URL;
      expect(rpID()).toBe("localhost");
    });
  });

  describe("expectedOrigin", () => {
    it("returns NEXTAUTH_URL verbatim", () => {
      process.env.NEXTAUTH_URL = "https://uat.scorehub.co.nz";
      expect(expectedOrigin()).toBe("https://uat.scorehub.co.nz");
    });

    it("falls back to http://localhost:3000 when unset", () => {
      delete process.env.NEXTAUTH_URL;
      expect(expectedOrigin()).toBe("http://localhost:3000");
    });
  });

  it("supportedAlgorithmIDs is pinned to EdDSA/ES256/RS256 — no post-quantum ML-DSA (-48/-49/-50)", () => {
    expect(supportedAlgorithmIDs).toEqual([-8, -7, -257]);
  });

  it("rpName is a fixed constant", () => {
    expect(rpName).toBe("ScoreHub");
  });

  describe("createChallenge", () => {
    it("creates a row with the given purpose/userId and a future expiry", async () => {
      await createChallenge("chal123", "registration", "user-1");
      expect(createMock).toHaveBeenCalledTimes(1);
      const arg = createMock.mock.calls[0][0];
      expect(arg.data.challenge).toBe("chal123");
      expect(arg.data.purpose).toBe("registration");
      expect(arg.data.userId).toBe("user-1");
      expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("allows a null userId (usernameless login flow)", async () => {
      await createChallenge("chal456", "authentication", null);
      expect(createMock.mock.calls[0][0].data.userId).toBeNull();
    });
  });

  describe("consumeChallenge", () => {
    it("returns null when no matching row exists", async () => {
      findUniqueMock.mockResolvedValue(null);
      const result = await consumeChallenge("missing", "authentication");
      expect(result).toBeNull();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("returns null when the purpose doesn't match", async () => {
      findUniqueMock.mockResolvedValue({
        id: "row-1",
        purpose: "registration",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
      });
      const result = await consumeChallenge("chal123", "authentication");
      expect(result).toBeNull();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("returns null when the row has expired", async () => {
      findUniqueMock.mockResolvedValue({
        id: "row-1",
        purpose: "authentication",
        userId: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      const result = await consumeChallenge("chal123", "authentication");
      expect(result).toBeNull();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("deletes and returns the userId on a valid match", async () => {
      findUniqueMock.mockResolvedValue({
        id: "row-1",
        purpose: "registration",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
      });
      const result = await consumeChallenge("chal123", "registration");
      expect(result).toEqual({ userId: "user-1" });
      expect(deleteMock).toHaveBeenCalledWith({ where: { id: "row-1" } });
    });
  });
});
