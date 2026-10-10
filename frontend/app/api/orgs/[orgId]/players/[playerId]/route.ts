import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { validatePlayerField } from "@/lib/playerFields";

const GRAPHICS_ROLES = ["ADMIN", "MANAGER", "OPERATOR"] as const;

// Server-to-server calls (Vercel -> Fly) should hit the relay's internal
// address where one is configured — same as the matches route.
const RELAY_URL = process.env.RELAY_INTERNAL_URL ?? process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

async function authorize(orgId: string) {
  const session = await auth();
  if (!session?.user?.activeOrgId || session.user.activeOrgId !== orgId) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }), role: null };
  }
  const role = session.user.activeRole;
  if (!GRAPHICS_ROLES.includes(role as (typeof GRAPHICS_ROLES)[number])) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }), role: null };
  }
  if (process.env.DATABASE_URL) {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { account: { select: { addOns: true } } },
    });
    if (!org?.account.addOns.includes("graphics-operator")) {
      return {
        error: NextResponse.json(
          { error: "This feature requires the graphics-operator add-on — upgrade at /account/billing" },
          { status: 403 }
        ),
        role: null,
      };
    }
  }
  return { error: null, role };
}

// Deletes the player's headshot from storage (SA-160). Storage belongs to the
// relay, so this calls its DELETE /api/player-photo/:playerId with a
// short-lived control token, the same way the matches route calls POST /match.
// Photos are served from public URLs, so removing the Player row alone would
// leave the file reachable by anyone who has the link.
async function deleteStoredPhoto(orgId: string, role: string | null, playerId: string): Promise<boolean> {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) return false;
  try {
    const secret = await new SignJWT({ orgId, role })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(authSecret));
    const res = await fetch(`${RELAY_URL}/api/player-photo/${encodeURIComponent(playerId)}`, {
      method: "DELETE",
      headers: { "x-control-secret": secret },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const PHOTO_NOT_REMOVED = "Couldn't remove the player's photo from storage. Nothing was changed — try again.";

const PATCHABLE_FIELDS = ["firstName", "lastName", "displayName", "externalId", "provider", "bio", "photoUrl"] as const;

// Validates and trims a single field's incoming value. Returns the
// normalized value (string or null), or an error message.
function normalizePatchField(field: (typeof PATCHABLE_FIELDS)[number], value: unknown): { value: string | null } | { error: string } {
  if (value !== null && typeof value !== "string") {
    return { error: `${field} must be a string or null` };
  }
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed) {
    const err = validatePlayerField(field, trimmed);
    if (err) return { error: err };
  }
  return { value: trimmed || null };
}

// Validates and normalizes the patchable fields present in the request body.
// Returns either the Prisma update data or a NextResponse to return as-is.
function parsePlayerPatch(body: unknown): Record<string, string | null> | NextResponse {
  const data: Record<string, string | null> = {};
  const source = (body as Record<string, unknown>) ?? {};
  for (const field of PATCHABLE_FIELDS) {
    if (!(field in source)) continue;
    const result = normalizePatchField(field, source[field]);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    data[field] = result.value;
  }
  if ("firstName" in data && !data.firstName) {
    return NextResponse.json({ error: "firstName cannot be empty" }, { status: 400 });
  }
  if ("lastName" in data && !data.lastName) {
    return NextResponse.json({ error: "lastName cannot be empty" }, { status: 400 });
  }
  return data;
}

// Edits roster fields, including linking/unlinking a live feed identity
// (provider/externalId) and setting photoUrl (set by the relay's
// player-photo upload route, PATCHed here afterward — mirrors how logo
// uploads push logoUrl back onto MatchState via applyManualUpdate).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; playerId: string }> }
) {
  const { orgId, playerId } = await params;
  const { error, role } = await authorize(orgId);
  if (error) return error;

  const existing = await prisma.player.findUnique({ where: { id: playerId } });
  if (existing?.orgId !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data = parsePlayerPatch(body);
  if (data instanceof NextResponse) return data;

  // Clearing photoUrl is "remove this photo", so the file goes too.
  if ("photoUrl" in data && data.photoUrl === null && existing.photoUrl) {
    if (!(await deleteStoredPhoto(orgId, role, playerId))) {
      return NextResponse.json({ error: PHOTO_NOT_REMOVED }, { status: 502 });
    }
  }

  try {
    const player = await prisma.player.update({ where: { id: playerId }, data });
    return NextResponse.json({ player });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "a player with that provider/externalId already exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; playerId: string }> }
) {
  const { orgId, playerId } = await params;
  const { error, role } = await authorize(orgId);
  if (error) return error;

  const existing = await prisma.player.findUnique({ where: { id: playerId } });
  if (existing?.orgId !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Always attempted, since an upload can succeed without photoUrl having
  // been saved. Only a player known to have a photo is held back by a failure.
  const photoRemoved = await deleteStoredPhoto(orgId, role, playerId);
  if (!photoRemoved && existing.photoUrl) {
    return NextResponse.json({ error: PHOTO_NOT_REMOVED }, { status: 502 });
  }

  await prisma.player.delete({ where: { id: playerId } });

  return NextResponse.json({ status: "removed" });
}
