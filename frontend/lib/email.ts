import Mailgun from "mailgun.js";
import FormData from "form-data";
import { PAYMENT_GRACE_DAYS } from "./plans";
import type { PaidPlan } from "./plans";

// Lazily constructed, mirroring lib/stripe.ts's getStripe() — importing this
// module during Next.js's build-time page-data collection shouldn't throw
// in environments where Mailgun isn't configured yet. The error only
// surfaces when a route that actually sends mail runs.
const globalForMailgun = globalThis as unknown as {
  mailgun?: ReturnType<InstanceType<typeof Mailgun>["client"]>;
};

// User-controlled strings (org names, display names) get interpolated into
// html: bodies below — escape them so a name like `<img src=x onerror=...>`
// can't inject markup into an email rendered in the recipient's client.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Where replies go for the emails that ask for one (SA-164). EMAIL_FROM is
// typically a noreply address, so without this a reply goes nowhere.
const SUPPORT_EMAIL = "hello@scorehub.co.nz";

function getMailgun() {
  if (globalForMailgun.mailgun) return globalForMailgun.mailgun;

  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) {
    throw new Error("MAILGUN_API_KEY is not configured");
  }
  const client = new Mailgun(FormData).client({ username: "api", key: apiKey });
  if (process.env.NODE_ENV !== "production") {
    globalForMailgun.mailgun = client;
  }
  return client;
}

export async function sendEmailChangeVerification({ to, token }: { to: string; token: string }): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/verify-email?token=${token}`;

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: "Confirm your new ScoreHub email address",
    text: `Click the link below to confirm this is your new email address for ScoreHub.\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `<p>Click the link below to confirm this is your new email address for ScoreHub.</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
  });
}

export async function sendInvitationEmail({
  to,
  orgName,
  role,
  token,
}: {
  to: string;
  orgName: string;
  role: string;
  token: string;
}): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/invite/accept?token=${token}`;

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: `You've been invited to join ${orgName} on ScoreHub`,
    text: `You've been invited to join ${orgName} on ScoreHub as ${role}.\n\n${link}\n\nThis link expires in 7 days. If you weren't expecting this, you can ignore this email.`,
    html: `<p>You've been invited to join <strong>${escapeHtml(orgName)}</strong> on ScoreHub as <strong>${escapeHtml(role)}</strong>.</p><p><a href="${link}">${link}</a></p><p>This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>`,
  });
}

export async function sendSignupVerificationEmail({
  to,
  name,
  token,
}: {
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/signup/confirm?token=${token}`;

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: "Confirm your ScoreHub account",
    text: `Hi ${name},\n\nClick the link below to confirm your email address and finish setting up your ScoreHub account.\n\n${link}\n\nThis link expires in 24 hours. If you didn't request this, you can ignore this email.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Click the link below to confirm your email address and finish setting up your ScoreHub account.</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours. If you didn't request this, you can ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail({
  to,
  token,
}: {
  to: string;
  token: string;
}): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/reset-password?token=${token}`;

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: "Reset your ScoreHub password",
    text: `Click the link below to choose a new password for your ScoreHub account.\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.`,
    html: `<p>Click the link below to choose a new password for your ScoreHub account.</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.</p>`,
  });
}

export async function sendPaymentFailedEmail({ to }: { to: string[] }): Promise<void> {
  if (to.length === 0) return;
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/account`;

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: "Your ScoreHub payment failed",
    text: `We couldn't charge your card for your ScoreHub subscription. Your plan stays active while we retry the payment over the next ${PAYMENT_GRACE_DAYS} days. Update your payment method before then, or your account will move to the Free plan.\n\n${link}\n\nIf you've already resolved this, you can ignore this email.`,
    html: `<p>We couldn't charge your card for your ScoreHub subscription. Your plan stays active while we retry the payment over the next ${PAYMENT_GRACE_DAYS} days. Update your payment method before then, or your account will move to the Free plan.</p><p><a href="${link}">Update payment method</a></p><p>If you've already resolved this, you can ignore this email.</p>`,
  });
}

export async function sendPaymentActionRequiredEmail({
  to,
  hostedInvoiceUrl,
}: {
  to: string[];
  hostedInvoiceUrl?: string;
}): Promise<void> {
  if (to.length === 0) return;
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = hostedInvoiceUrl ?? `${baseUrl}/account`;

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: "Action required to complete your ScoreHub payment",
    text: `Your bank requires additional verification to complete a payment for your ScoreHub subscription. Please complete this step to avoid losing access.\n\n${link}\n\nIf you've already resolved this, you can ignore this email.`,
    html: `<p>Your bank requires additional verification to complete a payment for your ScoreHub subscription. Please complete this step to avoid losing access.</p><p><a href="${link}">Complete payment verification</a></p><p>If you've already resolved this, you can ignore this email.</p>`,
  });
}

export async function sendPaymentRecoveredEmail({ to }: { to: string[] }): Promise<void> {
  if (to.length === 0) return;
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }

  await getMailgun().messages.create(domain, {
    from,
    to,
    subject: "Your ScoreHub payment succeeded",
    text: `Good news — we successfully charged your card for your ScoreHub subscription after a previous attempt failed. No further action is needed.`,
    html: `<p>Good news — we successfully charged your card for your ScoreHub subscription after a previous attempt failed. No further action is needed.</p>`,
  });
}

// Shown to the recipient, so kept distinct from the internal PaidPlan values
// ("pro"/"venue") — and paired with the one concrete thing they're losing,
// since a vague "premium features" line undersells what's actually changing.
const PLAN_INFO: Record<PaidPlan, { label: string; losing: string }> = {
  pro: { label: "Pro", losing: "concurrent live matches and priority support" },
  venue: { label: "Venue", losing: "multi-venue control, concurrent live matches, and priority support" },
};

export async function sendSubscriptionEndedEmail({ to, plan }: { to: string[]; plan: PaidPlan }): Promise<void> {
  if (to.length === 0) return;
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error("MAILGUN_DOMAIN is not configured");
  }
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const link = `${baseUrl}/account/billing`;
  const { label, losing } = PLAN_INFO[plan];

  await getMailgun().messages.create(domain, {
    from,
    to,
    "h:Reply-To": SUPPORT_EMAIL,
    subject: `Your ScoreHub ${label} plan has ended`,
    text: `Your ScoreHub ${label} subscription has ended, and your account is back on the Free plan.\n\nThat means ${losing} are switched off for now — but nothing else has changed. Your matches, your scoreboards, your settings: all exactly where you left them, ready the moment you're back.\n\nGetting back to full strength takes under a minute:\n\n${link}\n\nIf something about ${label} wasn't working for you, just hit reply and tell us — we read every message, and it shapes what we build next.\n\n— The ScoreHub team`,
    html: `<p>Your ScoreHub ${label} subscription has ended, and your account is back on the Free plan.</p><p>That means ${escapeHtml(losing)} are switched off for now — but nothing else has changed. Your matches, your scoreboards, your settings: all exactly where you left them, ready the moment you're back.</p><p><a href="${link}">Reactivate ${label}</a> — it takes under a minute.</p><p>If something about ${label} wasn't working for you, just hit reply and tell us — we read every message, and it shapes what we build next.</p><p>— The ScoreHub team</p>`,
  });
}
