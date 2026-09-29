import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { isRateLimited } from "@/lib/rateLimit";
import { createChallenge, rpID, rpName, supportedAlgorithmIDs } from "@/lib/webauthn";

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isRateLimited(`webauthn-register-options:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { authenticators: true },
  });
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpID(),
    userID: Buffer.from(user.id, "utf8"),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    supportedAlgorithmIDs,
    excludeCredentials: user.authenticators.map((a) => ({
      id: a.credentialId,
      transports: a.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await createChallenge(options.challenge, "registration", session.user.id);

  return NextResponse.json(options);
}
