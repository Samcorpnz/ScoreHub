import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import { prisma } from "@scorehub/db";
import { getAccountForOrg } from "@/lib/account";
import { getStripe } from "@/lib/stripe";
import { ADDON_SUBSCRIPTION_FIELD, AddOn, BillingInterval, priceIdForAddOn } from "@/lib/plans";
import { KNOWN_ADDONS, readSubscription, currentPeriodEnd, syncAccountFromSubscription, isStillEnding } from "@/lib/billing";
import { cancelScheduledChange, withScheduledChangeKept } from "@/lib/scheduledChanges";

type Account = NonNullable<Awaited<ReturnType<typeof getAccountForOrg>>>;

// Downgrading to Free (or dropping an add-on) means letting the current paid
// period run out rather than revoking access immediately. For the plan that's
// cancel_at_period_end on its subscription, which takes its add-ons with it;
// the customer.subscription.deleted webhook moves the account to Free once
// the period actually ends.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.activeOrgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.activeRole !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const resume = body?.resume === true;
  const addOn = body?.addOn as AddOn | undefined;
  if (addOn && !KNOWN_ADDONS.includes(addOn)) {
    return NextResponse.json({ error: "unknown add-on" }, { status: 400 });
  }

  const account = await getAccountForOrg(session.user.activeOrgId);
  // Not yet moved onto the plan's subscription: it still cancels on its own.
  const legacySubscriptionId = addOn ? account?.[ADDON_SUBSCRIPTION_FIELD[addOn]] : null;
  const subscriptionId = legacySubscriptionId ?? account?.stripeSubscriptionId;
  if (!account || !subscriptionId) {
    return NextResponse.json({ error: "no active subscription" }, { status: 404 });
  }

  if (addOn && !legacySubscriptionId) {
    return changeAddOn(account, subscriptionId, addOn, resume);
  }

  const stripe = getStripe();
  // Stripe won't set cancel_at_period_end on a subscription a schedule
  // manages, and the plan is ending anyway, so a pending downgrade goes.
  if (!resume && !legacySubscriptionId) {
    await cancelScheduledChange(stripe, await stripe.subscriptions.retrieve(subscriptionId));
  }
  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: !resume,
  });

  return NextResponse.json({ cancelAtPeriodEnd: subscription.cancel_at_period_end });
}

// Stripe has no cancel-at-period-end for one item of a subscription. So the
// item comes off now, with no refund (proration "none") since the period is
// already paid for, and the account keeps the add-on until that period ends:
// addOnsEnding/addOnsEndAt, cleared by the renewal webhook. Resuming before
// then puts the item back, again without a charge for the period already paid.
async function changeAddOn(account: Account, subscriptionId: string, addOn: AddOn, resume: boolean): Promise<NextResponse> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const { addOnItems, interval } = readSubscription(subscription);
  const item = addOnItems[addOn];

  let updated: Stripe.Subscription;
  let current = account;
  if (resume) {
    if (item) return NextResponse.json({ cancelAtPeriodEnd: false });
    // Past its paid period: it's a new purchase now, charged as one.
    if (!isStillEnding(account, addOn)) {
      return NextResponse.json({ error: "That add-on has already ended. Add it again from the Add-ons card." }, { status: 409 });
    }
    updated = await withScheduledChangeKept(stripe, subscription, () => stripe.subscriptions.update(subscriptionId, {
      items: [{ price: priceIdForAddOn(addOn, (interval ?? account.billingInterval ?? "month") as BillingInterval), quantity: 1 }],
      proration_behavior: "none",
    }));
  } else {
    if (!item) {
      return NextResponse.json({ cancelAtPeriodEnd: account.addOnsEnding.includes(addOn) });
    }
    const periodEnd = currentPeriodEnd(subscription);
    // Recorded before the item comes off, so the webhook that removal sets
    // off already sees the add-on as ending rather than revoking it.
    current = await prisma.account.update({
      where: { id: account.id },
      data: {
        addOnsEnding: [...new Set([...account.addOnsEnding, addOn])],
        addOnsEndAt: periodEnd ? new Date(periodEnd * 1000) : new Date(),
      },
    });
    updated = await withScheduledChangeKept(stripe, subscription, () => stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, deleted: true }],
      proration_behavior: "none",
    }));
  }

  const { account: synced } = await syncAccountFromSubscription(current, updated);
  return NextResponse.json({ cancelAtPeriodEnd: synced.addOnsEnding.includes(addOn) });
}
