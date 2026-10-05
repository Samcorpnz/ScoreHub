import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@scorehub/db";
import { auth } from "@/auth";
import { clientIp, isRateLimited } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { allowedSupportOrigin, supportCorsHeaders } from "@/lib/supportCors";
import {
  fileSupportRequest,
  isSupportCategory,
  supportDeskConfigured,
  type SupportRequest,
} from "@/lib/supportDesk";

// Bounded quantifiers cap backtracking cost — see typescript:S8786.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
const TEN_MINUTES = 10 * 60_000;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseTranscript(value: unknown): SupportRequest["transcript"] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((t) => {
    const content = str(t?.content, 4000);
    return content ? [{ role: t?.role === "assistant" ? ("assistant" as const) : ("user" as const), content }] : [];
  });
}

async function planFor(orgId: string | null): Promise<{ plan?: string; addOns?: string[] }> {
  if (!orgId) return {};
  // Best-effort context for the agent; never block a support request on it.
  const org = await prisma.org
    .findUnique({ where: { id: orgId }, select: { account: { select: { plan: true, addOns: true } } } })
    .catch(() => null);
  return org?.account ?? {};
}

// Files a support request in Jira Service Management.
//
// Signed-in users (the help centre's case form, called cross-origin with the
// session cookie) are filed under their real identity with org/plan/role
// attached. Signed-out callers may only raise the "login" category — the
// login page's "can't sign in" form — and are filed as unverified.
export async function POST(req: NextRequest) {
  const origin = allowedSupportOrigin(req);
  if (origin === null) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const headers = supportCorsHeaders(origin);
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

  const body = await req.json().catch(() => ({}));
  // Honeypot: real visitors never see or fill this field.
  if (str(body?.website, 10)) return respond({ key: null });

  const category = body?.category;
  const summary = str(body?.summary, 200);
  if (!isSupportCategory(category) || !summary) {
    return respond({ error: "invalid_request" }, 400);
  }

  const session = await auth();
  const user = session?.user?.email ? session.user : null;

  let requester: SupportRequest["requester"];
  let context: SupportRequest["context"];
  if (user) {
    if (isRateLimited(`support:${user.id}`, 5, TEN_MINUTES)) {
      return respond({ error: "rate_limited" }, 429);
    }
    requester = { name: user.name ?? "", email: user.email as string, verified: true };
    context = {
      organisation: user.memberships.find((m) => m.orgId === user.activeOrgId)?.orgName,
      role: user.activeRole ?? undefined,
      ...(await planFor(user.activeOrgId)),
    };
  } else {
    if (category !== "login") return respond({ error: "unauthorized" }, 401);
    const email = str(body?.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return respond({ error: "invalid_request" }, 400);
    if (isRateLimited(`support-anon:${clientIp(req)}`, 3, TEN_MINUTES)) {
      return respond({ error: "rate_limited" }, 429);
    }
    requester = { name: str(body?.name, 120), email, verified: false };
  }

  if (!supportDeskConfigured()) {
    return respond({ error: "case_unavailable" }, 503);
  }

  try {
    const key = await fileSupportRequest({
      category,
      summary,
      details: str(body?.details, 4000),
      page: str(body?.page, 300),
      transcript: parseTranscript(body?.transcript),
      requester,
      context,
    });
    logger.info("support.case_filed", {
      key,
      category,
      verified: requester.verified,
      userId: user?.id,
      conversationId: str(body?.conversationId, 64) || undefined,
    });
    await logger.flush();
    return respond({ key });
  } catch (err) {
    logger.error("support.case_failed", { category, error: String(err) });
    await logger.flush();
    return respond({ error: "case_unavailable" }, 502);
  }
}
