import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma, MatchStatus } from "@scorehub/db";
import { auth } from "@/auth";
import { canRunMatches } from "@/lib/roles";

// Server-side fetch — needs the relay's address as reachable from this
// process (e.g. Docker's internal `http://relay:4000`), which can differ
// from NEXT_PUBLIC_RELAY_URL (baked into client bundles for the browser).
const RELAY_URL = process.env.RELAY_INTERNAL_URL ?? process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

// Always creates a brand-new LIVE match via the relay (which owns the
// free-tier concurrent-match entitlement check and the live state cache) —
// see relay/src/server.ts POST /match. Mints a short-lived control JWT
// inline rather than round-tripping through /api/control-token since this
// route already has the session in hand.
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canRunMatches(session.user.activeRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    return NextResponse.json({ error: "AUTH_SECRET is not configured" }, { status: 500 });
  }
  const secret = await new SignJWT({ orgId, role: session.user.activeRole })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authSecret));

  const res = await fetch(`${RELAY_URL}/match`, {
    method: "POST",
    headers: { "x-control-secret": secret },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: body?.error ?? "failed to create match" }, { status: res.status });
  }

  return NextResponse.json({ id: body.id });
}

// Lists this org's matches for the /dashboard hub — Upcoming/Live/History
// tabs and the sport/competition filters all go through this one query.
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get("status");
  const sport = searchParams.get("sport") ?? undefined;
  const competition = searchParams.get("competition") ?? undefined;
  const q = searchParams.get("q")?.trim();
  const id = searchParams.get("id") ?? undefined;

  const statuses = statusParam
    ?.split(",")
    .map(s => s.trim().toUpperCase())
    .filter((s): s is MatchStatus => s === "SCHEDULED" || s === "LIVE" || s === "ENDED");

  const matches = await prisma.match.findMany({
    where: {
      orgId,
      ...(id ? { id } : {}),
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(sport ? { sport } : {}),
      ...(competition ? { competition } : {}),
      ...(q ? {
        OR: [
          { homeName: { contains: q, mode: "insensitive" } },
          { visitorName: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    },
    select: {
      id: true, status: true, sport: true, competition: true,
      homeName: true, visitorName: true, scheduledAt: true, createdAt: true, endedAt: true, displayToken: true,
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ matches });
}
