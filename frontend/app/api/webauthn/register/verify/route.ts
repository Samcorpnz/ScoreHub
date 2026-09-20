import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma, recordAuditEvent } from "@scorehub/db";
import { auth } from "@/auth";
import { isRateLimited } from "@/lib/rateLimit";
import { consumeChallenge, expectedOrigin, rpID, supportedAlgorithmIDs } from "@/lib/webauthn";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isRateLimited(`webauthn-register-verify:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const response: RegistrationResponseJSON | undefined =
    body?.response && typeof body.response === "object" ? body.response : undefined;
  const name = typeof body?.name === "string" ? body.name.slice(0, 100) : null;
  if (!response) {
    return NextResponse.json({ error: "response is required" }, { status: 400 });
  }

  let clientData: { challenge?: string };
  try {
    clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid response" }, { status: 400 });
  }
  if (!clientData.challenge) {
    return NextResponse.json({ error: "invalid response" }, { status: 400 });
  }

  const challengeRow = await consumeChallenge(clientData.challenge, "registration");
  if (!challengeRow || challengeRow.userId !== session.user.id) {
    return NextResponse.json({ error: "this registration attempt has expired, please try again" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: clientData.challenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
      supportedAlgorithmIDs,
    });
  } catch (err) {
    // Individual failures are often legitimate (stale/replayed response,
    // wrong device) and not worth alerting on, but log so a systemic issue
    // (e.g. misconfigured RP ID/origin failing every attempt) is traceable.
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("auth.failure", { fn: "webauthn.register.verify", reason, userId: session.user.id });
    recordAuditEvent({
      eventType: "auth.failure",
      userId: session.user.id,
      message: `webauthn registration verification failed: ${reason}`,
      metadata: { fn: "webauthn.register.verify", reason },
    });
    return NextResponse.json({ error: "couldn't verify passkey" }, { status: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    logger.warn("auth.failure", { fn: "webauthn.register.verify", reason: "not_verified", userId: session.user.id });
    recordAuditEvent({
      eventType: "auth.failure",
      userId: session.user.id,
      message: "webauthn registration not verified",
      metadata: { fn: "webauthn.register.verify", reason: "not_verified" },
    });
    return NextResponse.json({ error: "couldn't verify passkey" }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const authenticator = await prisma.authenticator.create({
    data: {
      userId: session.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: BigInt(credential.counter),
      transports: response.response.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name,
    },
  });

  return NextResponse.json({ status: "ok", id: authenticator.id, name: authenticator.name });
}
