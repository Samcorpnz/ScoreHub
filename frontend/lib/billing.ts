import Stripe from "stripe";
import { prisma } from "@scorehub/db";
import { planForPriceId, addOnForPriceId, ADDON_SUBSCRIPTION_FIELD, AddOn, PaidPlan, BillingInterval } from "@/lib/plans";

// One Stripe subscription per account carries everything it pays for: the
// plan as one item and each add-on as another. That gives the customer one
// renewal date and one invoice, rather than one per add-on, and lets an
// add-on be bought with the card already on file instead of a fresh Checkout.

export const KNOWN_ADDONS: AddOn[] = ["graphics-operator", "data-feed"];

type AccountRow = NonNullable<Awaited<ReturnType<typeof prisma.account.findUnique>>>;

export type SubscriptionContents = {
  plan: PaidPlan | null;
  planItem: Stripe.SubscriptionItem | null;
  interval: BillingInterval | null;
  addOnItems: Partial<Record<AddOn, Stripe.SubscriptionItem>>;
};

export function readSubscription(subscription: Stripe.Subscription): SubscriptionContents {
  const contents: SubscriptionContents = { plan: null, planItem: null, interval: null, addOnItems: {} };
  for (const item of subscription.items?.data ?? []) {
    const plan = planForPriceId(item.price.id);
    if (plan) {
      contents.plan = plan;
      contents.planItem = item;
      contents.interval = (item.price.recurring?.interval as BillingInterval | undefined) ?? null;
      continue;
    }
    const addOn = addOnForPriceId(item.price.id);
    if (addOn) contents.addOnItems[addOn] = item;
  }
  return contents;
}

// End of the period the subscription has been paid up to. Every item shares
// it, since they all renew together.
export function currentPeriodEnd(subscription: Stripe.Subscription): number | null {
  return subscription.items?.data[0]?.current_period_end ?? null;
}

// An add-on taken off the subscription that's still within the period it was
// paid for, so putting it back costs nothing until the next renewal. Checks
// the date too, not just the list: if the renewal webhook that clears the
// list hasn't arrived, a lapsed add-on mustn't come back free.
export function isStillEnding(account: AccountRow, addOn: AddOn): boolean {
  return account.addOnsEnding.includes(addOn)
    && Boolean(account.addOnsEndAt && account.addOnsEndAt.getTime() > Date.now());
}

// Upgrades and add-ons bought mid-period are charged on the next renewal
// invoice. A subscription set to end has no next invoice, so those charges
// would never be collected: invoice them now instead. Called whenever a
// subscription is set to cancel, from our own cancel route or the billing
// portal alike (via the webhook).
export async function invoicePendingCharges(stripe: Stripe, subscription: Stripe.Subscription): Promise<boolean> {
  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const pending = await stripe.invoiceItems.list({ customer, pending: true, limit: 100 });
  const owed = pending.data
    .filter(item => item.parent?.subscription_details?.subscription === subscription.id)
    .reduce((sum, item) => sum + item.amount, 0);
  if (owed <= 0) return false;
  await stripe.invoices.create({
    customer,
    subscription: subscription.id,
    pending_invoice_items_behavior: "include",
    auto_advance: true,
  });
  return true;
}

// A failed renewal moves the subscription to "past_due" while Stripe retries
// the card. The account keeps its plan and add-ons through that window, and
// only drops to Free once Stripe gives up and cancels the subscription (or
// marks it unpaid). The length of the window is not set here: it is the retry
// schedule in each Stripe account's dashboard (Billing > Revenue recovery),
// which must be "retry for 2 weeks, then cancel the subscription" to match
// PAYMENT_GRACE_DAYS.
export function keepsPaidAccess(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "past_due";
}

// Add-ons still billed on their own pre-migration subscription. Their
// entitlement is kept by the legacy webhook path, not by the plan's items.
function legacyAddOns(account: AccountRow): AddOn[] {
  return KNOWN_ADDONS.filter(addOn => account[ADDON_SUBSCRIPTION_FIELD[addOn]] && account.addOns.includes(addOn));
}

export type SyncResult = { account: AccountRow; previousPlan: string; nowFree: boolean };

// Writes what the plan's subscription holds onto the Account: plan, interval
// and add-ons. Add-ons removed at period end (addOnsEnding) stay usable until
// addOnsEndAt. Called from the webhook and straight after our own changes, so
// the account page doesn't have to wait for the webhook to see them.
export async function syncAccountFromSubscription(
  account: AccountRow,
  subscription: Stripe.Subscription,
  extra: { stripeCustomerId?: string; upgradeDiscountUsedAt?: Date } = {},
): Promise<SyncResult> {
  const { plan, interval, addOnItems } = readSubscription(subscription);
  const paid = keepsPaidAccess(subscription.status);
  const billed = Object.keys(addOnItems) as AddOn[];

  const endAt = account.addOnsEndAt;
  const stillEnding = endAt && endAt.getTime() > Date.now()
    ? account.addOnsEnding.filter(a => !billed.includes(a as AddOn))
    : [];

  const addOns = paid ? [...new Set([...billed, ...stillEnding, ...legacyAddOns(account)])] : legacyAddOns(account);
  const nextPlan = paid ? (plan ?? account.plan) : "free";

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: {
      stripeSubscriptionId: subscription.id,
      plan: nextPlan,
      billingInterval: paid ? interval : null,
      addOns,
      addOnsEnding: stillEnding,
      addOnsEndAt: stillEnding.length ? endAt : null,
      ...extra,
    },
  });
  return { account: updated, previousPlan: account.plan, nowFree: nextPlan === "free" };
}
