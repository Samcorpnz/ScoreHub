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

const authenticatorCreateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: { authenticator: { create: (...a: unknown[]) => authenticatorCreateMock(...a) } },
  recordAuditEvent: vi.fn(),
}));

const verifyRegistrationResponseMock = vi.fn();
vi.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: (...a: unknown[]) => verifyRegistrationResponseMock(...a),
}));

const consumeChallengeMock = vi.fn();
vi.mock("@/lib/webauthn", () => ({
  consumeChallenge: (...a: unknown[]) => consumeChallengeMock(...a),
  rpID: () => "localhost",
  expectedOrigin: () => "http://localhost:3000",
  supportedAlgorithmIDs: [-8, -7, -257],
}));

function validClientDataJSON(challenge: string) {
  return Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: "http://localhost:3000" })).toString(
    "base64url",
  );
}

function makeResponse(overrides: { clientDataJSON?: string; transports?: string[] } = {}) {
  return {
    id: "cred-1",
    response: {
      clientDataJSON: overrides.clientDataJSON ?? validClientDataJSON("chal-1"),
      transports: overrides.transports ?? ["internal"],
    },
  };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/webauthn/register/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/webauthn/register/verify", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    isRateLimitedMock.mockReset().mockReturnValue(false);
    authenticatorCreateMock.mockReset();
    verifyRegistrationResponseMock.mockReset();
    consumeChallengeMock.mockReset();
    authMock.mockResolvedValue({ user: { id: "u1" } });
  });

  it("401s when not logged in", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse() }));
    expect(res.status).toBe(401);
  });

  it("429s when rate-limited", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse() }));
    expect(res.status).toBe(429);
  });

  it("400s when response is missing", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("400s on unparseable JSON body", async () => {
    const req = new NextRequest("http://localhost/api/webauthn/register/verify", { method: "POST", body: "not json" });
    const { POST } = await import("../route");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400s when clientDataJSON has no challenge", async () => {
    const badClientData = Buffer.from(JSON.stringify({ type: "webauthn.create" })).toString("base64url");
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse({ clientDataJSON: badClientData }) }));
    expect(res.status).toBe(400);
    expect(consumeChallengeMock).not.toHaveBeenCalled();
  });

  it("400s when the challenge is expired/unknown", async () => {
    consumeChallengeMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse() }));
    expect(res.status).toBe(400);
    expect(verifyRegistrationResponseMock).not.toHaveBeenCalled();
  });

  it("400s when the challenge belongs to a different user", async () => {
    consumeChallengeMock.mockResolvedValue({ userId: "someone-else" });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse() }));
    expect(res.status).toBe(400);
    expect(verifyRegistrationResponseMock).not.toHaveBeenCalled();
  });

  it("400s when verification is not verified", async () => {
    consumeChallengeMock.mockResolvedValue({ userId: "u1" });
    verifyRegistrationResponseMock.mockResolvedValue({ verified: false });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse() }));
    expect(res.status).toBe(400);
    expect(authenticatorCreateMock).not.toHaveBeenCalled();
  });

  it("400s when verifyRegistrationResponse throws", async () => {
    consumeChallengeMock.mockResolvedValue({ userId: "u1" });
    verifyRegistrationResponseMock.mockRejectedValue(new Error("bad attestation"));
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse() }));
    expect(res.status).toBe(400);
  });

  it("creates the authenticator and returns its id on success", async () => {
    consumeChallengeMock.mockResolvedValue({ userId: "u1" });
    verifyRegistrationResponseMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "cred-1", publicKey: Buffer.from("pubkey"), counter: 0 },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });
    authenticatorCreateMock.mockResolvedValue({ id: "auth-1", name: "My laptop" });

    const { POST } = await import("../route");
    const res = await POST(makeRequest({ response: makeResponse(), name: "My laptop" }));

    expect(verifyRegistrationResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportedAlgorithmIDs: [-8, -7, -257] }),
    );
    expect(authenticatorCreateMock).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        credentialId: "cred-1",
        publicKey: Buffer.from("pubkey").toString("base64url"),
        counter: BigInt(0),
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        name: "My laptop",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", id: "auth-1", name: "My laptop" });
  });
});
