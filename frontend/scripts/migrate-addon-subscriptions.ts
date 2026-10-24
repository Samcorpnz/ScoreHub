// One-off move of add-ons from their own Stripe subscription onto the plan's
// subscription, as an item, so each customer gets one invoice a period
// instead of one per add-on. New add-on purchases already work this way.
//
//   # 1. Dry run (read-only): what would change for each account, plus the
//   #    Stripe account and database host you are pointed at.
//   node --env-file=.env.local scripts/migrate-addon-subscriptions.ts
//   # 2. Apply, confirming both from step 1:
//   node --env-file=.env.local scripts/migrate-addon-subscriptions.ts --apply --confirm-stripe-account <acct_…> --confirm-host <host>
//
// Needs STRIPE_SECRET_KEY and DATABASE_URL for the same environment (Sandbox
// with the UAT database, live with production). Run it against Sandbox/UAT
// first. Safe to re-run: an account part-way through picks up where it left off.
//
// For each add-on, the add-on's price is added to the plan's subscription
// with prorations (the rest of the current period goes on the next invoice),
// then the old subscription is cancelled with a prorated credit for its
// unused time, which Stripe keeps on the customer's balance and takes off
// their next invoice. Before cancelling, the old subscription is marked
// migratedTo, so the webhook ignores its cancellation rather than taking the
// add-on away. An add-on billed at a different interval from the plan, or
// already set to cancel, is left alone and listed for a decision by hand.

import Stripe from "stripe";
import { pathToFileURL } from "node:url";
import { prisma } from "@scorehub/db";

const ADDON_FIELDS = {
  "graphics-operator": "graphicsSubscriptionId",
  "data-feed": "dataFeedSubscriptionId",
} as const;
type AddOn = keyof typeof ADDON_FIELDS;

const productOf = (item: Stripe.SubscriptionItem) =>
  typeof item.price.product === "string" ? item.price.product : item.price.product.id;
const isRunning = (sub: Stripe.Subscription) => sub.status === "active" || sub.status === "past_due";

export type Step =
  | { action: "migrate"; addOn: AddOn; legacyId: string; price: string; alreadyOnPlan: boolean }
  | { action: "clear-stale"; addOn: AddOn; legacyId: string; reason: string }
  | { action: "skip"; addOn: AddOn; legacyId: string; reason: string };

