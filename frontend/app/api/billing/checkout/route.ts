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
import { KNOWN_ADDONS, readSubscription, currentPeriodEnd, syncAccountFromSubscription, SubscriptionContents } from "@/lib/billing";
import { readScheduledChange, scheduleChange, cancelScheduledChange, withScheduledChangeKept, ScheduledChange } from "@/lib/scheduledChanges";

type Account = NonNullable<Awaited<ReturnType<typeof getAccountForOrg>>>;

// confirm/prorationDate only apply to changing an existing subscription: the
// first call previews the cost, the confirming call repeats it with
// confirm: true and the prorationDate the preview returned.
type CheckoutRequest = {
  plan?: PaidPlan;
  addOn?: AddOn;
  interval: BillingInterval;
  confirm: boolean;
  prorationDate?: number;
};

// Validates the request body against the plan/addOn/interval rules. Returns
// either the parsed request or a NextResponse to return as-is.
function parseCheckoutRequest(body: unknown): CheckoutRequest | NextResponse {
  const fields = (body as Record<string, unknown> | null) ?? {};
  const plan = fields.plan as PaidPlan | undefined;
  const addOn = fields.addOn as AddOn | undefined;
  const interval = (fields.interval as BillingInterval | undefined) ?? "month";
  const confirm = fields.confirm === true;
  const prorationDate = typeof fields.prorationDate === "number" ? fields.prorationDate : undefined;

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
  return { plan, addOn, interval, confirm, prorationDate };
}

// How long a preview's price holds: an admin confirming later than this pays
// the proration as of the moment they confirm.
const PRORATION_DATE_MAX_AGE_SECONDS = 15 * 60;

type PlannedChange =
  // Made to the subscription now. A monthly -> annual switch restarts the
  // billing period, so Stripe bills it straight away (chargedNow);
  // everything else waits for the next renewal invoice.
  | {
    kind: "update";
    items: Stripe.SubscriptionUpdateParams.Item[];
    prorationBehavior: "create_prorations" | "always_invoice" | "none";
    chargedNow: boolean;
  }
  // A downgrade — a lower plan, or annual -> monthly. Nothing is refunded:
  // the current plan runs to the end of the period already paid for, then
  // the subscription switches (see lib/scheduledChanges.ts).
  | { kind: "schedule"; target: { plan: PaidPlan; interval: BillingInterval } }
  // Back to the plan the subscription is on now: drops the pending downgrade.
  | { kind: "keep" };

function addOnChange(account: Account, current: SubscriptionContents, addOn: AddOn): PlannedChange | string {
  if (current.addOnItems[addOn]) return "You already have that add-on.";
  if (!current.interval) return "Your plan's billing interval couldn't be read.";
  // Taken off earlier but still paid up to the period end: putting it back
  // costs nothing now, and it renews with the plan as before.
  const resuming = account.addOnsEnding.includes(addOn);
  return {
    kind: "update",
    items: [{ price: priceIdForAddOn(addOn, current.interval), quantity: 1 }],
    prorationBehavior: resuming ? "none" : "create_prorations",
    chargedNow: false,
  };
}

// Works out how the account's one subscription changes for this request, or
// the error to show. Add-ons always follow the plan's interval: Stripe can't
// mix monthly and annual items on one subscription.
function planChange(
  account: Account,
  subscription: Stripe.Subscription,
  { plan, addOn, interval }: CheckoutRequest,
  applyDiscount: boolean,
  pending: ScheduledChange | null,
): PlannedChange | string {
  const current = readSubscription(subscription);
  if (addOn) return addOnChange(account, current, addOn);

  if (!current.planItem || !current.plan) return "Your current plan couldn't be read.";
  if (current.plan === plan && current.interval === interval) {
    return pending ? { kind: "keep" } : "You're already on that plan.";
  }
  if (pending && pending.plan === plan && pending.interval === interval) {
    return "That change is already scheduled for the end of your billing period.";
  }
  const planDown = isPlanUpgrade(plan!, current.plan);
  const planUp = isPlanUpgrade(current.plan, plan!);
  const toMonthly = current.interval === "year" && interval === "month";
  if (planUp && toMonthly) {
    return "Upgrade on annual billing for now. You can switch to monthly from your next renewal.";
  }
  if (planDown || toMonthly) return { kind: "schedule", target: { plan: plan!, interval } };

  const intervalChanges = current.interval !== interval;
  const items: Stripe.SubscriptionUpdateParams.Item[] = [{
    id: current.planItem.id,
    price: priceIdForPlan(plan!, interval),
    quantity: 1,
    // On the plan item, not the subscription, so the discount doesn't spread
    // to add-ons on the same subscription.
    ...(applyDiscount ? { discounts: [{ coupon: UPGRADE_DISCOUNT_COUPON_ID }] } : {}),
  }];
  if (intervalChanges) {
    for (const [itemAddOn, item] of Object.entries(current.addOnItems) as [AddOn, Stripe.SubscriptionItem][]) {
      items.push({ id: item.id, price: priceIdForAddOn(itemAddOn, interval), quantity: 1 });
    }
  }
  return {
    kind: "update",
    items,
    prorationBehavior: intervalChanges ? "always_invoice" : "create_prorations",
    chargedNow: intervalChanges,
  };
}

