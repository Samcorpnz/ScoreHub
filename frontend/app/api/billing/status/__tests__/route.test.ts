// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const subscriptionsRetrieveMock = vi.fn();
const customersRetrieveMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a) },
    customers: { retrieve: (...a: unknown[]) => customersRetrieveMock(...a) },
  }),
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
          price: { unit_amount: 8900, recurring: { interval: "month" } },
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