// What to do with one add-on's old subscription. Pure, so it can be tested
// without Stripe or a database.
export function planAddOn(
  addOn: AddOn,
  legacy: Stripe.Subscription,
  plan: Stripe.Subscription | null,
): Step {
  const legacyId = legacy.id;
  if (!isRunning(legacy)) {
    return { action: "clear-stale", addOn, legacyId, reason: `old subscription is ${legacy.status}` };
  }
  const legacyItem = legacy.items.data[0];
  if (!legacyItem) return { action: "skip", addOn, legacyId, reason: "old subscription has no items" };
  // Already moved onto the plan's subscription by an earlier, interrupted run
  const alreadyOnPlan = Boolean(plan?.items.data.some(i => productOf(i) === productOf(legacyItem)));
  if (alreadyOnPlan) {
    return { action: "migrate", addOn, legacyId, price: legacyItem.price.id, alreadyOnPlan };
  }
  if (legacy.cancel_at_period_end) {
    return { action: "skip", addOn, legacyId, reason: "already cancelling at its period end — let it run out" };
  }
  if (!plan || !isRunning(plan)) {
    return { action: "skip", addOn, legacyId, reason: `no running plan subscription (${plan?.status ?? "none"})` };
  }
  // Its next phase lists the items to switch to; an add-on added now would
  // be left out of it.
  if (plan.schedule) {
    return { action: "skip", addOn, legacyId, reason: "the plan has a downgrade scheduled — run again once it has taken effect" };
  }
  if (plan.cancel_at_period_end) {
    return { action: "skip", addOn, legacyId, reason: "the plan is cancelling at its period end" };
  }
  const planInterval = plan.items.data[0]?.price.recurring?.interval;
  const addOnInterval = legacyItem.price.recurring?.interval;
  if (planInterval !== addOnInterval) {
    return {
      action: "skip", addOn, legacyId,
      reason: `add-on is billed ${addOnInterval}ly but the plan ${planInterval}ly — needs a decision by hand`,
    };
  }
  return { action: "migrate", addOn, legacyId, price: legacyItem.price.id, alreadyOnPlan };
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    apply: argv.includes("--apply"),
    confirmStripeAccount: value("--confirm-stripe-account"),
    confirmHost: value("--confirm-host"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const stripe = new Stripe(secretKey);
  const stripeAccount = (await stripe.accounts.retrieveCurrent()).id;
  const dbHost = new URL(process.env.DATABASE_URL).hostname;
  console.log(`Stripe account: ${stripeAccount}`);
  console.log(`database host:  ${dbHost}`);
  if (args.apply && args.confirmStripeAccount !== stripeAccount) {
    throw new Error(`--confirm-stripe-account ${JSON.stringify(args.confirmStripeAccount)} does not match ${stripeAccount} — refusing to change anything`);
  }
  if (args.apply && args.confirmHost !== dbHost) {
    throw new Error(`--confirm-host ${JSON.stringify(args.confirmHost)} does not match ${dbHost} — refusing to change anything`);
  }

  const accounts = await prisma.account.findMany({
    where: { OR: [{ graphicsSubscriptionId: { not: null } }, { dataFeedSubscriptionId: { not: null } }] },
  });
  console.log(`\n${accounts.length} account(s) with an add-on on its own subscription\n`);
  const tally = { migrated: 0, cleared: 0, skipped: 0 };

  for (const account of accounts) {
    console.log(`${account.name} (${account.id}) — plan ${account.plan}, subscription ${account.stripeSubscriptionId ?? "none"}`);
    let plan = account.stripeSubscriptionId ? await stripe.subscriptions.retrieve(account.stripeSubscriptionId) : null;
    if (plan?.discounts.length) {
      console.log("  note: the plan's subscription has a discount, which will also apply to add-ons moved onto it");
    }

    for (const [addOn, field] of Object.entries(ADDON_FIELDS) as [AddOn, (typeof ADDON_FIELDS)[AddOn]][]) {
      const legacyId = account[field];
      if (!legacyId) continue;
      const step = planAddOn(addOn, await stripe.subscriptions.retrieve(legacyId), plan);

      if (step.action === "skip") {
        tally.skipped++;
        console.log(`  ${addOn}: SKIP — ${step.reason}`);
        continue;
      }
      if (step.action === "clear-stale") {
        tally.cleared++;
        console.log(`  ${addOn}: clear stale ${legacyId} (${step.reason})`);
        if (args.apply) {
          await prisma.account.update({ where: { id: account.id }, data: { [field]: null } });
        }
        continue;
      }

      tally.migrated++;
      console.log(`  ${addOn}: move ${legacyId} onto ${plan!.id}${step.alreadyOnPlan ? " (already added; finishing)" : ""}`);
      if (!args.apply) continue;
      const legacy = await stripe.subscriptions.retrieve(legacyId);
      await stripe.subscriptions.update(legacyId, { metadata: { ...legacy.metadata, migratedTo: plan!.id } });
      if (!step.alreadyOnPlan) {
        plan = await stripe.subscriptions.update(plan!.id, {
          items: [{ price: step.price, quantity: 1 }],
          proration_behavior: "create_prorations",
        });
      }
      await stripe.subscriptions.cancel(legacyId, { prorate: true, invoice_now: true });
      const fresh = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
      await prisma.account.update({
        where: { id: account.id },
        data: { [field]: null, addOns: [...new Set([...fresh.addOns, addOn])] },
      });
    }
  }

  console.log(`\n${tally.migrated} to move, ${tally.cleared} stale to clear, ${tally.skipped} skipped`);
  if (!args.apply) {
    console.log(`dry run — nothing changed. Re-run with --apply --confirm-stripe-account ${stripeAccount} --confirm-host ${dbHost}`);
  }
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
