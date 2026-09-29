// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const isRateLimitedMock = vi.fn((..._a: unknown[]) => false);
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...a: unknown[]) => isRateLimitedMock(...a),
  clientIp: () => "127.0.0.1",
}));

const userFindUniqueMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => userFindUniqueMock(...a) } },
}));

const generateRegistrationOptionsMock = vi.fn();
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...a: unknown[]) => generateRegistrationOptionsMock(...a),
}));

const createChallengeMock = vi.fn();
vi.mock("@/lib/webauthn", () => ({
  createChallenge: (...a: unknown[]) => createChallengeMock(...a),
  rpID: () => "localhost",
  rpName: "ScoreHub",
  supportedAlgorithmIDs: [-8, -7, -257],
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/webauthn/register/options", { method: "POST" });
}

describe("POST /api/webauthn/register/options", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    isRateLimitedMock.mockReset().mockReturnValue(false);
    userFindUniqueMock.mockReset();
    generateRegistrationOptionsMock.mockReset();
    createChallengeMock.mockReset();
    authMock.mockResolvedValue({ user: { id: "u1" } });
  });

  it("401s when not logged in", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("429s when rate-limited", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
  });

  it("401s when the session user can't be found", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("passes existing authenticators as excludeCredentials, stores the challenge, and returns options", async () => {
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "A",
      authenticators: [{ credentialId: "cred-1", transports: ["internal"] }],
    });
    generateRegistrationOptionsMock.mockResolvedValue({ challenge: "chal-1", rp: { id: "localhost" } });

    const { POST } = await import("../route");
    const res = await POST(makeRequest());

    expect(generateRegistrationOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: "ScoreHub",
        rpID: "localhost",
        supportedAlgorithmIDs: [-8, -7, -257],
        userName: "a@b.com",
        userDisplayName: "A",
        excludeCredentials: [{ id: "cred-1", transports: ["internal"] }],
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      }),
    );
    expect(createChallengeMock).toHaveBeenCalledWith("chal-1", "registration", "u1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "chal-1", rp: { id: "localhost" } });
  });
});
