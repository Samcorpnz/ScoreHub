// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

vi.mock("@scorehub/db", () => ({ prisma: {} }));

import { withScheduledChangeKept, scheduleChange } from "../scheduledChanges";

const now = () => Math.floor(Date.now() / 1000);

function fakeStripe() {
  return {
    subscriptionSchedules: {
      retrieve: vi.fn(),
      release: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

function subscription(prices: string[], schedule: string | null = null) {
  return {
    id: "sub_1",
    schedule,
    items: { data: prices.map((price, i) => ({ id: `si_${i}`, price: { id: price, recurring: { interval: "month" } } })) },
  } as unknown as Stripe.Subscription;
}

function currentPhase(prices: string[], extra: Record<string, unknown> = {}) {
  return {
    id: "sub_sched_2",
    phases: [{
      start_date: now() - 86_400,
      end_date: now() + 86_400,
      items: prices.map(price => ({ price, quantity: 1, discounts: [] })),
      discounts: [],
      automatic_tax: { enabled: true },
      collection_method: "charge_automatically",
      default_payment_method: null,
      metadata: {},
      ...extra,
    }],
  };
}

describe("scheduledChanges", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_month";
    process.env.STRIPE_PRICE_ID_PRO_ANNUAL = "price_pro_year";
    process.env.STRIPE_PRICE_ID_VENUE = "price_venue_month";
    process.env.STRIPE_PRICE_ID_GRAPHICS = "price_graphics_month";
  });

  it("passes a change straight through when no downgrade is pending", async () => {
    const stripe = fakeStripe();
    const updated = subscription(["price_pro_month"]);
    const change = vi.fn().mockResolvedValue(updated);
    expect(await withScheduledChangeKept(stripe as unknown as Stripe, subscription(["price_pro_month"]), change)).toBe(updated);
    expect(stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
  });

  it("puts the pending downgrade back as it was when the change fails", async () => {
    const stripe = fakeStripe();
    stripe.subscriptionSchedules.retrieve.mockResolvedValue({
      phases: [
        { start_date: now() - 86_400, items: [{ price: "price_venue_month" }] },
        { start_date: now() + 86_400, items: [{ price: "price_pro_month" }] },
      ],
    });
    stripe.subscriptionSchedules.create.mockResolvedValue(currentPhase(["price_venue_month"]));
    const change = vi.fn().mockRejectedValue(new Error("card declined"));

    await expect(withScheduledChangeKept(stripe as unknown as Stripe, subscription(["price_venue_month"], "sub_sched_1"), change))
      .rejects.toThrow("card declined");

    expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    const [, params] = stripe.subscriptionSchedules.update.mock.calls[0];
    expect(params.phases[1].items).toEqual([{ price: "price_pro_month", quantity: 1 }]);
  });

  it("carries the current period's discounts over, so scheduling doesn't drop them", async () => {
    const stripe = fakeStripe();
    stripe.subscriptionSchedules.create.mockResolvedValue(currentPhase(["price_venue_month"], {
      discounts: [{ coupon: null, discount: "di_sub", promotion_code: null }],
      items: [{ price: "price_venue_month", quantity: 1, discounts: [{ coupon: "UPGRADE20", discount: null, promotion_code: null }] }],
    }));

    await scheduleChange(stripe as unknown as Stripe, subscription(["price_venue_month"]), { plan: "pro", interval: "month" });

    const [, params] = stripe.subscriptionSchedules.update.mock.calls[0];
    expect(params.phases[0].discounts).toEqual([{ discount: "di_sub" }]);
    expect(params.phases[0].items).toEqual([{ price: "price_venue_month", quantity: 1, discounts: [{ coupon: "UPGRADE20" }] }]);
  });
});
