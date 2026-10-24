import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

// Helpers shared by the emailed one-time-link routes (signup confirm, password
// reset): the raw token only ever lives in the email, the DB stores its hash.

export function hashLinkToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** True when a one-time-link request row exists, hasn't been used, and hasn't expired. */
export function isLinkUsable<T extends { consumedAt: Date | null; expiresAt: Date }>(row: T | null): row is T {
  return !!row && !row.consumedAt && row.expiresAt >= new Date();
}

export function invalidLinkResponse(kind: string): NextResponse {
  return NextResponse.json({ error: `this ${kind} link is invalid or has expired` }, { status: 400 });
}

const tokenRequired = () => NextResponse.json({ error: "token is required" }, { status: 400 });

/** Reads `?token=` for a GET lookup, or returns the 400 to send back. */
export function tokenFromQuery(req: NextRequest): string | NextResponse {
  return req.nextUrl.searchParams.get("token") || tokenRequired();
}

/** Reads and validates a `{ token, password }` POST body, or returns the 400 to send back. */
export async function readTokenAndPassword(
  req: NextRequest,
): Promise<{ token: string; password: string } | NextResponse> {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!token) return tokenRequired();
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  return { token, password };
}
