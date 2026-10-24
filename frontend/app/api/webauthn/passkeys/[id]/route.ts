import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { isRateLimited } from "@/lib/rateLimit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isRateLimited(`webauthn-passkeys-rename:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : null;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { id } = await params;
  const authenticator = await prisma.authenticator.findUnique({ where: { id } });
  if (authenticator?.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await prisma.authenticator.update({ where: { id }, data: { name } });

  return NextResponse.json({ status: "ok", name: updated.name });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isRateLimited(`webauthn-passkeys-delete:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const { id } = await params;
  const authenticator = await prisma.authenticator.findUnique({ where: { id } });
  // 404 (not 403) when it belongs to someone else, to avoid leaking existence.
  if (authenticator?.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.authenticator.delete({ where: { id } });

  return NextResponse.json({ status: "ok" });
}