// The confirm repeats the preview's date so the charge matches what was
// shown, but only a recent one: a date late in the period would make the
// prorated charge for the rest of it close to nothing.
function trustedProrationDate(requested: number | undefined, nowSeconds: number): number {
  const recent = requested !== undefined && requested <= nowSeconds && requested >= nowSeconds - PRORATION_DATE_MAX_AGE_SECONDS;
  return recent ? requested : nowSeconds;
}

function prorationTotal(invoice: Stripe.Invoice): number {
  return invoice.lines.data
    .filter(line => line.parent?.subscription_item_details?.proration || line.parent?.invoice_item_details?.proration)
    .reduce((sum, line) => sum + line.amount, 0);
}

// Tax on a previewed invoice: GST from Stripe Tax at the customer's address.
function taxOf(invoice: Stripe.Invoice): number {
  return invoice.total - (invoice.total_excluding_tax ?? invoice.total);
}

// What a scheduled downgrade will bill each period once it starts: the
// target plan and the add-ons moving with it, previewed as a new
// subscription of those items so Stripe Tax works out the GST.
async function previewScheduledPeriod(
  stripe: Stripe,
  customerId: string,
  subscription: Stripe.Subscription,
  target: { plan: PaidPlan; interval: BillingInterval },
) {
  const addOns = Object.keys(readSubscription(subscription).addOnItems) as AddOn[];
  const preview = await stripe.invoices.createPreview({
    customer: customerId,
    automatic_tax: { enabled: subscription.automatic_tax?.enabled ?? true },
    subscription_details: {
      items: [
        { price: priceIdForPlan(target.plan, target.interval), quantity: 1 },
        ...addOns.map(addOn => ({ price: priceIdForAddOn(addOn, target.interval), quantity: 1 })),
      ],
    },
  });
  return { total: preview.total, tax: taxOf(preview), currency: preview.currency };
}

async function previewChange(
  stripe: Stripe,
  customerId: string,
  subscription: Stripe.Subscription,
  change: PlannedChange,
  prorationDate: number,
) {
  const periodEnd = currentPeriodEnd(subscription);
  if (change.kind === "keep") {
    return { kind: change.kind, chargedNow: false, amountDue: 0, tax: 0, prorated: 0, currency: subscription.currency, invoiceDate: periodEnd, effectiveAt: null, prorationDate };
  }
  if (change.kind === "schedule") {
    const period = await previewScheduledPeriod(stripe, customerId, subscription, change.target);
    return {
      kind: change.kind,
      chargedNow: false,
      amountDue: period.total,
      tax: period.tax,
      prorated: 0,
      currency: period.currency,
      invoiceDate: periodEnd,
      effectiveAt: periodEnd,
      interval: change.target.interval,
      prorationDate,
    };
  }
  const preview = await stripe.invoices.createPreview({
    customer: customerId,
    subscription: subscription.id,
    subscription_details: {
      items: change.items,
      proration_behavior: change.prorationBehavior,
      ...(change.prorationBehavior === "none" ? {} : { proration_date: prorationDate }),
    },
  });
  return {
    kind: change.kind,
    chargedNow: change.chargedNow,
    amountDue: preview.amount_due,
    tax: taxOf(preview),
    prorated: prorationTotal(preview),
    currency: preview.currency,
    // Without an immediate charge, the cost lands on the renewal invoice.
    invoiceDate: change.chargedNow ? null : periodEnd,
    effectiveAt: null,
    prorationDate,
  };
}

