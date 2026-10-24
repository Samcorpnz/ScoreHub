import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@scorehub/db";
import { isRateLimited, clientIp } from "@/lib/rateLimit";
import { hashLinkToken, invalidLinkResponse, isLinkUsable, readTokenAndPassword, tokenFromQuery } from "@/lib/linkToken";

// Looks up a pending reset request by token (without consuming it) so the
// reset page can confirm the link is still valid before asking for a
// password. Deliberately doesn't return which email it belongs to.
export async function GET(req: NextRequest) {
  const token = tokenFromQuery(req);
  if (token instanceof NextResponse) return token;
  const resetRequest = await prisma.passwordResetRequest.findUnique({ where: { tokenHash: hashLinkToken(token) } });
  if (!isLinkUsable(resetRequest)) return invalidLinkResponse("reset");

  return NextResponse.json({ status: "valid" });
}

// Deliberately no auth() requirement — the token (only ever sent to the
// account's own email) is the proof of identity, same reasoning as
// api/invitations/accept/route.ts.
export async function POST(req: NextRequest) {
  if (isRateLimited(`reset-password:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const input = await readTokenAndPassword(req);
  if (input instanceof NextResponse) return input;

  const resetRequest = await prisma.passwordResetRequest.findUnique({ where: { tokenHash: hashLinkToken(input.token) } });
  if (!isLinkUsable(resetRequest)) return invalidLinkResponse("reset");

  const passwordHash = await bcrypt.hash(input.password, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetRequest.userId }, data: { passwordHash } }),
    prisma.passwordResetRequest.update({ where: { id: resetRequest.id }, data: { consumedAt: new Date() } }),
  ]);

  return NextResponse.json({ status: "ok" });
}
