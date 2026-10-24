import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountForOrg } from "@/lib/account";
import { getStripe } from "@/lib/stripe";
import * as Sentry from "@sentry/nextjs";
import Stripe from "stripe";
import { AddOn, BillingInterval, priceIdForAddOn } from "@/lib/plans";
import { readSubscription, currentPeriodEnd, syncAccountFromSubscription } from "@/lib/billing";
import { readScheduledChange, ScheduledChange } from "@/lib/scheduledChanges";

export async function GET() {
  const session = await auth();
  if (!session?.user?.activeOrgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let account = await getAccountForOrg(session.user.activeOrgId);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  type SubscriptionSummary = {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: number | null;
    amount: number | null;
    currency: string | null;
    interval: BillingInterval | null;
  };

  async function summarize(subscriptionId: string): Promise<SubscriptionSummary> {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    const item = sub.items.data[0];
    return {
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: item?.current_period_end ?? null,
      amount: item?.price.unit_amount ?? null,
      currency: sub.currency,
      interval: (item?.price.recurring?.interval as BillingInterval | undefined) ?? null,
    };
  }

  function itemSummary(sub: Stripe.Subscription, item: Stripe.SubscriptionItem | null): SubscriptionSummary {
    return {
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: currentPeriodEnd(sub),
      amount: item?.price.unit_amount ?? null,
      currency: sub.currency,
      interval: (item?.price.recurring?.interval as BillingInterval | undefined) ?? null,
    };
  }

  // The plan and its add-ons, all items on the one subscription. An add-on
  // taken off but still paid up shows as cancelling at addOnsEndAt; its item
  // is gone, so its price is looked up instead.
  type PlanSummary = {
    plan: SubscriptionSummary | null;
    graphics: SubscriptionSummary | null;
    dataFeed: SubscriptionSummary | null;
    // A downgrade waiting for the end of the period already paid for.
    scheduledChange: ScheduledChange | null;
  };
  async function summarizePlan(subscriptionId: string): Promise<PlanSummary> {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    // The renewal webhook normally ends lapsed add-ons; catch up here if it
    // hasn't arrived yet.
    if (account!.addOnsEndAt && account!.addOnsEndAt.getTime() <= Date.now()) {
      account = (await syncAccountFromSubscription(account!, sub)).account as typeof account;
    }
    const { planItem, interval, addOnItems } = readSubscription(sub);
    const addOnSummary = async (addOn: AddOn): Promise<SubscriptionSummary | null> => {
      const item = addOnItems[addOn];
      if (item) return itemSummary(sub, item);
      if (!account!.addOnsEnding.includes(addOn) || !account!.addOnsEndAt) return null;
      const price = await getStripe().prices.retrieve(priceIdForAddOn(addOn, (interval ?? "month") as BillingInterval));
      return {
        status: sub.status,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: Math.floor(account!.addOnsEndAt.getTime() / 1000),
        amount: price.unit_amount,
        currency: price.currency,
        interval: (price.recurring?.interval as BillingInterval | undefined) ?? null,
      };
    };
    return {
      plan: itemSummary(sub, planItem),
      graphics: await addOnSummary("graphics-operator"),
      dataFeed: await addOnSummary("data-feed"),
      scheduledChange: await readScheduledChange(getStripe(), sub),
    };
  }

  type PaymentMethodSummary = { brand: string; last4: string } | null;

  async function summarizeCustomer(customerId: string): Promise<{ invoiceEmail: string | null; paymentMethod: PaymentMethodSummary }> {
    const customer = await getStripe().customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return { invoiceEmail: null, paymentMethod: null };
    const pm = customer.invoice_settings.default_payment_method;
    const paymentMethod =
      pm && typeof pm !== "string" && pm.type === "card" && pm.card
        ? { brand: pm.card.brand, last4: pm.card.last4 }
        : null;
    return { invoiceEmail: customer.email, paymentMethod };
  }

  // Each lookup fails on its own: one missing or unreachable Stripe object
  // (e.g. an id saved against a different Stripe account) shouldn't take the
  // whole billing page down. The plan itself comes from our own database.
  let stripeUnavailable = false;
  async function safely<T>(what: string, lookup: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await lookup();
    } catch (err) {
      stripeUnavailable = true;
      console.error(`[billing] status: couldn't load ${what} for account ${account!.id}:`, err);
      Sentry.captureException(err, { tags: { area: "billing-status" }, extra: { accountId: account!.id, what } });
      return fallback;
    }
  }

  const noCustomerInfo = { invoiceEmail: null, paymentMethod: null };
  const noPlan: PlanSummary = { plan: null, graphics: null, dataFeed: null, scheduledChange: null };
  // The plan's subscription goes first, on its own: it may bring the account
  // up to date (lapsed add-ons), which the response below reads.
  const planSummary = account.stripeSubscriptionId
    ? await safely("subscription", () => summarizePlan(account!.stripeSubscriptionId!), noPlan)
    : noPlan;
  const [legacyGraphics, legacyDataFeed, customerInfo] = await Promise.all([
    // Add-ons not yet moved onto the plan's subscription.
    account.graphicsSubscriptionId ? safely("graphics subscription", () => summarize(account!.graphicsSubscriptionId!), null) : null,
    account.dataFeedSubscriptionId ? safely("data feed subscription", () => summarize(account!.dataFeedSubscriptionId!), null) : null,
    account.stripeCustomerId ? safely("customer", () => summarizeCustomer(account!.stripeCustomerId!), noCustomerInfo) : noCustomerInfo,
  ]);
  const subscription = planSummary.plan;
  const graphicsSubscription = legacyGraphics ?? planSummary.graphics;
  const dataFeedSubscription = legacyDataFeed ?? planSummary.dataFeed;

  return NextResponse.json({
    plan: account.plan,
    billingInterval: account.billingInterval,
    hasStripeCustomer: Boolean(account.stripeCustomerId),
    subscription,
    scheduledChange: planSummary.scheduledChange,
    addOns: account.addOns,
    graphicsSubscription,
    dataFeedSubscription,
    invoiceEmail: customerInfo.invoiceEmail,
    paymentMethod: customerInfo.paymentMethod,
    upgradeDiscountAvailable: account.upgradeDiscountUsedAt === null,
    stripeUnavailable,
  });
}
