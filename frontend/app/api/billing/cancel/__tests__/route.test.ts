// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const subscriptionsUpdateMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn();
const schedulesReleaseMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      update: (...a: unknown[]) => subscriptionsUpdateMock(...a),
      retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a),
    },
    subscriptionSchedules: { release: (...a: unknown[]) => schedulesReleaseMock(...a) },
  }),
}));

const accountUpdateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: { account: { update: (...a: unknown[]) => accountUpdateMock(...a) } },
}));

const PERIOD_END = 1_800_000_000;
function item(id: string, price: string) {
  return { id, current_period_end: PERIOD_END, price: { id: price, recurring: { interval: "month" } } };
}
function subscription(...items: ReturnType<typeof item>[]) {
  return { id: "sub_base", status: "active", metadata: {}, items: { data: items } };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/billing/cancel", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function baseAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc_1",
    stripeSubscriptionId: "sub_base",
    plan: "pro",
    billingInterval: "month",
    addOns: [] as string[],
    addOnsEnding: [] as string[],
    addOnsEndAt: null as Date | null,
    graphicsSubscriptionId: "sub_graphics",
    dataFeedSubscriptionId: "sub_datafeed",
    ...overrides,
  };
}

describe("POST /api/billing/cancel", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    getAccountForOrgMock.mockReset();
    subscriptionsUpdateMock.mockReset();
    subscriptionsRetrieveMock.mockReset();
    subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month")));
    schedulesReleaseMock.mockReset();
    accountUpdateMock.mockReset();
    accountUpdateMock.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...baseAccount(), ...data }));
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_month";
    process.env.STRIPE_PRICE_ID_GRAPHICS = "price_graphics_month";
    process.env.STRIPE_PRICE_ID_DATA_FEED = "price_data_feed_month";
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
  });

  it("401s when there's no session/activeOrgId", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("403s when the caller isn't ADMIN", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "OPERATOR" } });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(403);
  });

  it("400s for an unknown add-on", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ addOn: "premium-support" }));
    expect(res.status).toBe(400);
  });

  it("400s on unparseable JSON body (treated as no body)", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    subscriptionsUpdateMock.mockResolvedValue({ cancel_at_period_end: true });
    const req = new NextRequest("http://localhost/api/billing/cancel", { method: "POST", body: "not json" });
    const { POST } = await import("../route");
    const res = await POST(req);
    // body becomes null -> resume defaults false, addOn undefined -> proceeds using base subscription
    expect(res.status).toBe(200);
  });

  it("404s when there's no active base subscription to cancel", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeSubscriptionId: null }));
    const { POST } = await import("../route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(404);
  });

  it("404s cancelling an add-on with no subscription at all", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeSubscriptionId: null, graphicsSubscriptionId: null }));
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ addOn: "graphics-operator" }));
    expect(res.status).toBe(404);
  });

  describe("an add-on on the plan's subscription", () => {
    const account = (overrides: Record<string, unknown> = {}) =>
      baseAccount({ graphicsSubscriptionId: null, dataFeedSubscriptionId: null, addOns: ["graphics-operator"], ...overrides });

    it("takes the item off without a refund and keeps the add-on until the paid period ends", async () => {
      getAccountForOrgMock.mockResolvedValue(account());
      subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month"), item("si_2", "price_graphics_month")));
      subscriptionsUpdateMock.mockResolvedValue(subscription(item("si_1", "price_pro_month")));

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "graphics-operator" }));

      // Marked as ending before the item comes off, so the webhook that
      // removal sets off doesn't revoke it
      expect(accountUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(subscriptionsUpdateMock.mock.invocationCallOrder[0]);
      expect(accountUpdateMock).toHaveBeenNthCalledWith(1, {
        where: { id: "acc_1" },
        data: { addOnsEnding: ["graphics-operator"], addOnsEndAt: new Date(PERIOD_END * 1000) },
      });
      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_base", {
        items: [{ id: "si_2", deleted: true }],
        proration_behavior: "none",
      });
      expect(accountUpdateMock).toHaveBeenLastCalledWith({
        where: { id: "acc_1" },
        data: expect.objectContaining({ addOns: ["graphics-operator"], addOnsEnding: ["graphics-operator"] }),
      });
      expect(await res.json()).toEqual({ cancelAtPeriodEnd: true });
    });

    it("puts an ending add-on back without charging for the period already paid", async () => {
      getAccountForOrgMock.mockResolvedValue(account({
        addOnsEnding: ["graphics-operator"],
        addOnsEndAt: new Date(PERIOD_END * 1000),
      }));
      subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month")));
      subscriptionsUpdateMock.mockResolvedValue(subscription(item("si_1", "price_pro_month"), item("si_3", "price_graphics_month")));

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "graphics-operator", resume: true }));

      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_base", {
        items: [{ price: "price_graphics_month", quantity: 1 }],
        proration_behavior: "none",
      });
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: expect.objectContaining({ addOns: ["graphics-operator"], addOnsEnding: [], addOnsEndAt: null }),
      });
      expect(await res.json()).toEqual({ cancelAtPeriodEnd: false });
    });

    it("won't resume for free an add-on whose paid period has run out", async () => {
      getAccountForOrgMock.mockResolvedValue(account({
        addOnsEnding: ["graphics-operator"],
        addOnsEndAt: new Date(Date.now() - 60_000),
      }));
      subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month")));

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "graphics-operator", resume: true }));

      expect(res.status).toBe(409);
      expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
    });

    it("leaves the subscription alone resuming an add-on that isn't ending", async () => {
      getAccountForOrgMock.mockResolvedValue(account());
      subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month"), item("si_2", "price_graphics_month")));

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "graphics-operator", resume: true }));

      expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ cancelAtPeriodEnd: false });
    });
  });

  it("sets cancel_at_period_end: true on the base subscription by default", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    subscriptionsUpdateMock.mockResolvedValue({ cancel_at_period_end: true });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({}));
    expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_base", { cancel_at_period_end: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelAtPeriodEnd: true });
  });

  it("drops a scheduled downgrade before cancelling the plan, which Stripe requires", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    subscriptionsRetrieveMock.mockResolvedValue({ ...subscription(item("si_1", "price_pro_month")), schedule: "sub_sched_1" });
    subscriptionsUpdateMock.mockResolvedValue({ cancel_at_period_end: true });
    const { POST } = await import("../route");
    await POST(makeRequest({}));
    expect(schedulesReleaseMock).toHaveBeenCalledWith("sub_sched_1");
    expect(schedulesReleaseMock.mock.invocationCallOrder[0]).toBeLessThan(subscriptionsUpdateMock.mock.invocationCallOrder[0]);
  });

  it("resumes (cancel_at_period_end: false) when resume: true", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    subscriptionsUpdateMock.mockResolvedValue({ cancel_at_period_end: false });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ resume: true }));
    expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_base", { cancel_at_period_end: false });
    expect(await res.json()).toEqual({ cancelAtPeriodEnd: false });
  });

  it("targets the graphics add-on's own subscription while it's not yet migrated", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    subscriptionsUpdateMock.mockResolvedValue({ cancel_at_period_end: true });
    const { POST } = await import("../route");
    await POST(makeRequest({ addOn: "graphics-operator" }));
    expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_graphics", { cancel_at_period_end: true });
  });

  it("targets the data-feed subscription (its own dedicated field) when addOn is data-feed", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    subscriptionsUpdateMock.mockResolvedValue({ cancel_at_period_end: true });
    const { POST } = await import("../route");
    await POST(makeRequest({ addOn: "data-feed" }));
    expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_datafeed", { cancel_at_period_end: true });
  });
});
