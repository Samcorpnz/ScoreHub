import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@scorehub/db";
import { getAccountForOrg } from "@/lib/account";
import { getStripe } from "@/lib/stripe";
import {
  priceIdForPlan,
  priceIdForAddOn,
  isPlanUpgrade,
  UPGRADE_DISCOUNT_COUPON_ID,
  ADDON_SUBSCRIPTION_FIELD,
  PaidPlan,
  AddOn,
  BillingInterval,
} from "@/lib/plans";

const KNOWN_ADDONS: AddOn[] = ["graphics-operator", "data-feed"];

type Account = NonNullable<Awaited<ReturnType<typeof getAccountForOrg>>>;

type CheckoutRequest = { plan?: PaidPlan; addOn?: AddOn; interval: BillingInterval };

// Validates the request body against the plan/addOn/interval rules. Returns
// either the parsed request or a NextResponse to return as-is.
function parseCheckoutRequest(body: unknown): CheckoutRequest | NextResponse {
  const plan = (body as Record<string, unknown> | null)?.plan as PaidPlan | undefined;
  const addOn = (body as Record<string, unknown> | null)?.addOn as AddOn | undefined;
  const interval = ((body as Record<string, unknown> | null)?.interval as BillingInterval | undefined) ?? "month";

  if (plan && addOn) {
    return NextResponse.json({ error: "specify either 'plan' or 'addOn', not both" }, { status: 400 });
  }
  if (plan && plan !== "pro" && plan !== "venue") {
    return NextResponse.json({ error: "plan must be 'pro' or 'venue'" }, { status: 400 });
  }
  if (addOn && !KNOWN_ADDONS.includes(addOn)) {
    return NextResponse.json({ error: "unknown add-on" }, { status: 400 });
  }
  if (!plan && !addOn) {
    return NextResponse.json({ error: "plan or addOn is required" }, { status: 400 });
  }
  if (interval !== "month" && interval !== "year") {
    return NextResponse.json({ error: "interval must be 'month' or 'year'" }, { status: 400 });
  }
  return { plan, addOn, interval };
}

// Already has an active subscription for this line (base plan or add-on) —
// change it rather than starting a second Checkout Session, which would
// create a second subscription and double-bill the customer. The change goes
// through the billing portal's confirm flow: Stripe shows the new price and
// the prorated amount, the customer confirms (handling 3-D Secure if their
// bank asks), and only then is the subscription updated. The
// customer.subscription.updated webhook records the new plan/interval.
async function confirmSubscriptionChange(
  stripe: Stripe,
  account: Account,
  existingSubscriptionId: string,
  priceId: string,
  discountEligible: boolean,
  origin: string,
): Promise<NextResponse> {
  if (!account.stripeCustomerId) {
    return NextResponse.json({ error: "no billing account on file" }, { status: 500 });
  }
  const subscription = await stripe.subscriptions.retrieve(existingSubscriptionId);
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) {
    return NextResponse.json({ error: "existing subscription has no items" }, { status: 500 });
  }
  if (subscription.items.data[0]?.price.id === priceId) {
    return NextResponse.json({ error: "You're already on that plan." }, { status: 400 });
  }

  // The upgrade offer is once per account. Claim it now, in one conditional
  // update, rather than when the webhook reports the confirmed change —
  // otherwise several discounted confirm pages could be opened (and each
  // confirmed) before the first webhook lands. A page opened and then
  // abandoned uses the offer up, as the old instant switch did.
  let applyDiscount = false;
  if (discountEligible) {
    const claimed = await prisma.account.updateMany({
      where: { id: account.id, upgradeDiscountUsedAt: null },
      data: { upgradeDiscountUsedAt: new Date() },
    });
    applyDiscount = claimed.count === 1;
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: `${origin}/account`,
    flow_data: {
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: existingSubscriptionId,
        items: [{ id: itemId, price: priceId, quantity: 1 }],
        ...(applyDiscount ? { discounts: [{ coupon: UPGRADE_DISCOUNT_COUPON_ID }] } : {}),
      },
      after_completion: {
        type: "redirect",
        redirect: { return_url: `${origin}/account?billing=updated` },
      },
    },
  });
  return NextResponse.json({ confirmUrl: portalSession.url });
}

