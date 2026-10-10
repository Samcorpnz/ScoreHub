import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@scorehub/db";
import { getStripe } from "@/lib/stripe";
import { planForPriceId, addOnForPriceId, ADDON_SUBSCRIPTION_FIELD, AddOn, PaidPlan } from "@/lib/plans";
import {
  sendPaymentFailedEmail,
  sendPaymentActionRequiredEmail,
  sendPaymentRecoveredEmail,
  sendSubscriptionEndedEmail,
} from "@/lib/email";

function isPaidPlan(plan: string): plan is PaidPlan {
  return plan === "pro" || plan === "venue";
}

// A failed renewal moves the subscription to "past_due" while Stripe retries
// the card. The account keeps its plan and add-ons through that window, and
// only drops to Free once Stripe gives up and cancels the subscription (or
// marks it unpaid). The length of the window is not set here: it is the retry
// schedule in each Stripe account's dashboard (Billing > Revenue recovery),
// which must be "retry for 2 weeks, then cancel the subscription" to match
// PAYMENT_GRACE_DAYS.
function keepsPaidAccess(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "past_due";
}

// Stripe retries webhooks on any non-2xx response, so on a real processing
// failure we return 500 deliberately to get that retry. Errors are caught
// here rather than rethrown (so we can clean up the stripeEvent row first),
// which means Next.js's global onRequestError/Sentry.captureRequestError
// hook never sees them — each catch below reports to Sentry explicitly.
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[billing] webhook signature verification failed:", err);
    Sentry.captureException(err, { tags: { area: "billing-webhook", stage: "signature" } });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Idempotency: Stripe will redeliver this same event on retry. The event
  // id's uniqueness constraint is the guard — a duplicate insert means we've
  // already applied this event's effect, so just acknowledge and stop. The
  // row is only kept once handleEvent actually succeeds; if it throws, we
  // remove the row so a Stripe retry can genuinely reprocess instead of
  // being silently swallowed as a "duplicate" of a failed attempt.
  try {
    await prisma.stripeEvent.create({ data: { id: event.id } });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error("[billing] failed to process webhook event:", event.id, event.type, err);
    Sentry.captureException(err, {
      tags: { area: "billing-webhook", stage: "processing", eventType: event.type },
      extra: { eventId: event.id },
    });
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => {});
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_action_required":
    case "invoice.payment_attempt_required":
      await handleInvoicePaymentActionRequired(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_succeeded":
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const accountId = session.client_reference_id ?? session.metadata?.accountId;
  if (!accountId || typeof session.customer !== "string" || typeof session.subscription !== "string") return;

  let subscription: Stripe.Subscription;
  try {
    subscription = await getStripe().subscriptions.retrieve(session.subscription);
  } catch (err) {
    // The subscription can be gone by the time we look it up (e.g. a stale
    // event replayed against test data that's since been reset) — that's not
    // a transient failure, so don't let Stripe retry this forever.
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
      console.error(`[billing] checkout.session.completed references missing subscription: ${session.subscription} (account ${accountId})`);
      Sentry.captureMessage("billing webhook: checkout.session.completed references missing subscription", {
        level: "warning",
        tags: { area: "billing-webhook" },
        extra: { subscriptionId: session.subscription, accountId },
      });
      return;
    }
    throw err;
  }
  const priceId = subscription.items.data[0]?.price.id;
  const addOn = session.metadata?.addOn as AddOn | undefined;

  if (addOn) {
    await addAddOn(accountId, addOn, subscription.id);
    return;
  }

  const plan = priceId ? planForPriceId(priceId) : null;
  const interval = subscription.items.data[0]?.price.recurring?.interval ?? null;
  // Never fail open to a paid tier: if the price id can't be mapped to a
  // known plan (unrecognized/mis-mapped price), record the customer and
  // subscription but leave `plan` unchanged and log the misconfiguration
  // rather than silently granting Pro.
  if (!plan) {
    console.error(`[billing] unmapped priceId on checkout.session.completed: ${priceId} (account ${accountId})`);
    Sentry.captureMessage("billing webhook: unmapped priceId on checkout.session.completed", {
      level: "error",
      tags: { area: "billing-webhook" },
      extra: { priceId, accountId },
    });
  }
  // The checkout route stamps this metadata flag when it attached the
  // upgrade-discount coupon at Checkout Session creation time (see
  // UPGRADE_DISCOUNT_COUPON_ID) — mark it used so the offer can't repeat.
  const discounted = subscription.metadata?.discounted === "true";
  await prisma.account.update({
    where: { id: accountId },
    data: {
      stripeCustomerId: session.customer,
      stripeSubscriptionId: subscription.id,
      ...(plan ? { plan } : {}),
      billingInterval: interval,
      ...(discounted ? { upgradeDiscountUsedAt: new Date() } : {}),
    },
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const accountId = subscription.metadata?.accountId;
  const metadataAddOn = subscription.metadata?.addOn as AddOn | undefined;
  const priceId = subscription.items.data[0]?.price.id;

  if (metadataAddOn || (priceId && addOnForPriceId(priceId))) {
    const account = accountId
      ? await prisma.account.findUnique({ where: { id: accountId } })
      : await findAccountByAddOnSubscription(subscription.id);
    if (!account) return;
    const addOn = metadataAddOn ?? addOnForPriceId(priceId!)!;
    if (keepsPaidAccess(subscription.status)) {
      await addAddOn(account.id, addOn, subscription.id);
    } else {
      await removeAddOn(account.id, addOn);
    }
    return;
  }

  const account = accountId
    ? await prisma.account.findUnique({ where: { id: accountId } })
    : await prisma.account.findFirst({ where: { stripeSubscriptionId: subscription.id } });
  if (!account) return;

  const plan = priceId ? planForPriceId(priceId) : null;
  const interval = subscription.items.data[0]?.price.recurring?.interval ?? null;
  const paid = keepsPaidAccess(subscription.status);
  const nextPlan = paid ? (plan ?? account.plan) : "free";
  await prisma.account.update({
    where: { id: account.id },
    data: {
      stripeSubscriptionId: subscription.id,
      plan: nextPlan,
      billingInterval: paid ? interval : null,
    },
  });
  // Add-ons require an active paid plan — if the base plan just lapsed,
  // cancel any running add-on subscription rather than leaving it billing
  // for a feature the account can no longer use.
  if (nextPlan === "free") {
    await cancelActiveAddOnSubscriptions(account);
    if (isPaidPlan(account.plan)) await sendSubscriptionEndedEmailToAdmins(account.id, account.plan);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const accountId = subscription.metadata?.accountId;
  const metadataAddOn = subscription.metadata?.addOn as AddOn | undefined;

  if (metadataAddOn) {
    const account = accountId
      ? await prisma.account.findUnique({ where: { id: accountId } })
      : await findAccountByAddOnSubscription(subscription.id);
    if (account) await removeAddOn(account.id, metadataAddOn);
    return;
  }

  const account = accountId
    ? await prisma.account.findUnique({ where: { id: accountId } })
    : await prisma.account.findFirst({ where: { stripeSubscriptionId: subscription.id } });
  await prisma.account.updateMany({
    where: accountId ? { id: accountId } : { stripeSubscriptionId: subscription.id },
    data: { plan: "free", stripeSubscriptionId: null, billingInterval: null },
  });
  // Same cascade as the "updated" case above, for when the base plan
  // subscription is cancelled outright rather than just lapsing.
  if (account) {
    await cancelActiveAddOnSubscriptions(account);
    if (isPaidPlan(account.plan)) await sendSubscriptionEndedEmailToAdmins(account.id, account.plan);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const emails = await adminEmailsForStripeCustomer(invoice.customer);
  if (!emails) return;
  await sendPaymentFailedEmail({ to: emails });
}

async function handleInvoicePaymentActionRequired(invoice: Stripe.Invoice): Promise<void> {
  const emails = await adminEmailsForStripeCustomer(invoice.customer);
  if (!emails) return;
  await sendPaymentActionRequiredEmail({ to: emails, hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined });
}

// invoice.payment_succeeded fires for every routine renewal, not just
// recoveries — attempt_count > 1 means a prior charge attempt on this same
// invoice already failed, so this is specifically the "it went through after
// all" case worth notifying admins about, not a monthly "thanks for paying".
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.attempt_count || invoice.attempt_count <= 1) return;

  const emails = await adminEmailsForStripeCustomer(invoice.customer);
  if (!emails) return;
  await sendPaymentRecoveredEmail({ to: emails });
}

async function adminEmailsForStripeCustomer(customer: Stripe.Invoice["customer"]): Promise<string[] | null> {
  if (typeof customer !== "string") return null;

  const account = await prisma.account.findFirst({ where: { stripeCustomerId: customer } });
  if (!account) return null;

  return adminEmailsForAccountId(account.id);
}

async function adminEmailsForAccountId(accountId: string): Promise<string[]> {
  const admins = await prisma.membership.findMany({
    where: { role: "ADMIN", org: { accountId } },
    select: { user: { select: { email: true } } },
    distinct: ["userId"],
  });
  return [...new Set(admins.map(m => m.user.email))];
}

async function sendSubscriptionEndedEmailToAdmins(accountId: string, plan: PaidPlan): Promise<void> {
  const emails = await adminEmailsForAccountId(accountId);
  await sendSubscriptionEndedEmail({ to: emails, plan });
}

// A webhook that only carries a bare subscription id (no accountId/addOn
// metadata) has to find its account by checking every add-on's own
// subscription-id column — there's no generic join table yet (see the
// schema comment on Account.graphicsSubscriptionId/dataFeedSubscriptionId).
async function findAccountByAddOnSubscription(subscriptionId: string) {
  return prisma.account.findFirst({
    where: {
      OR: Object.values(ADDON_SUBSCRIPTION_FIELD).map(field => ({ [field]: subscriptionId })),
    },
  });
}

async function addAddOn(accountId: string, addOn: AddOn, subscriptionId: string): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return;
  await prisma.account.update({
    where: { id: accountId },
    data: {
      [ADDON_SUBSCRIPTION_FIELD[addOn]]: subscriptionId,
      addOns: account.addOns.includes(addOn) ? account.addOns : [...account.addOns, addOn],
    },
  });
}

async function removeAddOn(accountId: string, addOn: AddOn): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return;
  await prisma.account.update({
    where: { id: accountId },
    data: {
      [ADDON_SUBSCRIPTION_FIELD[addOn]]: null,
      addOns: account.addOns.filter(a => a !== addOn),
    },
  });
}

// Used when the base plan lapses/cancels — an add-on can't legitimately keep
// billing without a paid base plan under it, so cancel it immediately
// (unlike the base plan's own cancel flow, which lets the period run out).
async function cancelAddOnSubscription(accountId: string, subscriptionId: string, addOn: AddOn): Promise<void> {
  await getStripe().subscriptions.cancel(subscriptionId).catch(() => {});
  await removeAddOn(accountId, addOn);
}

async function cancelActiveAddOnSubscriptions(account: { id: string } & Record<string, unknown>): Promise<void> {
  for (const [addOn, field] of Object.entries(ADDON_SUBSCRIPTION_FIELD) as [AddOn, string][]) {
    const subscriptionId = account[field];
    if (typeof subscriptionId === "string") {
      await cancelAddOnSubscription(account.id, subscriptionId, addOn);
    }
  }
}
