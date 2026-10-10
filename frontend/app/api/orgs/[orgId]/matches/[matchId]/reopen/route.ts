import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { canRunMatches } from "@/lib/roles";
import { getAccountForOrg } from "@/lib/account";

// Puts an ENDED match back to LIVE so its score can be corrected — the
// counterpart to ../end/route.ts, and like it a plain Prisma write. The relay
// refuses changes to an ENDED match (see refreshMatchEnded in
// relay/src/server.ts) and picks the new status up on its next check.
//
// A reopened match is a live match, so it goes through the same Free-tier
// one-live-match gate as starting one (relay/src/persistence.ts).
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
  if (match.status !== "ENDED") {
    return NextResponse.json({ ok: true });
  }

  const account = await getAccountForOrg(orgId);
  if (account?.plan === "free") {
    const liveElsewhere = await prisma.match.count({
      where: { status: "LIVE", org: { accountId: account.id } },
    });
    if (liveElsewhere > 0) {
      return NextResponse.json(
        { error: "Free plan allows one live match at a time across your account — end the match that's live, or upgrade to Pro for concurrent matches" },
        { status: 402 },
      );
    }
  }

  await prisma.match.update({ where: { id: matchId }, data: { status: "LIVE", endedAt: null } });
  return NextResponse.json({ ok: true });
}
