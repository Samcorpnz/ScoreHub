import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { getAccountForOrg } from "@/lib/account";
import { buildResultsCsv } from "@/lib/resultsCsv";

// Downloads this org's ended matches as a CSV of results, for loading into
// whatever runs the competition (a spreadsheet, or a competition platform's
// results import). Takes the same sport/competition/q filters as the matches
// list, so the file matches what the dashboard's History tab is showing.
//
// Gated to pro/venue plans, the counterpart of fixture upload (bulk/route.ts).
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const account = await getAccountForOrg(orgId);
  if (!account || !["pro", "venue"].includes(account.plan)) {
    return NextResponse.json(
      { error: "This feature requires the Pro or Venue plan — upgrade at /account/billing" },
      { status: 403 }
    );
  }

  const { searchParams } = req.nextUrl;
  const sport = searchParams.get("sport") ?? undefined;
  const competition = searchParams.get("competition") ?? undefined;
  const q = searchParams.get("q")?.trim();

  const matches = await prisma.match.findMany({
    where: {
      orgId,
      status: "ENDED",
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
      id: true, sport: true, competition: true, homeName: true, visitorName: true,
      scheduledAt: true, endedAt: true, state: true,
    },
    orderBy: [{ endedAt: "asc" }],
  });

  return new NextResponse(buildResultsCsv(matches), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scorehub-results-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