// Makes an "update" change. A plan change replaces any pending downgrade;
// an add-on change keeps it (rebuilt to include the add-on change).
async function applyUpdate(
  stripe: Stripe,
  account: Account,
  subscription: Stripe.Subscription,
  change: Extract<PlannedChange, { kind: "update" }>,
  prorationDate: number,
  isPlanChange: boolean,
): Promise<Stripe.Subscription> {
  const update = () => stripe.subscriptions.update(subscription.id, {
    items: change.items,
    proration_behavior: change.prorationBehavior,
    ...(change.prorationBehavior === "none" ? {} : { proration_date: prorationDate }),
    // An immediate charge that fails or needs the bank's confirmation leaves
    // the subscription as it was, rather than switching it and leaving an
    // unpaid invoice behind.
    ...(change.chargedNow ? { payment_behavior: "error_if_incomplete" as const } : {}),
    metadata: { accountId: account.id },
  });
  if (!isPlanChange) return withScheduledChangeKept(stripe, subscription, update);
  await cancelScheduledChange(stripe, subscription);
  return update();
}

// Changes the account's existing subscription: Pro <-> Venue, monthly <->
// annual, or adding an add-on. It's charged to the card already on file, so
// there's no Checkout. Upgrades happen now; downgrades at the period end.
// The first call (confirm unset) returns what it will cost for the admin to
// confirm. The second applies it, using the same proration date so the
// amount matches what they were shown.
async function changeSubscription(
  stripe: Stripe,
  account: Account,
  subscriptionId: string,
  request: CheckoutRequest,
  discountEligible: boolean,
): Promise<NextResponse> {
  if (!account.stripeCustomerId) {
    return NextResponse.json({ error: "no billing account on file" }, { status: 500 });
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const pending = await readScheduledChange(stripe, subscription);
  const prorationDate = trustedProrationDate(request.prorationDate, Math.floor(Date.now() / 1000));

  if (!request.confirm) {
    const change = planChange(account, subscription, request, discountEligible, pending);
    if (typeof change === "string") return NextResponse.json({ error: change }, { status: 400 });
    return NextResponse.json({
      preview: await previewChange(stripe, account.stripeCustomerId, subscription, change, prorationDate),
    });
  }

  // The upgrade offer is once per account. Claim it in one conditional
  // update before the change is made, so two confirms racing each other
  // can't both get it.
  let applyDiscount = false;
  if (discountEligible) {
    const claimed = await prisma.account.updateMany({
      where: { id: account.id, upgradeDiscountUsedAt: null },
      data: { upgradeDiscountUsedAt: new Date() },
    });
    applyDiscount = claimed.count === 1;
  }
  const releaseDiscount = () => applyDiscount
    ? prisma.account.update({ where: { id: account.id }, data: { upgradeDiscountUsedAt: null } }).then(() => {})
    : Promise.resolve();
  const change = planChange(account, subscription, request, applyDiscount, pending);
  if (typeof change === "string") {
    await releaseDiscount();
    return NextResponse.json({ error: change }, { status: 400 });
  }

  if (change.kind === "keep") {
    await cancelScheduledChange(stripe, subscription);
    return NextResponse.json({ updated: true });
  }
  if (change.kind === "schedule") {
    await scheduleChange(stripe, subscription, change.target);
    return NextResponse.json({ updated: true });
  }

  let updated: Stripe.Subscription;
  try {
    updated = await applyUpdate(stripe, account, subscription, change, prorationDate, Boolean(request.plan));
  } catch (err) {
    await releaseDiscount();
    if (err instanceof Stripe.errors.StripeCardError) {
      return NextResponse.json({
        error: "Your card couldn't be charged for this change, so nothing was changed. Update your card under Manage billing, then try again.",
      }, { status: 402 });
    }
    throw err;
  }
  // A monthly -> annual switch starts a new period, so add-ons that were
  // ending at the old period end have now run their course.
  const syncFrom = change.chargedNow ? { ...account, addOnsEnding: [], addOnsEndAt: null } : account;
  await syncAccountFromSubscription(syncFrom, updated);
  return NextResponse.json({ updated: true });
}

// Embedded mode keeps the customer on /control instead of redirecting to a
// Stripe-hosted page. redirect_on_completion "never" + the client-side
// onComplete callback handles completion in place, so no return_url is
// needed — the control panel is already a single-page tab-switching UI.
//
// Checkout won't take customer_email alongside customer, so the signed-in
// admin's email goes on the Customer instead, which prefills Checkout's email
// field. An existing Customer's email is only filled in when it has none, so
// a billing email changed in the portal isn't overwritten.
async function createNewCheckoutSession(
  stripe: Stripe,
  account: Account,
  priceId: string,
  request: CheckoutRequest,
  discountEligible: boolean,
  email: string | undefined,
): Promise<NextResponse> {
  const plan = request.plan!;
  let customerId = account.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: account.name,
      ...(email ? { email } : {}),
      metadata: { accountId: account.id },
    });
    customerId = customer.id;
    await prisma.account.update({ where: { id: account.id }, data: { stripeCustomerId: customerId } });
  } else if (email) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && !customer.email) {
      await stripe.customers.update(customerId, { email });
    }
  }

  const metadata: Record<string, string> = { accountId: account.id, plan, ...(discountEligible ? { discounted: "true" } : {}) };
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

