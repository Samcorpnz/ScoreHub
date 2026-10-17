// Single source of truth mapping plan name + interval <-> Stripe Price ID, used
// by both the checkout route (plan name -> price ID) and the webhook handler
// (price ID on a subscription -> plan name to write to Account.plan).
export type PaidPlan = "pro" | "venue";
export type BillingInterval = "month" | "year";

const ENV_VAR: Record<PaidPlan, Record<BillingInterval, string>> = {
  pro: { month: "STRIPE_PRICE_ID_PRO", year: "STRIPE_PRICE_ID_PRO_ANNUAL" },
  venue: { month: "STRIPE_PRICE_ID_VENUE", year: "STRIPE_PRICE_ID_VENUE_ANNUAL" },
};

export function priceIdForPlan(plan: PaidPlan, interval: BillingInterval = "month"): string {
  const envVar = ENV_VAR[plan][interval];
  const priceId = process.env[envVar];
  if (!priceId) throw new Error(`${envVar} is not configured`);
  return priceId;
}

export function planForPriceId(priceId: string): PaidPlan | null {
  if (priceId === process.env.STRIPE_PRICE_ID_PRO || priceId === process.env.STRIPE_PRICE_ID_PRO_ANNUAL) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ID_VENUE || priceId === process.env.STRIPE_PRICE_ID_VENUE_ANNUAL) return "venue";
  return null;
}

// Add-ons are orthogonal to `plan` — see Account.addOns — and each bills on
// its own Stripe subscription (see ADDON_SUBSCRIPTION_FIELD below).
export type AddOn = "graphics-operator" | "data-feed";

const ADDON_ENV_VAR: Record<AddOn, Record<BillingInterval, string>> = {
  "graphics-operator": { month: "STRIPE_PRICE_ID_GRAPHICS", year: "STRIPE_PRICE_ID_GRAPHICS_ANNUAL" },
  "data-feed": { month: "STRIPE_PRICE_ID_DATA_FEED", year: "STRIPE_PRICE_ID_DATA_FEED_ANNUAL" },
};

// Which Account column tracks each add-on's own Stripe subscription id —
// see the schema comment on Account.graphicsSubscriptionId/dataFeedSubscriptionId
// for why these are dedicated columns rather than a generic join table.
export const ADDON_SUBSCRIPTION_FIELD: Record<AddOn, "graphicsSubscriptionId" | "dataFeedSubscriptionId"> = {
  "graphics-operator": "graphicsSubscriptionId",
  "data-feed": "dataFeedSubscriptionId",
};

export function priceIdForAddOn(addOn: AddOn, interval: BillingInterval = "month"): string {
  const envVar = ADDON_ENV_VAR[addOn][interval];
  const priceId = process.env[envVar];
  if (!priceId) throw new Error(`${envVar} is not configured`);
  return priceId;
}

export function addOnForPriceId(priceId: string): AddOn | null {
  if (priceId === process.env.STRIPE_PRICE_ID_GRAPHICS || priceId === process.env.STRIPE_PRICE_ID_GRAPHICS_ANNUAL) {
    return "graphics-operator";
  }
  if (priceId === process.env.STRIPE_PRICE_ID_DATA_FEED || priceId === process.env.STRIPE_PRICE_ID_DATA_FEED_ANNUAL) {
    return "data-feed";
  }
  return null;
}

// Same coupon id in both the test and live Stripe accounts (we chose the id
// ourselves at creation time), so — unlike price ids — it doesn't need a
// per-environment env var. Applies to any plan upgrade (Free -> Pro/Venue,
// Pro -> Venue); Account.upgradeDiscountUsedAt gates it to once per account.
export const UPGRADE_DISCOUNT_COUPON_ID = "UPGRADE20";

const PLAN_RANK: Record<"free" | PaidPlan, number> = { free: 0, pro: 1, venue: 2 };

export function isPlanUpgrade(fromPlan: string, toPlan: PaidPlan): boolean {
  const fromRank = PLAN_RANK[fromPlan as "free" | PaidPlan] ?? -1;
  return PLAN_RANK[toPlan] > fromRank;
}

// Days a failed renewal is retried before the account drops to Free. Quoted
// in the payment-failed email and the help centre. It is enforced by Stripe's
// retry schedule, not by this constant — see keepsPaidAccess in
// app/api/billing/webhook/route.ts.
export const PAYMENT_GRACE_DAYS = 14;
