// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const subscriptionsRetrieveMock = vi.fn();
const customersRetrieveMock = vi.fn();
const pricesRetrieveMock = vi.fn();
const schedulesRetrieveMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a) },
    subscriptionSchedules: { retrieve: (...a: unknown[]) => schedulesRetrieveMock(...a) },
    customers: { retrieve: (...a: unknown[]) => customersRetrieveMock(...a) },
    prices: { retrieve: (...a: unknown[]) => pricesRetrieveMock(...a) },
  }),
}));

const accountUpdateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: { account: { update: (...a: unknown[]) => accountUpdateMock(...a) } },
}));

function baseAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc_1",
    plan: "pro",
    billingInterval: "month",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: null,
    graphicsSubscriptionId: null,
    dataFeedSubscriptionId: null,
    addOns: [] as string[],
    addOnsEnding: [] as string[],
    addOnsEndAt: null as Date | null,
    upgradeDiscountUsedAt: null,
    ...overrides,
  };
}

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    cancel_at_period_end: false,
    currency: "nzd",
    items: {
      data: [
        {
          current_period_end: 1234567890,
          price: { id: "price_pro_month", unit_amount: 8900, recurring: { interval: "month" } },
        },
      ],
    },
    ...overrides,
  };
}

describe("GET /api/billing/status", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    getAccountForOrgMock.mockReset();
    subscriptionsRetrieveMock.mockReset();
    customersRetrieveMock.mockReset();
    pricesRetrieveMock.mockReset();
    accountUpdateMock.mockReset();
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_month";
    process.env.STRIPE_PRICE_ID_GRAPHICS = "price_graphics_month";
    process.env.STRIPE_PRICE_ID_DATA_FEED = "price_data_feed_month";
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1" } });
    customersRetrieveMock.mockResolvedValue({
      deleted: false,
      email: "billing@example.com",
      invoice_settings: { default_payment_method: null },
    });
  });

  it("401s when there's no session/activeOrgId", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("404s when the account can't be found", async () => {
    getAccountForOrgMock.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns nulls for subscription/graphicsSubscription when neither id is set", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "free", stripeCustomerId: null }));
    const { GET } = await import("../route");
    const res = await GET();
    expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      plan: "free",
      billingInterval: "month",
      hasStripeCustomer: false,
      subscription: null,
      scheduledChange: null,
      addOns: [],
      graphicsSubscription: null,
      dataFeedSubscription: null,
      invoiceEmail: null,
      paymentMethod: null,
      upgradeDiscountAvailable: true,
      stripeUnavailable: false,
    });
  });

  it("still answers, flagging the gap, when a saved Stripe id isn't found", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "pro", stripeSubscriptionId: "sub_other_account", stripeCustomerId: "cus_other" }));
    subscriptionsRetrieveMock.mockRejectedValue(new Error("No such subscription: 'sub_other_account'"));
    customersRetrieveMock.mockRejectedValue(new Error("No such customer: 'cus_other'"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ plan: "pro", subscription: null, invoiceEmail: null, stripeUnavailable: true });
  });

  it("summarizes the base subscription when stripeSubscriptionId is set", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeSubscriptionId: "sub_base" }));
    subscriptionsRetrieveMock.mockResolvedValue(stripeSubscription());
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(subscriptionsRetrieveMock).toHaveBeenCalledWith("sub_base");
    expect(body.subscription).toEqual({
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: 1234567890,
      amount: 8900,
      currency: "nzd",
      interval: "month",
    });
  });

  it("summarizes both base and graphics subscriptions when both ids are set", async () => {
    getAccountForOrgMock.mockResolvedValue(
      baseAccount({
        stripeSubscriptionId: "sub_base",
        graphicsSubscriptionId: "sub_graphics",
        addOns: ["graphics-operator"],
      }),
    );
    subscriptionsRetrieveMock.mockImplementation(async (id: string) =>
      stripeSubscription({ status: id === "sub_graphics" ? "trialing" : "active" }),
    );
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(subscriptionsRetrieveMock).toHaveBeenCalledWith("sub_base");
    expect(subscriptionsRetrieveMock).toHaveBeenCalledWith("sub_graphics");
    expect(body.graphicsSubscription.status).toBe("trialing");
    expect(body.addOns).toEqual(["graphics-operator"]);
  });

  it("summarizes add-ons billed as items on the plan's subscription", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeSubscriptionId: "sub_base", addOns: ["graphics-operator"] }));
    subscriptionsRetrieveMock.mockResolvedValue(stripeSubscription({
      items: { data: [
        { current_period_end: 1234567890, price: { id: "price_graphics_month", unit_amount: 2900, recurring: { interval: "month" } } },
        { current_period_end: 1234567890, price: { id: "price_pro_month", unit_amount: 8900, recurring: { interval: "month" } } },
      ] },
    }));
    const { GET } = await import("../route");
    const body = await (await GET()).json();
    // One subscription, looked up once
    expect(subscriptionsRetrieveMock).toHaveBeenCalledTimes(1);
    expect(body.subscription.amount).toBe(8900);
    expect(body.graphicsSubscription).toEqual({
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: 1234567890,
      amount: 2900,
      currency: "nzd",
      interval: "month",
    });
    expect(body.dataFeedSubscription).toBeNull();
  });

  it("shows an add-on taken off the subscription as cancelling at the end of the paid period", async () => {
    const endAt = new Date(Date.now() + 86_400_000);
    getAccountForOrgMock.mockResolvedValue(baseAccount({
      stripeSubscriptionId: "sub_base",
      addOns: ["data-feed"],
      addOnsEnding: ["data-feed"],
      addOnsEndAt: endAt,
    }));
    subscriptionsRetrieveMock.mockResolvedValue(stripeSubscription());
    pricesRetrieveMock.mockResolvedValue({ unit_amount: 3900, currency: "nzd", recurring: { interval: "month" } });
    const { GET } = await import("../route");
    const body = await (await GET()).json();
    expect(body.dataFeedSubscription).toEqual({
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: Math.floor(endAt.getTime() / 1000),
      amount: 3900,
      currency: "nzd",
      interval: "month",
    });
    expect(accountUpdateMock).not.toHaveBeenCalled();
  });

  it("ends an add-on whose paid period is over, if the renewal webhook hasn't yet", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({
      stripeSubscriptionId: "sub_base",
      addOns: ["data-feed"],
      addOnsEnding: ["data-feed"],
      addOnsEndAt: new Date(Date.now() - 1000),
    }));
    subscriptionsRetrieveMock.mockResolvedValue(stripeSubscription());
    accountUpdateMock.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...baseAccount({ stripeSubscriptionId: "sub_base" }), ...data }));
    const { GET } = await import("../route");
    const body = await (await GET()).json();
    expect(accountUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ addOns: [], addOnsEnding: [], addOnsEndAt: null }),
    }));
    expect(body.addOns).toEqual([]);
    expect(body.dataFeedSubscription).toBeNull();
  });

  it("reports a downgrade scheduled for the end of the period", async () => {
    process.env.STRIPE_PRICE_ID_PRO_ANNUAL = "price_pro_year";
    getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "venue", stripeSubscriptionId: "sub_base" }));
    subscriptionsRetrieveMock.mockResolvedValue(stripeSubscription({ schedule: "sub_sched_1" }));
    const at = Math.floor(Date.now() / 1000) + 86_400;
    schedulesRetrieveMock.mockResolvedValue({
      phases: [
        { start_date: at - 2_592_000, items: [{ price: "price_venue_month" }] },
        { start_date: at, items: [{ price: "price_pro_month" }, { price: "price_graphics_month" }] },
      ],
    });
    const { GET } = await import("../route");
    const body = await (await GET()).json();
    expect(schedulesRetrieveMock).toHaveBeenCalledWith("sub_sched_1");
    expect(body.scheduledChange).toEqual({ plan: "pro", interval: "month", at });
  });

  it("summarizes the data-feed subscription when dataFeedSubscriptionId is set", async () => {
    getAccountForOrgMock.mockResolvedValue(
      baseAccount({ dataFeedSubscriptionId: "sub_datafeed", addOns: ["data-feed"] }),
    );
    subscriptionsRetrieveMock.mockResolvedValue(stripeSubscription({ status: "active" }));
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(subscriptionsRetrieveMock).toHaveBeenCalledWith("sub_datafeed");
    expect(body.dataFeedSubscription.status).toBe("active");
    expect(body.addOns).toEqual(["data-feed"]);
  });

  it("surfaces invoice email and masked payment method from the Stripe customer", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    customersRetrieveMock.mockResolvedValue({
      deleted: false,
      email: "billing@example.com",
      invoice_settings: {
        default_payment_method: { type: "card", card: { brand: "visa", last4: "4242" } },
      },
    });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(customersRetrieveMock).toHaveBeenCalledWith("cus_1", {
      expand: ["invoice_settings.default_payment_method"],
    });
    expect(body.invoiceEmail).toBe("billing@example.com");
    expect(body.paymentMethod).toEqual({ brand: "visa", last4: "4242" });
  });

  it("marks the upgrade discount unavailable once the account has used it", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ upgradeDiscountUsedAt: new Date("2026-01-01") }));
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.upgradeDiscountAvailable).toBe(false);
  });

  it("handles a subscription item with no recurring interval / price data gracefully", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeSubscriptionId: "sub_base" }));
    subscriptionsRetrieveMock.mockResolvedValue(
      stripeSubscription({ items: { data: [] } }),
    );
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.subscription).toEqual({
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      amount: null,
      currency: "nzd",
      interval: null,
    });
  });
});
