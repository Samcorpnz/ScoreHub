// Files support requests in the Jira Service Management "SUP" service desk
// (samcorp.atlassian.net) on behalf of the help centre's case form and the
// login page's "can't sign in" form. See app/api/support/case/route.ts.

export const SUPPORT_CATEGORIES = {
  setup: "Setup help",
  "live-match": "Live-match problem",
  bridge: "Bridge or console",
  billing: "Billing",
  account: "Account",
  login: "Can't sign in",
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

// Category → JSM request type id. These are the service desk's default
// request types; override with JSM_REQUEST_TYPES (a JSON object) once
// purpose-built ones exist.
const DEFAULT_REQUEST_TYPES: Record<SupportCategory, string> = {
  setup: "2", // Ask a question
  "live-match": "1", // Submit a request or incident
  bridge: "1",
  billing: "5", // Licensing and billing questions
  account: "1",
  login: "1",
};

export interface SupportRequest {
  category: SupportCategory;
  summary: string;
  details: string;
  page: string;
  transcript: { role: "user" | "assistant"; content: string }[];
  requester: {
    name: string;
    email: string;
    // True only when the email came from a logged-in session. An address
    // typed into the public "can't sign in" form proves nothing.
    verified: boolean;
  };
  context?: {
    organisation?: string;
    role?: string;
    plan?: string;
    addOns?: string[];
  };
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && value in SUPPORT_CATEGORIES;
}

export function supportDeskConfigured(): boolean {
  return Boolean(process.env.JSM_BASE_URL && process.env.JSM_EMAIL && process.env.JSM_API_TOKEN);
}

export function describeSupportRequest(request: SupportRequest): string {
  const { requester, context } = request;
  const lines = [
    request.details || "(No further details given.)",
    "",
    "----",
    `Name: ${requester.name || "(not given)"}`,
    `Email: ${requester.email}`,
    `Category: ${SUPPORT_CATEGORIES[request.category]}`,
    `Raised from: ${request.page || "(unknown)"}`,
  ];
  if (requester.verified) {
    lines.push(
      `Organisation: ${context?.organisation || "(none)"}`,
      `Role: ${context?.role || "(none)"}`,
      `Plan: ${context?.plan || "(unknown)"}${context?.addOns?.length ? ` + ${context.addOns.join(", ")}` : ""}`,
      "",
      "Identity verified: raised by a signed-in ScoreHub user.",
    );
  } else {
    lines.push(
      "",
      "Email NOT verified: raised from the public can't-sign-in form. Confirm the sender's identity",
      "before making account, billing or closure changes.",
    );
  }
  if (request.transcript.length > 0) {
    lines.push("", "Help assistant conversation before this request:");
    for (const turn of request.transcript) {
      lines.push("", `${turn.role === "assistant" ? "Assistant" : "Customer"}: ${turn.content}`);
    }
  }
  return lines.join("\n");
}

function requestTypeFor(category: SupportCategory): string {
  try {
    const overrides = process.env.JSM_REQUEST_TYPES ? JSON.parse(process.env.JSM_REQUEST_TYPES) : {};
    return String(overrides[category] ?? DEFAULT_REQUEST_TYPES[category]);
  } catch {
    return DEFAULT_REQUEST_TYPES[category];
  }
}

function jsm(path: string, init: RequestInit = {}): Promise<Response> {
  const credentials = Buffer.from(`${process.env.JSM_EMAIL}:${process.env.JSM_API_TOKEN}`).toString("base64");
  return fetch(`${process.env.JSM_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

// JSM raises a request "on behalf of" a customer account so their email
// notifications and replies thread properly. Find or create it by email.
async function customerAccountId(serviceDeskId: string, name: string, email: string): Promise<string | null> {
  const created = await jsm("/rest/servicedeskapi/customer", {
    method: "POST",
    body: JSON.stringify({ email, displayName: name || email }),
  });
  if (created.ok) {
    return ((await created.json()) as { accountId?: string }).accountId ?? null;
  }
  // Most likely the customer already exists; look them up on the service desk.
  const found = await jsm(
    `/rest/servicedeskapi/servicedesk/${serviceDeskId}/customer?query=${encodeURIComponent(email)}`,
    { headers: { "X-ExperimentalApi": "opt-in" } },
  );
  if (!found.ok) return null;
  const { values = [] } = (await found.json()) as { values?: { accountId?: string; emailAddress?: string }[] };
  return values.find((v) => v.emailAddress?.toLowerCase() === email.toLowerCase())?.accountId ?? null;
}

/** Files the request and returns its JSM key (e.g. "SUP-12"). Throws if JSM rejects it. */
export async function fileSupportRequest(request: SupportRequest): Promise<string | null> {
  const serviceDeskId = process.env.JSM_SERVICE_DESK_ID || "1";
  const { requester } = request;

  // Only a verified requester is raised "on behalf of": doing that for an
  // unverified address would let anyone file requests as someone else.
  const accountId = requester.verified
    ? await customerAccountId(serviceDeskId, requester.name, requester.email).catch(() => null)
    : null;

  const create = (onBehalfOf: string | null) =>
    jsm("/rest/servicedeskapi/request", {
      method: "POST",
      body: JSON.stringify({
        serviceDeskId,
        requestTypeId: requestTypeFor(request.category),
        requestFieldValues: {
          summary: `[${SUPPORT_CATEGORIES[request.category]}] ${request.summary}`,
          description: describeSupportRequest(request),
        },
        ...(onBehalfOf ? { raiseOnBehalfOf: onBehalfOf } : {}),
      }),
    });

  let created = await create(accountId);
  if (!created.ok && accountId) {
    // Still file it rather than lose it; the email is in the description.
    created = await create(null);
  }
  if (!created.ok) {
    throw new Error(`JSM create request failed: ${created.status} ${(await created.text()).slice(0, 300)}`);
  }
  return ((await created.json()) as { issueKey?: string }).issueKey ?? null;
}
