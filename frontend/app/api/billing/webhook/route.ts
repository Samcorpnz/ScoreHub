import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@scorehub/db";
import { getStripe } from "@/lib/stripe";
import { ADDON_SUBSCRIPTION_FIELD, AddOn, PaidPlan, UPGRADE_DISCOUNT_COUPON_ID } from "@/lib/plans";
import { keepsPaidAccess, readSubscription, syncAccountFromSubscription, invoicePendingCharges } from "@/lib/billing";
import {
  sendPaymentFailedEmail,
  sendPaymentActionRequiredEmail,
  sendPaymentRecoveredEmail,
  sendSubscriptionEndedEmail,
} from "@/lib/email";

function isPaidPlan(plan: string): plan is PaidPlan {
  return plan === "pro" || plan === "venue";
}

// Add-ons used to bill on their own subscription, marked with addOn
// metadata. Those still running until the migration moves them onto the
// plan's subscription keep their old handling here. One the migration has
// already replaced (migratedTo metadata) is ignored, so its cancellation
// doesn't take away the add-on now billed on the plan.
function legacyAddOn(subscription: Stripe.Subscription): AddOn | "migrated" | null {
  if (subscription.metadata?.migratedTo) return "migrated";
  const addOn = subscription.metadata?.addOn as AddOn | undefined;
  if (addOn) return addOn;
  const { planItem, addOnItems } = readSubscription(subscription);
  const [onlyAddOn] = Object.keys(addOnItems) as AddOn[];
  return !planItem && onlyAddOn ? onlyAddOn : null;
}

