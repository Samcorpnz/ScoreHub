import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { allowedSupportOrigin, supportCorsHeaders } from "@/lib/supportCors";

// Tells the help centre's case form who is signed in, so it can show
// "sending as …" or a log-in prompt. Called cross-origin from
// help.scorehub.co.nz with the session cookie — see lib/supportCors.ts.
export async function GET(req: NextRequest) {
  const origin = allowedSupportOrigin(req);
  if (origin === null) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await auth();
  const user = session?.user?.email
    ? {
        name: session.user.name ?? "",
        email: session.user.email,
        organisation:
          session.user.memberships.find((m) => m.orgId === session.user.activeOrgId)?.orgName ?? "",
      }
    : null;

  return NextResponse.json({ user }, { headers: supportCorsHeaders(origin) });
}
