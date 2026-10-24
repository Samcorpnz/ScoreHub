// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@scorehub/db", () => ({ prisma: {} }));

import { planAddOn } from "../migrate-addon-subscriptions";

function sub(id: string, items: { product: string; price: string; interval: "month" | "year" }[], extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "active",
    cancel_at_period_end: false,
    items: { data: items.map(i => ({ price: { id: i.price, product: i.product, recurring: { interval: i.interval } } })) },
    ...extra,
  } as unknown as Stripe.Subscription;
}

const plan = sub("sub_plan", [{ product: "prod_pro", price: "price_pro_month", interval: "month" }]);
const graphics = sub("sub_graphics", [{ product: "prod_graphics", price: "price_graphics_month", interval: "month" }]);

describe("planAddOn", () => {
  it("moves a running add-on billed at the plan's interval onto the plan's subscription", () => {
    expect(planAddOn("graphics-operator", graphics, plan)).toEqual({
      action: "migrate", addOn: "graphics-operator", legacyId: "sub_graphics", price: "price_graphics_month", alreadyOnPlan: false,
    });
  });

  it("finishes an add-on an interrupted run already added to the plan", () => {
    const planWithAddOn = sub("sub_plan", [
      { product: "prod_pro", price: "price_pro_month", interval: "month" },
      { product: "prod_graphics", price: "price_graphics_month", interval: "month" },
    ]);
    expect(planAddOn("graphics-operator", graphics, planWithAddOn)).toMatchObject({ action: "migrate", alreadyOnPlan: true });
  });

  it("clears an old subscription that has already ended", () => {
    expect(planAddOn("graphics-operator", { ...graphics, status: "canceled" } as Stripe.Subscription, plan))
      .toMatchObject({ action: "clear-stale" });
  });

  it("leaves an add-on alone when it's billed at a different interval from the plan", () => {
    const annual = sub("sub_graphics", [{ product: "prod_graphics", price: "price_graphics_year", interval: "year" }]);
    expect(planAddOn("graphics-operator", annual, plan)).toMatchObject({ action: "skip", reason: expect.stringMatching(/by hand/) });
  });

  it("lets an add-on that's already cancelling run out", () => {
    expect(planAddOn("graphics-operator", { ...graphics, cancel_at_period_end: true } as Stripe.Subscription, plan))
      .toMatchObject({ action: "skip" });
  });

  it("skips when there's no running plan subscription to move onto", () => {
    expect(planAddOn("data-feed", graphics, null)).toMatchObject({ action: "skip" });
    expect(planAddOn("data-feed", graphics, { ...plan, status: "unpaid" } as Stripe.Subscription)).toMatchObject({ action: "skip" });
    expect(planAddOn("data-feed", graphics, { ...plan, cancel_at_period_end: true } as Stripe.Subscription)).toMatchObject({ action: "skip" });
    expect(planAddOn("data-feed", graphics, { ...plan, schedule: "sub_sched_1" } as Stripe.Subscription)).toMatchObject({ action: "skip" });
  });
});
