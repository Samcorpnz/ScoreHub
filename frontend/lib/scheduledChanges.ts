import Stripe from "stripe";
import { planForPriceId, priceIdForPlan, priceIdForAddOn, AddOn, PaidPlan, BillingInterval } from "@/lib/plans";
import { readSubscription } from "@/lib/billing";

// Downgrades never refund: Venue -> Pro, or annual -> monthly, take effect
// when the period already paid for ends. That's a Stripe subscription
// schedule on the account's one subscription: the current phase runs to the
// period end unchanged, then a second phase switches to the new plan and
// interval with no proration, after which the schedule releases the
// subscription to carry on as normal. A plain subscription update can't do
// this: changing the interval restarts the billing period straight away.
//
// The schedule's next phase lists every item, add-ons included, so any other
// change while one is pending goes through withScheduledChangeKept, which
// rebuilds it from the subscription as changed.

export type ScheduledChange = { plan: PaidPlan; interval: BillingInterval; at: number };

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

function scheduleId(subscription: Stripe.Subscription): string | undefined {
  return idOf(subscription.schedule);
}

function intervalOfPlanPrice(plan: PaidPlan, priceId: string): BillingInterval {
  return priceIdForPlan(plan, "year") === priceId ? "year" : "month";
}

// The plan change waiting at the end of the current period, if any.
export async function readScheduledChange(stripe: Stripe, subscription: Stripe.Subscription): Promise<ScheduledChange | null> {
  const id = scheduleId(subscription);
  if (!id) return null;
  const schedule = await stripe.subscriptionSchedules.retrieve(id);
  const now = Math.floor(Date.now() / 1000);
  const next = schedule.phases.find(phase => phase.start_date > now);
  if (!next) return null;
  for (const item of next.items) {
    const priceId = idOf(item.price);
    const plan = priceId ? planForPriceId(priceId) : null;
    if (plan && priceId) return { plan, interval: intervalOfPlanPrice(plan, priceId), at: next.start_date };
  }
  return null;
}

// Drops a pending change, leaving the subscription as it is now.
export async function cancelScheduledChange(stripe: Stripe, subscription: Stripe.Subscription): Promise<void> {
  const id = scheduleId(subscription);
  if (id) await stripe.subscriptionSchedules.release(id);
}

type PhaseDiscount = Stripe.SubscriptionScheduleUpdateParams.Phase.Discount;

function discountParams(discounts: Stripe.SubscriptionSchedule.Phase.Discount[] | Stripe.SubscriptionSchedule.Phase.Item.Discount[]): PhaseDiscount[] {
  return discounts.map(d => {
    const discount = idOf(d.discount);
    if (discount) return { discount };
    const coupon = idOf(d.coupon);
    if (coupon) return { coupon };
    return { promotion_code: idOf(d.promotion_code) };
  });
}

// The settings both phases share. Stripe unsets anything a schedule update
// leaves out, so they're carried over from the current phase.
function sharedSettings(phase: Stripe.SubscriptionSchedule.Phase) {
  return {
    ...(phase.automatic_tax ? { automatic_tax: { enabled: phase.automatic_tax.enabled } } : {}),
    ...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
    ...(idOf(phase.default_payment_method) ? { default_payment_method: idOf(phase.default_payment_method) } : {}),
    ...(phase.metadata ? { metadata: phase.metadata } : {}),
  };
}

// Switches the subscription to `target` when the current period ends,
// replacing any change already pending. Add-ons on the subscription move to
// the target's interval with it.
export async function scheduleChange(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  target: { plan: PaidPlan; interval: BillingInterval },
): Promise<void> {
  await cancelScheduledChange(stripe, subscription);
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id });
  const current = schedule.phases[0];
  const addOns = Object.keys(readSubscription(subscription).addOnItems) as AddOn[];

  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        start_date: current.start_date,
        end_date: current.end_date,
        items: current.items.map(item => ({
          price: idOf(item.price)!,
          quantity: item.quantity ?? 1,
          ...(item.discounts?.length ? { discounts: discountParams(item.discounts) } : {}),
        })),
        ...(current.discounts.length ? { discounts: discountParams(current.discounts) } : {}),
        proration_behavior: "none",
        ...sharedSettings(current),
      },
      {
        items: [
          { price: priceIdForPlan(target.plan, target.interval), quantity: 1 },
          ...addOns.map(addOn => ({ price: priceIdForAddOn(addOn, target.interval), quantity: 1 })),
        ],
        duration: { interval: target.interval, interval_count: 1 },
        proration_behavior: "none",
        ...sharedSettings(current),
      },
    ],
  });
}

// Runs a change to the subscription (adding or removing an add-on) without
// losing a pending plan change: the schedule is released first, since its
// next phase would otherwise put back the items it had listed, and set up
// again afterwards from the changed subscription. If the change fails, the
// pending change is restored as it was.
export async function withScheduledChangeKept(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  change: () => Promise<Stripe.Subscription>,
): Promise<Stripe.Subscription> {
  const pending = await readScheduledChange(stripe, subscription);
  if (!pending) return change();
  await cancelScheduledChange(stripe, subscription);
  let updated: Stripe.Subscription;
  try {
    updated = await change();
  } catch (err) {
    await scheduleChange(stripe, { ...subscription, schedule: null }, pending);
    throw err;
  }
  await scheduleChange(stripe, { ...updated, schedule: null }, pending);
  return updated;
}