async function findPlanAccount(subscription: Stripe.Subscription) {
  const accountId = subscription.metadata?.accountId;
  return accountId
    ? prisma.account.findUnique({ where: { id: accountId } })
    : prisma.account.findFirst({ where: { stripeSubscriptionId: subscription.id } });
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
  // Sessions are plan-only now; this is one started before the switch to a
  // single subscription that completed after it.
  const addOn = session.metadata?.addOn as AddOn | undefined;
  if (addOn) {
    await addAddOn(accountId, addOn, subscription.id);
    return;
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return;
  // Never fail open to a paid tier: if no item maps to a known plan
  // (unrecognized/mis-mapped price), sync leaves `plan` unchanged, and the
  // misconfiguration is logged rather than silently granting Pro.
  if (!readSubscription(subscription).plan) {
    const priceIds = subscription.items.data.map(i => i.price.id);
    console.error(`[billing] unmapped priceId on checkout.session.completed: ${priceIds.join(",")} (account ${accountId})`);
    Sentry.captureMessage("billing webhook: unmapped priceId on checkout.session.completed", {
      level: "error",
      tags: { area: "billing-webhook" },
      extra: { priceIds, accountId },
    });
  }
  // The checkout route stamps this metadata flag when it attached the
  // upgrade-discount coupon at Checkout Session creation time (see
  // UPGRADE_DISCOUNT_COUPON_ID) — mark it used so the offer can't repeat.
  const discounted = subscription.metadata?.discounted === "true";
  await syncAccountFromSubscription(account, subscription, {
    stripeCustomerId: session.customer,
    ...(discounted ? { upgradeDiscountUsedAt: new Date() } : {}),
  });
}

// A pre-migration add-on on its own subscription: metadata names the account,
// or (older ones) the account holds the subscription id.
async function findLegacyAddOnAccount(subscription: Stripe.Subscription) {
  const accountId = subscription.metadata?.accountId;
  return accountId
    ? prisma.account.findUnique({ where: { id: accountId } })
    : findAccountByAddOnSubscription(subscription.id);
}

function isEndingWithAccess(subscription: Stripe.Subscription): boolean {
  return Boolean(subscription.cancel_at_period_end || subscription.cancel_at) && keepsPaidAccess(subscription.status);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const legacy = legacyAddOn(subscription);
  if (legacy === "migrated") return;
  if (legacy) {
    const account = await findLegacyAddOnAccount(subscription);
    if (!account) return;
    if (keepsPaidAccess(subscription.status)) {
      await addAddOn(account.id, legacy, subscription.id);
    } else {
      await removeAddOn(account.id, legacy);
    }
    return;
  }

  const account = await findPlanAccount(subscription);
  if (!account) return;

  // Set to end (here or in the billing portal): collect mid-period charges
  // that were waiting for a renewal invoice that won't now come.
  if (isEndingWithAccess(subscription)) await invoicePendingCharges(getStripe(), subscription);

  const discountUsed = !account.upgradeDiscountUsedAt && await hasUpgradeDiscount(subscription);
  const { nowFree, previousPlan } = await syncAccountFromSubscription(
    account,
    subscription,
    discountUsed ? { upgradeDiscountUsedAt: new Date() } : {},
  );
  // Add-ons still on their own subscription require an active paid plan — if
  // the plan just lapsed, cancel them rather than leaving them billing for a
  // feature the account can no longer use. (Add-ons on the plan's own
  // subscription lapse with it.)
  if (nowFree) {
    await cancelActiveAddOnSubscriptions(account);
    if (isPaidPlan(previousPlan)) await sendSubscriptionEndedEmailToAdmins(account.id, previousPlan);
  }
}

// The one-time upgrade coupon can be on the subscription (from Checkout) or
// on the plan's item (from an in-app plan change, see changeSubscription in
// the checkout route). The checkout route claims it before making the
// change; this is the backstop for a change made some other way, such as in
// the Stripe dashboard. Event payloads list discounts as bare ids, hence the
// expanded re-fetch — only done when there's a discount at all.
async function hasUpgradeDiscount(subscription: Stripe.Subscription): Promise<boolean> {
  const hasAny = subscription.discounts?.length || subscription.items.data.some(i => i.discounts?.length);
  if (!hasAny) return false;
  const expanded = await getStripe().subscriptions.retrieve(subscription.id, {
    expand: ["discounts", "items.data.discounts"],
  });
  const discounts = [...expanded.discounts, ...expanded.items.data.flatMap(i => i.discounts)];
  return discounts.some(d => {
    if (typeof d === "string") return false;
    const coupon = d.source?.coupon;
    return (typeof coupon === "string" ? coupon : coupon?.id) === UPGRADE_DISCOUNT_COUPON_ID;
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const legacy = legacyAddOn(subscription);
  if (legacy === "migrated") return;
  if (legacy) {
    const account = await findLegacyAddOnAccount(subscription);
    if (account) await removeAddOn(account.id, legacy);
    return;
  }

  const accountId = subscription.metadata?.accountId;
  const account = await findPlanAccount(subscription);
  // The plan's add-ons end with it. Any still on their own subscription are
  // cancelled just below, which removes them too.
  await prisma.account.updateMany({
    where: accountId ? { id: accountId } : { stripeSubscriptionId: subscription.id },
    data: {
      plan: "free",
      stripeSubscriptionId: null,
      billingInterval: null,
      addOns: account ? account.addOns.filter(a => account[ADDON_SUBSCRIPTION_FIELD[a as AddOn]]) : [],
      addOnsEnding: [],
      addOnsEndAt: null,
    },
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
  if (invoice.billing_reason === "subscription_cycle") await endLapsedAddOns(invoice);
  if (!invoice.attempt_count || invoice.attempt_count <= 1) return;

  const emails = await adminEmailsForStripeCustomer(invoice.customer);
  if (!emails) return;
  await sendPaymentRecoveredEmail({ to: emails });
}

// A renewal is when add-ons removed during the last period stop working.
// customer.subscription.updated usually gets there first; this makes sure it
// happens even when that event's payload left nothing to change.
async function endLapsedAddOns(invoice: Stripe.Invoice): Promise<void> {
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  if (!subscriptionId) return;
  const account = await prisma.account.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
  if (!account?.addOnsEnding.length) return;
  await syncAccountFromSubscription(account, await getStripe().subscriptions.retrieve(subscriptionId));
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
