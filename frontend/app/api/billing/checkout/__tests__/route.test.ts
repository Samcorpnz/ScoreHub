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
const portalSessionsCreateMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a),
      update: (...a: unknown[]) => subscriptionsUpdateMock(...a),
    },
    customers: { create: (...a: unknown[]) => customersCreateMock(...a) },
    checkout: { sessions: { create: (...a: unknown[]) => checkoutSessionsCreateMock(...a) } },
    billingPortal: { sessions: { create: (...a: unknown[]) => portalSessionsCreateMock(...a) } },
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
      portalSessionsCreateMock,
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

  describe("changing an existing subscription", () => {
    // Plan and add-on changes go to Stripe's billing-portal confirm page
    // rather than updating the subscription directly, so the customer sees
    // the new price and prorated amount and confirms it themselves.
    const confirmFlow = (subscription: string, item: string, price: string, extra: Record<string, unknown> = {}) => ({
      customer: "cus_1",
      return_url: "http://localhost:3000/account",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription, items: [{ id: item, price, quantity: 1 }], ...extra },
        after_completion: { type: "redirect", redirect: { return_url: "http://localhost:3000/account?billing=updated" } },
      },
    });
    function requestFrom(body: unknown) {
      return new NextRequest("http://localhost/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { origin: "http://localhost:3000" },
      });
    }

    beforeEach(() => {
      portalSessionsCreateMock.mockResolvedValue({ url: "https://billing.stripe.com/p/session/test_1" });
    });

    it("sends a base-plan change to Stripe's confirm page instead of changing it directly", async () => {
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "pro", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_existing", upgradeDiscountUsedAt: new Date("2026-01-01") }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_venue_year" } }] } });

      const { POST } = await import("../route");
      const res = await POST(requestFrom({ plan: "venue", interval: "year" }));

      expect(portalSessionsCreateMock).toHaveBeenCalledWith(confirmFlow("sub_existing", "si_1", "price_pro_month"));
      expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
      expect(accountUpdateMock).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ confirmUrl: "https://billing.stripe.com/p/session/test_1" });
    });

    it("offers the upgrade discount on the confirm page when the account hasn't used it", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "pro", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_existing" }));
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_pro_year" } }] } });

      const { POST } = await import("../route");
      await POST(requestFrom({ plan: "venue", interval: "year" }));

      expect(portalSessionsCreateMock).toHaveBeenCalledWith(
        confirmFlow("sub_existing", "si_1", "price_pro_month", { discounts: [{ coupon: "UPGRADE20" }] }),
      );
    });

    it("confirms an add-on's interval change against that add-on's own subscription", async () => {
      priceIdForAddOnMock.mockReturnValue("price_data_feed_year");
      getAccountForOrgMock.mockResolvedValue(
        baseAccount({ plan: "venue", stripeCustomerId: "cus_1", addOns: ["data-feed"], dataFeedSubscriptionId: "sub_datafeed" }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_3", price: { id: "price_data_feed_month" } }] } });

      const { POST } = await import("../route");
      await POST(requestFrom({ addOn: "data-feed", interval: "year" }));

      expect(subscriptionsRetrieveMock).toHaveBeenCalledWith("sub_datafeed");
      expect(portalSessionsCreateMock).toHaveBeenCalledWith(confirmFlow("sub_datafeed", "si_3", "price_data_feed_year"));
    });

    it("400s when the subscription is already on that price", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "pro", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_existing" }));
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_pro_month" } }] } });

      const { POST } = await import("../route");
      const res = await POST(requestFrom({ plan: "pro" }));
      expect(res.status).toBe(400);
      expect(portalSessionsCreateMock).not.toHaveBeenCalled();
    });

    it("500s when the existing subscription has no items to change", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "pro", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_existing" }));
      subscriptionsRetrieveMock.mockResolvedValue({ items: { data: [] } });

      const { POST } = await import("../route");
      const res = await POST(requestFrom({ plan: "venue" }));
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
