import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Generates a per-org bridge credential. The plaintext is returned once and
// never stored — only its SHA-256 hash is persisted (see ScopedToken in
// packages/db/prisma/schema.prisma). The bridge config's BRIDGE_SECRET takes
// this value in place of the old relay-wide shared secret.
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.activeRole !== "ADMIN" && session.user.activeRole !== "MANAGER") {
    return NextResponse.json({ error: "forbidden — admin or manager role required" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label.slice(0, 100) : undefined;
  const matchId = typeof body?.matchId === "string" ? body.matchId : undefined;
  const requestedType = body?.type === "CONTROL" || body?.type === "DATA_FEED" ? body.type : "BRIDGE";
  const type: "BRIDGE" | "CONTROL" | "DATA_FEED" = requestedType;

  // Console bridging and the third-party feed are both the paid Data Feed
  // add-on (SA-114) — the relay enforces the same thing at the bridge and
  // data-feed socket handshakes. Stream Deck (CONTROL) tokens stay ungated.
  if (type === "DATA_FEED" || type === "BRIDGE") {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { account: { select: { addOns: true } } },
    });
    if (!org?.account.addOns.includes("data-feed")) {
      return NextResponse.json(
        { error: "This feature requires the data-feed add-on — upgrade at /account/billing" },
        { status: 403 }
      );
    }
  }

  if (matchId) {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { orgId: true } });
    if (match?.orgId !== orgId) {
      return NextResponse.json({ error: "match not found" }, { status: 404 });
    }
  }

  const plaintext = crypto.randomBytes(32).toString("hex");
  await prisma.scopedToken.create({
    data: { orgId, matchId, type, tokenHash: hashToken(plaintext), label },
  });

  return NextResponse.json({ token: plaintext }, { status: 201 });
}

// Lists this org's bridge tokens (metadata only — the plaintext/hash is
// never returned after creation) so the control panel can show which
// tokens exist and let an admin revoke one (see [tokenId]/route.ts).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tokens = await prisma.scopedToken.findMany({
    where: { orgId },
    select: { id: true, label: true, type: true, matchId: true, createdAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tokens });
}
