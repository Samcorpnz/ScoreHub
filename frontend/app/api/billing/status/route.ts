import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountForOrg } from "@/lib/account";
import { getStripe } from "@/lib/stripe";
import * as Sentry from "@sentry/nextjs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.activeOrgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const account = await getAccountForOrg(session.user.activeOrgId);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  type SubscriptionSummary = {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: number | null;
    amount: number | null;
    currency: string | null;
    interval: "month" | "year" | null;
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
      interval: (item?.price.recurring?.interval as "month" | "year" | undefined) ?? null,
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
  const [subscription, graphicsSubscription, dataFeedSubscription, customerInfo] = await Promise.all([
    account.stripeSubscriptionId ? safely("subscription", () => summarize(account.stripeSubscriptionId!), null) : null,
    account.graphicsSubscriptionId ? safely("graphics subscription", () => summarize(account.graphicsSubscriptionId!), null) : null,
    account.dataFeedSubscriptionId ? safely("data feed subscription", () => summarize(account.dataFeedSubscriptionId!), null) : null,
    account.stripeCustomerId ? safely("customer", () => summarizeCustomer(account.stripeCustomerId!), noCustomerInfo) : noCustomerInfo,
  ]);

  return NextResponse.json({
    plan: account.plan,
    billingInterval: account.billingInterval,
    hasStripeCustomer: Boolean(account.stripeCustomerId),
    subscription,
    addOns: account.addOns,
    graphicsSubscription,
    dataFeedSubscription,
    invoiceEmail: customerInfo.invoiceEmail,
    paymentMethod: customerInfo.paymentMethod,
    upgradeDiscountAvailable: account.upgradeDiscountUsedAt === null,
    stripeUnavailable,
  });
}