// Embedded mode keeps the customer on /control instead of redirecting to a
// Stripe-hosted page. redirect_on_completion "never" + the client-side
// onComplete callback handles completion in place, so no return_url is
// needed — the control panel is already a single-page tab-switching UI.
async function createNewCheckoutSession(
  stripe: Stripe,
  account: Account,
  priceId: string,
  request: CheckoutRequest,
  discountEligible: boolean,
): Promise<NextResponse> {
  const { plan, addOn } = request;
  let customerId = account.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: account.name,
      metadata: { accountId: account.id },
    });
    customerId = customer.id;
    await prisma.account.update({ where: { id: account.id }, data: { stripeCustomerId: customerId } });
  }

  const metadata: Record<string, string> = plan
    ? { accountId: account.id, plan, ...(discountEligible ? { discounted: "true" } : {}) }
    : { accountId: account.id, addOn: addOn! };
  const checkoutSession = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    mode: "subscription",
    customer: customerId,
    client_reference_id: account.id,
    line_items: [{ price: priceId, quantity: 1 }],
    redirect_on_completion: "never",
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    metadata,
    subscription_data: { metadata },
    // Checkout can't combine an automatically-applied discount with
    // customer-entered promo codes, so only offer the code field when we're
    // not already applying the upgrade discount ourselves.
    ...(discountEligible
      ? { discounts: [{ coupon: UPGRADE_DISCOUNT_COUPON_ID }] }
      : { allow_promotion_codes: true }),
  });

  if (!checkoutSession.client_secret) {
    console.error("[billing] checkout session created without a client_secret:", checkoutSession.id);
    Sentry.captureMessage("billing checkout: session created without client_secret", {
      level: "error",
      tags: { area: "billing-checkout" },
      extra: { accountId: account.id, sessionId: checkoutSession.id },
    });
    return NextResponse.json({ error: "failed to create checkout session" }, { status: 500 });
  }
  return NextResponse.json({ clientSecret: checkoutSession.client_secret });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.activeOrgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.activeRole !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseCheckoutRequest(body);
  if (parsed instanceof NextResponse) return parsed;
  const { plan, addOn, interval } = parsed;

  const account = await getAccountForOrg(session.user.activeOrgId);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  // Add-ons ride on top of a paid base plan — Free accounts can't buy Graphics
  // on its own, and there'd be no base subscription to attach billing-portal
  // management to.
  if (addOn && account.plan !== "pro" && account.plan !== "venue") {
    return NextResponse.json({ error: "add-ons require an active Pro or Venue plan" }, { status: 400 });
  }

  let stripe, priceId;
  try {
    stripe = getStripe();
    priceId = plan ? priceIdForPlan(plan, interval) : priceIdForAddOn(addOn!, interval);
  } catch (err) {
    console.error("[billing] checkout config error:", err);
    Sentry.captureException(err, {
      tags: { area: "billing-checkout", stage: "config" },
      extra: { accountId: account.id, plan, addOn, interval },
    });
    return NextResponse.json({ error: "billing is not configured" }, { status: 500 });
  }

  const existingSubscriptionId = plan ? account.stripeSubscriptionId : account[ADDON_SUBSCRIPTION_FIELD[addOn!]];
  const hasExistingSubscription = plan
    ? Boolean(existingSubscriptionId) && (account.plan === "pro" || account.plan === "venue")
    : Boolean(existingSubscriptionId) && account.addOns.includes(addOn!);

  // Only base-plan upgrades qualify for the discount (not add-ons), and only
  // once per account — see the schema comment on Account.upgradeDiscountUsedAt.
  const discountEligible =
    Boolean(plan) && isPlanUpgrade(account.plan, plan!) && !account.upgradeDiscountUsedAt;

  // A Stripe failure here (a price that doesn't exist in the account the key
  // belongs to, a network error, …) would otherwise escape as a bodiless 500,
  // which the billing page can't read and so can't tell the admin about.
  try {
    if (hasExistingSubscription && existingSubscriptionId) {
      const origin = req.headers.get("origin") ?? process.env.NEXTAUTH_URL ?? "";
      return await confirmSubscriptionChange(stripe, account, existingSubscriptionId, priceId, discountEligible, origin);
    }
    return await createNewCheckoutSession(stripe, account, priceId, parsed, discountEligible);
  } catch (err) {
    // A saved subscription/customer id Stripe doesn't recognise means our
    // record and Stripe have drifted apart (an id saved against a different
    // Stripe account, or deleted in the dashboard). Retrying won't help.
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
      console.error("[billing] checkout: saved billing record not found in Stripe:", err);
      Sentry.captureException(err, {
        tags: { area: "billing-checkout", stage: "stale-record" },
        extra: { accountId: account.id, plan, addOn, interval },
      });
      return NextResponse.json({
        error: "Your billing record doesn't match our payment provider, so this can't be changed here. Please contact support.",
      }, { status: 409 });
    }
    console.error("[billing] checkout failed:", err);
    Sentry.captureException(err, {
      tags: { area: "billing-checkout", stage: "stripe" },
      extra: { accountId: account.id, plan, addOn, interval },
    });
    return NextResponse.json({ error: "Couldn't start checkout — please try again, or contact support if it keeps happening." }, { status: 502 });
  }
}
