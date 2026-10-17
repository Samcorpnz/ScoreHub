// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const accountUpdateMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: { account: { update: (...a: unknown[]) => accountUpdateMock(...a) } },
}));

const subscriptionsRetrieveMock = vi.fn();
const subscriptionsUpdateMock = vi.fn();
const customersCreateMock = vi.fn();
const checkoutSessionsCreateMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a),
      update: (...a: unknown[]) => subscriptionsUpdateMock(...a),
    },
    customers: { create: (...a: unknown[]) => customersCreateMock(...a) },
    checkout: { sessions: { create: (...a: unknown[]) => checkoutSessionsCreateMock(...a) } },
  }),
}));

const priceIdForPlanMock = vi.fn();
const priceIdForAddOnMock = vi.fn();
vi.mock("@/lib/plans", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/plans")>();
  return {
    ...actual,
    priceIdForPlan: (...a: unknown[]) => priceIdForPlanMock(...a),
    priceIdForAddOn: (...a: unknown[]) => priceIdForAddOnMock(...a),
  };
});

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function baseAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc_1",
    name: "Wellington Netball",
    plan: "free",
    addOns: [] as string[],
    stripeCustomerId: null as string | null,
    stripeSubscriptionId: null as string | null,
    graphicsSubscriptionId: null as string | null,
    dataFeedSubscriptionId: null as string | null,
    ...overrides,
  };
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const m of [
      authMock,
      getAccountForOrgMock,
      accountUpdateMock,
      subscriptionsRetrieveMock,
      subscriptionsUpdateMock,
      customersCreateMock,
      checkoutSessionsCreateMock,
      priceIdForPlanMock,
      priceIdForAddOnMock,
    ]) {
      m.mockReset();
    }
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN" } });
    priceIdForPlanMock.mockReturnValue("price_pro_month");
    priceIdForAddOnMock.mockReturnValue("price_graphics_month");
  });

  it("401s when there's no session/activeOrgId", async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ plan: "pro" }));
    expect(res.status).toBe(401);
  });

  it("403s when the caller isn't ADMIN", async () => {
    authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "OPERATOR" } });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ plan: "pro" }));
    expect(res.status).toBe(403);
  });

  describe("request validation", () => {
    it("400s when both plan and addOn are given", async () => {
      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "pro", addOn: "graphics-operator" }));
      expect(res.status).toBe(400);
    });

    it("400s for an unrecognized plan", async () => {
      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "enterprise" }));
      expect(res.status).toBe(400);
    });

    it("400s for an unrecognized add-on", async () => {
      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "premium-support" }));
      expect(res.status).toBe(400);
    });

    it("400s when neither plan nor addOn is given", async () => {
      const { POST } = await import("../route");
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
    });

    it("400s for an invalid interval", async () => {
      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "pro", interval: "week" }));
      expect(res.status).toBe(400);
    });

    it("400s on unparseable JSON body", async () => {
      const { POST } = await import("../route");
      const req = new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: "not json" });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("defaults interval to 'month' when omitted", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount());
      customersCreateMock.mockResolvedValue({ id: "cus_1" });
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });
      const { POST } = await import("../route");
      await POST(makeRequest({ plan: "pro" }));
      expect(priceIdForPlanMock).toHaveBeenCalledWith("pro", "month");
    });
  });

  it("404s when the account can't be found", async () => {
    getAccountForOrgMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ plan: "pro" }));
    expect(res.status).toBe(404);
  });

  it("400s buying an add-on without an active paid base plan", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "free" }));
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ addOn: "graphics-operator" }));
    expect(res.status).toBe(400);
  });

  it("500s when billing isn't configured (priceId lookup throws)", async () => {
    getAccountForOrgMock.mockResolvedValue(baseAccount());
    priceIdForPlanMock.mockImplementation(() => {
      throw new Error("STRIPE_PRICE_ID_PRO is not configured");
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ plan: "pro" }));
    expect(res.status).toBe(500);
  });

  describe("new checkout session (no existing subscription for this line)", () => {
    it("creates a Stripe customer when the account has none, then a checkout session", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount());
      customersCreateMock.mockResolvedValue({ id: "cus_new" });
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "pro" }));

      expect(customersCreateMock).toHaveBeenCalledWith({
        name: "Wellington Netball",
        metadata: { accountId: "acc_1" },
      });
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { stripeCustomerId: "cus_new" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ clientSecret: "secret_1" });
    });

    it("reuses an existing Stripe customer id without creating a new one", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeCustomerId: "cus_existing" }));
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ plan: "pro" }));

      expect(customersCreateMock).not.toHaveBeenCalled();
      expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_existing" }),
      );
    });

    it("builds add-on metadata (not plan metadata) when buying an add-on", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "pro", stripeCustomerId: "cus_existing" }),
      );
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ addOn: "graphics-operator" }));

      expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { accountId: "acc_1", addOn: "graphics-operator" },
          subscription_data: { metadata: { accountId: "acc_1", addOn: "graphics-operator" } },
        }),
      );
    });

    it("builds metadata for the data-feed add-on too", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "venue", stripeCustomerId: "cus_existing" }),
      );
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ addOn: "data-feed" }));

      expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { accountId: "acc_1", addOn: "data-feed" },
          subscription_data: { metadata: { accountId: "acc_1", addOn: "data-feed" } },
        }),
      );
    });

    it("returns a readable error, not a bodiless 500, when Stripe rejects the checkout", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "pro", stripeCustomerId: "cus_existing" }));
      checkoutSessionsCreateMock.mockRejectedValue(new Error("No such price: 'price_x'"));

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "graphics-operator" }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/Couldn't start checkout/);
    });

    it("500s when Stripe doesn't return a client_secret", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeCustomerId: "cus_existing" }));
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: null });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "pro" }));
      expect(res.status).toBe(500);
    });
  });

  describe("switching an existing subscription", () => {
    it("switches the base plan in place via a subscription item update", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({
          plan: "pro",
          stripeSubscriptionId: "sub_existing",
          upgradeDiscountUsedAt: new Date("2026-01-01"),
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_1" }] } });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "venue", interval: "year" }));

      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_existing", {
        items: [{ id: "si_1", price: "price_pro_month" }],
        proration_behavior: "create_prorations",
        metadata: { accountId: "acc_1", plan: "venue" },
      });
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { plan: "venue", billingInterval: "year" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ switched: true, plan: "venue", interval: "year", discountApplied: false });
    });

    it("applies the upgrade discount when the account hasn't used it yet", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "pro", stripeSubscriptionId: "sub_existing" }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_1" }] } });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "venue", interval: "year" }));

      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_existing", {
        items: [{ id: "si_1", price: "price_pro_month" }],
        proration_behavior: "create_prorations",
        metadata: { accountId: "acc_1", plan: "venue" },
        discounts: [{ coupon: "UPGRADE20" }],
      });
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { plan: "venue", billingInterval: "year", upgradeDiscountUsedAt: expect.any(Date) },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ switched: true, plan: "venue", interval: "year", discountApplied: true });
    });

    it("switches an existing add-on subscription without touching Account.plan", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({
          plan: "pro",
          addOns: ["graphics-operator"],
          graphicsSubscriptionId: "sub_graphics",
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_2" }] } });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "graphics-operator", interval: "year" }));

      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_graphics", {
        items: [{ id: "si_2", price: "price_graphics_month" }],
        proration_behavior: "create_prorations",
        metadata: { accountId: "acc_1", addOn: "graphics-operator" },
      });
      expect(accountUpdateMock).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ switched: true, addOn: "graphics-operator", interval: "year" });
    });

    it("switches an existing data-feed add-on subscription using its own dedicated field", async () => {
      priceIdForAddOnMock.mockReturnValue("price_data_feed_month");
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({
          plan: "venue",
          addOns: ["data-feed"],
          dataFeedSubscriptionId: "sub_datafeed",
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_3" }] } });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ addOn: "data-feed", interval: "year" }));

      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_datafeed", {
        items: [{ id: "si_3", price: "price_data_feed_month" }],
        proration_behavior: "create_prorations",
        metadata: { accountId: "acc_1", addOn: "data-feed" },
      });
      expect(accountUpdateMock).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ switched: true, addOn: "data-feed", interval: "year" });
    });

    it("500s when the existing subscription has no items to switch", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "pro", stripeSubscriptionId: "sub_existing" }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [] } });

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "venue" }));
      expect(res.status).toBe(500);
    });

    it("does not treat a stale subscription id as 'existing' once the plan/add-on list no longer matches", async () => {
      // account.plan is free but stripeSubscriptionId lingers from a lapsed
      // sub — hasExistingSubscription requires plan===pro/venue too.
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "free", stripeSubscriptionId: "sub_stale", stripeCustomerId: "cus_1" }),
      );
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ plan: "pro" }));

      expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
      expect(checkoutSessionsCreateMock).toHaveBeenCalled();
    });
  });
});
