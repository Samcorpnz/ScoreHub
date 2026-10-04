import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { canRunMatches } from "@/lib/roles";

// Marks a match ENDED — a plain Prisma write, deliberately decoupled from
// the relay's live socket. The relay's in-memory cache for this match (if
// still warm) gets cleaned up independently when the control panel
// disconnects (see relay/src/server.ts's room-membership eviction).
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; matchId: string }> }) {
  const { orgId, matchId } = await params;
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canRunMatches(session.user.activeRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { orgId: true, status: true } });
  if (match?.orgId !== orgId) {
    return NextResponse.json({ error: "match not found" }, { status: 404 });
  }
  if (match.status === "ENDED") {
    return NextResponse.json({ ok: true });
  }

  await prisma.match.update({ where: { id: matchId }, data: { status: "ENDED", endedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