// The subscription a change applies to, if the account is still on a paid
// plan. A saved id alone isn't enough: it can linger after the plan lapsed.
function activeSubscriptionId(account: Account): string | null {
  const onPaidPlan = account.plan === "pro" || account.plan === "venue";
  return onPaidPlan ? account.stripeSubscriptionId : null;
}

// Turns a Stripe failure (a price that doesn't exist in the account the key
// belongs to, a network error, …) into a response the billing page can show,
// rather than a bodiless 500 it can't read and so can't tell the admin about.
function stripeFailureResponse(err: unknown, extra: Record<string, unknown>): NextResponse {
  const missing = err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing";
  // A price id Stripe doesn't recognise is our configuration, not the
  // customer's record: a STRIPE_PRICE_ID_* env var copied from the other
  // Stripe account (live vs sandbox), or a price deleted in the dashboard.
  if (missing && err.param?.includes("price")) {
    console.error("[billing] checkout: configured price not found in Stripe:", err);
    Sentry.captureException(err, { tags: { area: "billing-checkout", stage: "config" }, extra });
    return NextResponse.json({ error: "billing is not configured" }, { status: 500 });
  }
  // A saved subscription/customer id Stripe doesn't recognise means our
  // record and Stripe have drifted apart (an id saved against a different
  // Stripe account, or deleted in the dashboard). Retrying won't help.
  if (missing) {
    console.error("[billing] checkout: saved billing record not found in Stripe:", err);
    Sentry.captureException(err, { tags: { area: "billing-checkout", stage: "stale-record" }, extra });
    return NextResponse.json({
      error: "Your billing record doesn't match our payment provider, so this can't be changed here. Please contact support.",
    }, { status: 409 });
  }
  console.error("[billing] checkout failed:", err);
  Sentry.captureException(err, { tags: { area: "billing-checkout", stage: "stripe" }, extra });
  return NextResponse.json({ error: "Couldn't start checkout — please try again, or contact support if it keeps happening." }, { status: 502 });
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

  // Add-ons ride on the plan's subscription — Free accounts can't buy one on
  // its own.
  const existingSubscriptionId = activeSubscriptionId(account);
  if (addOn && !existingSubscriptionId) {
    return NextResponse.json({ error: "add-ons require an active Pro or Venue plan" }, { status: 400 });
  }
  // Still billed on its own pre-migration subscription.
  if (addOn && account.addOns.includes(addOn) && account[ADDON_SUBSCRIPTION_FIELD[addOn]]) {
    return NextResponse.json({ error: "You already have that add-on." }, { status: 400 });
  }

  // Add-ons are billed at the plan's interval, whatever the request says.
  const priceInterval = addOn ? ((account.billingInterval as BillingInterval | null) ?? interval) : interval;
  let stripe, priceId;
  try {
    stripe = getStripe();
    priceId = plan ? priceIdForPlan(plan, priceInterval) : priceIdForAddOn(addOn!, priceInterval);
  } catch (err) {
    console.error("[billing] checkout config error:", err);
    Sentry.captureException(err, {
      tags: { area: "billing-checkout", stage: "config" },
      extra: { accountId: account.id, plan, addOn, interval },
    });
    return NextResponse.json({ error: "billing is not configured" }, { status: 500 });
  }

  // Only base-plan upgrades qualify for the discount (not add-ons), and only
  // once per account — see the schema comment on Account.upgradeDiscountUsedAt.
  const discountEligible =
    Boolean(plan) && isPlanUpgrade(account.plan, plan!) && !account.upgradeDiscountUsedAt;

  try {
    if (existingSubscriptionId) {
      return await changeSubscription(stripe, account, existingSubscriptionId, parsed, discountEligible);
    }
    return await createNewCheckoutSession(stripe, account, priceId, parsed, discountEligible, session.user.email ?? undefined);
  } catch (err) {
    return stripeFailureResponse(err, { accountId: account.id, plan, addOn, interval, priceId });
  }
}
