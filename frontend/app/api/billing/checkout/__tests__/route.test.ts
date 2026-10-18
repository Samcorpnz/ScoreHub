// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const getAccountForOrgMock = vi.fn();
vi.mock("@/lib/account", () => ({ getAccountForOrg: (...a: unknown[]) => getAccountForOrgMock(...a) }));

const accountUpdateMock = vi.fn();
const accountUpdateManyMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    account: {
      update: (...a: unknown[]) => accountUpdateMock(...a),
      updateMany: (...a: unknown[]) => accountUpdateManyMock(...a),
    },
  },
}));

const subscriptionsRetrieveMock = vi.fn();
const subscriptionsUpdateMock = vi.fn();
const customersCreateMock = vi.fn();
const customersRetrieveMock = vi.fn();
const customersUpdateMock = vi.fn();
const checkoutSessionsCreateMock = vi.fn();
const invoicesCreatePreviewMock = vi.fn();
const schedulesCreateMock = vi.fn();
const schedulesUpdateMock = vi.fn();
const schedulesRetrieveMock = vi.fn();
const schedulesReleaseMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a),
      update: (...a: unknown[]) => subscriptionsUpdateMock(...a),
    },
    customers: {
      create: (...a: unknown[]) => customersCreateMock(...a),
      retrieve: (...a: unknown[]) => customersRetrieveMock(...a),
      update: (...a: unknown[]) => customersUpdateMock(...a),
    },
    checkout: { sessions: { create: (...a: unknown[]) => checkoutSessionsCreateMock(...a) } },
    invoices: { createPreview: (...a: unknown[]) => invoicesCreatePreviewMock(...a) },
    subscriptionSchedules: {
      create: (...a: unknown[]) => schedulesCreateMock(...a),
      update: (...a: unknown[]) => schedulesUpdateMock(...a),
      retrieve: (...a: unknown[]) => schedulesRetrieveMock(...a),
      release: (...a: unknown[]) => schedulesReleaseMock(...a),
    },
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
    addOnsEnding: [] as string[],
    addOnsEndAt: null as Date | null,
    billingInterval: null as string | null,
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
      accountUpdateManyMock,
      subscriptionsRetrieveMock,
      subscriptionsUpdateMock,
      customersCreateMock,
      customersRetrieveMock,
      customersUpdateMock,
      checkoutSessionsCreateMock,
      invoicesCreatePreviewMock,
      schedulesCreateMock,
      schedulesUpdateMock,
      schedulesRetrieveMock,
      schedulesReleaseMock,
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

    it("puts the signed-in admin's email on a new Stripe customer so Checkout prefills it", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN", email: "admin@club.nz" } });
      getAccountForOrgMock.mockResolvedValue(baseAccount());
      customersCreateMock.mockResolvedValue({ id: "cus_new" });
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ plan: "pro" }));

      expect(customersCreateMock).toHaveBeenCalledWith({
        name: "Wellington Netball",
        email: "admin@club.nz",
        metadata: { accountId: "acc_1" },
      });
    });

    it("fills in the email on an existing Stripe customer that has none", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN", email: "admin@club.nz" } });
      getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeCustomerId: "cus_existing" }));
      customersRetrieveMock.mockResolvedValue({ id: "cus_existing", email: null });
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ plan: "pro" }));

      expect(customersUpdateMock).toHaveBeenCalledWith("cus_existing", { email: "admin@club.nz" });
    });

    it("leaves an existing Stripe customer's email alone", async () => {
      authMock.mockResolvedValue({ user: { activeOrgId: "org-1", activeRole: "ADMIN", email: "admin@club.nz" } });
      getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeCustomerId: "cus_existing" }));
      customersRetrieveMock.mockResolvedValue({ id: "cus_existing", email: "billing@club.nz" });
      checkoutSessionsCreateMock.mockResolvedValue({ client_secret: "secret_1" });

      const { POST } = await import("../route");
      await POST(makeRequest({ plan: "pro" }));

      expect(customersUpdateMock).not.toHaveBeenCalled();
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

    it("returns a readable error, not a bodiless 500, when Stripe rejects the checkout", async () => {
      getAccountForOrgMock.mockResolvedValue(baseAccount({ stripeCustomerId: "cus_existing" }));
      checkoutSessionsCreateMock.mockRejectedValue(new Error("No such price: 'price_x'"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "pro" }));
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
    // The plan and its add-ons are items on one subscription, so changes are
    // made to it in place, paid with the card on file — a preview first, then
    // the confirmed change — rather than through a new Checkout.
    const PERIOD_END = 1_800_000_000;
    const item = (id: string, price: string, interval: "month" | "year") => ({
      id,
      current_period_end: PERIOD_END,
      price: { id: price, recurring: { interval } },
    });
    const subscription = (...items: ReturnType<typeof item>[]) => ({
      id: "sub_1",
      status: "active",
      metadata: {},
      currency: "nzd",
      items: { data: items },
    });
    const subscriber = (overrides: Record<string, unknown> = {}) =>
      baseAccount({
        plan: "pro",
        billingInterval: "month",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        upgradeDiscountUsedAt: new Date("2026-01-01"),
        ...overrides,
      });

    beforeEach(() => {
      process.env.STRIPE_PRICE_ID_PRO = "price_pro_month";
      process.env.STRIPE_PRICE_ID_PRO_ANNUAL = "price_pro_year";
      process.env.STRIPE_PRICE_ID_VENUE = "price_venue_month";
      process.env.STRIPE_PRICE_ID_VENUE_ANNUAL = "price_venue_year";
      process.env.STRIPE_PRICE_ID_GRAPHICS = "price_graphics-operator_month";
      process.env.STRIPE_PRICE_ID_GRAPHICS_ANNUAL = "price_graphics-operator_year";
      process.env.STRIPE_PRICE_ID_DATA_FEED = "price_data-feed_month";
      process.env.STRIPE_PRICE_ID_DATA_FEED_ANNUAL = "price_data-feed_year";
      priceIdForPlanMock.mockImplementation((plan: string, interval: string) => `price_${plan}_${interval}`);
      priceIdForAddOnMock.mockImplementation((addOn: string, interval: string) => `price_${addOn}_${interval}`);
      invoicesCreatePreviewMock.mockResolvedValue({
        amount_due: 11800,
        total: 11800,
        total_excluding_tax: 10261,
        currency: "nzd",
        lines: { data: [
          { amount: 1450, parent: { subscription_item_details: { proration: true } } },
          { amount: 8900, parent: { subscription_item_details: { proration: false } } },
        ] },
      });
      subscriptionsUpdateMock.mockImplementation((id: string) => Promise.resolve(subscription(item("si_1", "price_pro_month", "month"))));
      accountUpdateMock.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...subscriber(), ...data }));
    });

    // A proration date from a preview a minute ago
    let RECENT: number;
    beforeEach(() => { RECENT = Math.floor(Date.now() / 1000) - 60; });

    describe("adding an add-on", () => {
      it("previews the cost on the next invoice rather than starting a new Checkout", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ addOn: "graphics-operator" }));
        const body = await res.json();

        expect(checkoutSessionsCreateMock).not.toHaveBeenCalled();
        expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
        expect(invoicesCreatePreviewMock).toHaveBeenCalledWith({
          customer: "cus_1",
          subscription: "sub_1",
          subscription_details: {
            items: [{ price: "price_graphics-operator_month", quantity: 1 }],
            proration_behavior: "create_prorations",
            proration_date: body.preview.prorationDate,
          },
        });
        expect(body.preview).toEqual({
          kind: "update",
          effectiveAt: null,
          chargedNow: false,
          amountDue: 11800,
          tax: 1539,
          prorated: 1450,
          currency: "nzd",
          invoiceDate: PERIOD_END,
          prorationDate: expect.any(Number),
        });
      });

      it("adds the add-on to the plan's subscription once confirmed, at the previewed proration date", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));
        subscriptionsUpdateMock.mockResolvedValue(subscription(
          item("si_1", "price_pro_month", "month"),
          item("si_2", "price_graphics-operator_month", "month"),
        ));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ addOn: "graphics-operator", confirm: true, prorationDate: RECENT }));

        expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", {
          items: [{ price: "price_graphics-operator_month", quantity: 1 }],
          proration_behavior: "create_prorations",
          proration_date: RECENT,
          metadata: { accountId: "acc_1" },
        });
        // Recorded straight away, so the page doesn't wait on the webhook
        expect(accountUpdateMock).toHaveBeenCalledWith({
          where: { id: "acc_1" },
          data: expect.objectContaining({ addOns: ["graphics-operator"], plan: "pro" }),
        });
        expect(await res.json()).toEqual({ updated: true });
      });

      it("ignores a proration date that isn't from a recent preview", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));
        const before = Math.floor(Date.now() / 1000);

        const { POST } = await import("../route");
        // Late in the period: the prorated charge for the rest of it would be next to nothing
        await POST(makeRequest({ addOn: "graphics-operator", confirm: true, prorationDate: PERIOD_END - 60 }));
        await POST(makeRequest({ addOn: "graphics-operator", confirm: true, prorationDate: before - 3600 }));

        for (const [, params] of subscriptionsUpdateMock.mock.calls) {
          expect(params.proration_date).toBeGreaterThanOrEqual(before);
          expect(params.proration_date).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
        }
        expect(subscriptionsUpdateMock).toHaveBeenCalledTimes(2);
      });

      it("bills the add-on at the plan's interval, whatever the request says", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber({ billingInterval: "year" }));
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_year", "year")));

        const { POST } = await import("../route");
        await POST(makeRequest({ addOn: "data-feed", interval: "month" }));

        expect(invoicesCreatePreviewMock).toHaveBeenCalledWith(expect.objectContaining({
          subscription_details: expect.objectContaining({ items: [{ price: "price_data-feed_year", quantity: 1 }] }),
        }));
      });

      it("puts back an add-on that's ending without charging again for the period already paid", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber({
          addOns: ["graphics-operator"],
          addOnsEnding: ["graphics-operator"],
          addOnsEndAt: new Date(PERIOD_END * 1000),
        }));
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));

        const { POST } = await import("../route");
        await POST(makeRequest({ addOn: "graphics-operator", confirm: true, prorationDate: RECENT }));

        expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", {
          items: [{ price: "price_graphics-operator_month", quantity: 1 }],
          proration_behavior: "none",
          metadata: { accountId: "acc_1" },
        });
      });

      it("400s when the add-on is already on the subscription", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber({ addOns: ["graphics-operator"] }));
        subscriptionsRetrieveMock.mockResolvedValue(subscription(
          item("si_1", "price_pro_month", "month"),
          item("si_2", "price_graphics-operator_month", "month"),
        ));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ addOn: "graphics-operator" }));
        expect(res.status).toBe(400);
        expect(invoicesCreatePreviewMock).not.toHaveBeenCalled();
      });

      it("400s when the add-on is still billed on its own pre-migration subscription", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber({ addOns: ["data-feed"], dataFeedSubscriptionId: "sub_datafeed" }));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ addOn: "data-feed" }));
        expect(res.status).toBe(400);
        expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
      });

      it("reports a configured price Stripe doesn't recognise as a config error, not a stale billing record", async () => {
        const Stripe = (await import("stripe")).default;
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));
        invoicesCreatePreviewMock.mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error", code: "resource_missing", param: "subscription_details[items][0][price]",
          message: "No such price: 'price_other_account'",
        }));
        vi.spyOn(console, "error").mockImplementation(() => {});

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ addOn: "data-feed" }));
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe("billing is not configured");
      });
    });

    describe("changing the plan", () => {
      it("previews a same-interval change as part of the next invoice", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(
          item("si_1", "price_pro_month", "month"),
          item("si_2", "price_graphics-operator_month", "month"),
        ));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ plan: "venue", interval: "month" }));
        const body = await res.json();

        // Only the plan item changes; the add-on stays as it is
        expect(invoicesCreatePreviewMock).toHaveBeenCalledWith(expect.objectContaining({
          subscription_details: expect.objectContaining({
            items: [{ id: "si_1", price: "price_venue_month", quantity: 1 }],
            proration_behavior: "create_prorations",
          }),
        }));
        expect(body.preview).toEqual(expect.objectContaining({ chargedNow: false, invoiceDate: PERIOD_END }));
      });

      it("moves the plan and every add-on together on a monthly to annual switch, charged now", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(
          item("si_1", "price_pro_month", "month"),
          item("si_2", "price_graphics-operator_month", "month"),
        ));

        const { POST } = await import("../route");
        await POST(makeRequest({ plan: "pro", interval: "year", confirm: true, prorationDate: RECENT }));

        expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", {
          items: [
            { id: "si_1", price: "price_pro_year", quantity: 1 },
            { id: "si_2", price: "price_graphics-operator_year", quantity: 1 },
          ],
          proration_behavior: "always_invoice",
          proration_date: RECENT,
          payment_behavior: "error_if_incomplete",
          metadata: { accountId: "acc_1" },
        });
      });

      it("claims the upgrade discount and puts it on the plan's item when the account hasn't used it", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber({ upgradeDiscountUsedAt: null }));
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));
        accountUpdateManyMock.mockResolvedValue({ count: 1 });

        const { POST } = await import("../route");
        await POST(makeRequest({ plan: "venue", interval: "month", confirm: true }));

        expect(accountUpdateManyMock).toHaveBeenCalledWith({
          where: { id: "acc_1", upgradeDiscountUsedAt: null },
          data: { upgradeDiscountUsedAt: expect.any(Date) },
        });
        expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", expect.objectContaining({
          items: [{ id: "si_1", price: "price_venue_month", quantity: 1, discounts: [{ coupon: "UPGRADE20" }] }],
        }));
      });

      it("leaves the discount off a second confirm racing the first", async () => {
        // Account row read before the first claim committed still looks eligible
        getAccountForOrgMock.mockResolvedValue(subscriber({ upgradeDiscountUsedAt: null }));
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));
        accountUpdateManyMock.mockResolvedValue({ count: 0 });

        const { POST } = await import("../route");
        await POST(makeRequest({ plan: "venue", interval: "month", confirm: true }));

        expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", expect.objectContaining({
          items: [{ id: "si_1", price: "price_venue_month", quantity: 1 }],
        }));
      });

      it("402s and gives the discount back when the card can't be charged", async () => {
        const Stripe = (await import("stripe")).default;
        getAccountForOrgMock.mockResolvedValue(subscriber({ upgradeDiscountUsedAt: null }));
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));
        accountUpdateManyMock.mockResolvedValue({ count: 1 });
        subscriptionsUpdateMock.mockRejectedValue(new Stripe.errors.StripeCardError({
          type: "card_error", code: "card_declined", message: "Your card was declined.",
        }));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ plan: "venue", interval: "year", confirm: true }));

        expect(res.status).toBe(402);
        expect(accountUpdateMock).toHaveBeenCalledWith({ where: { id: "acc_1" }, data: { upgradeDiscountUsedAt: null } });
      });

      it("400s when the subscription is already on that plan and interval", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_month", "month")));

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ plan: "pro" }));
        expect(res.status).toBe(400);
        expect(invoicesCreatePreviewMock).not.toHaveBeenCalled();
      });

      describe("downgrades, at the end of the period already paid for", () => {
        const PERIOD_START = PERIOD_END - 2_592_000;
        // What from_subscription gives: one phase matching the current period.
        const createdSchedule = (items: { price: string }[]) => ({
          id: "sub_sched_1",
          phases: [{
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: items.map(i => ({ price: i.price, quantity: 1, discounts: [] })),
            discounts: [],
            automatic_tax: { enabled: true },
            collection_method: "charge_automatically",
            default_payment_method: null,
            metadata: { accountId: "acc_1" },
          }],
        });
        const pendingSchedule = (items: string[]) => ({
          phases: [
            { start_date: Math.floor(Date.now() / 1000) - 86_400, items: [{ price: "price_venue_month" }] },
            { start_date: Math.floor(Date.now() / 1000) + 86_400, items: items.map(price => ({ price })) },
          ],
        });

        beforeEach(() => {
          schedulesCreateMock.mockImplementation(() => Promise.resolve(createdSchedule([
            { price: "price_venue_month" }, { price: "price_graphics-operator_month" },
          ])));
          schedulesUpdateMock.mockResolvedValue({});
          schedulesReleaseMock.mockResolvedValue({});
        });

        it("previews Venue -> Pro as switching at the period end, with GST, and nothing to pay now", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ plan: "venue" }));
          subscriptionsRetrieveMock.mockResolvedValue({
            ...subscription(
              item("si_1", "price_venue_month", "month"),
              item("si_2", "price_graphics-operator_month", "month"),
            ),
            automatic_tax: { enabled: true },
          });
          invoicesCreatePreviewMock.mockResolvedValue({ total: 13685, total_excluding_tax: 11800, currency: "nzd", lines: { data: [] } });

          const { POST } = await import("../route");
          const body = await (await POST(makeRequest({ plan: "pro", interval: "month" }))).json();

          // A period of the target items, as a new subscription, so Stripe Tax prices it
          expect(invoicesCreatePreviewMock).toHaveBeenCalledWith({
            customer: "cus_1",
            automatic_tax: { enabled: true },
            subscription_details: {
              items: [
                { price: "price_pro_month", quantity: 1 },
                { price: "price_graphics-operator_month", quantity: 1 },
              ],
            },
          });
          expect(body.preview).toEqual(expect.objectContaining({
            kind: "schedule",
            chargedNow: false,
            prorated: 0,
            amountDue: 13685,
            tax: 1885,
            effectiveAt: PERIOD_END,
            interval: "month",
          }));
        });

        it("schedules Venue -> Pro for the period end without touching the subscription now", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ plan: "venue" }));
          subscriptionsRetrieveMock.mockResolvedValue(subscription(
            item("si_1", "price_venue_month", "month"),
            item("si_2", "price_graphics-operator_month", "month"),
          ));

          const { POST } = await import("../route");
          const res = await POST(makeRequest({ plan: "pro", interval: "month", confirm: true }));

          expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
          expect(accountUpdateMock).not.toHaveBeenCalled();
          expect(schedulesCreateMock).toHaveBeenCalledWith({ from_subscription: "sub_1" });
          expect(schedulesUpdateMock).toHaveBeenCalledWith("sub_sched_1", {
            end_behavior: "release",
            phases: [
              {
                start_date: PERIOD_START,
                end_date: PERIOD_END,
                items: [
                  { price: "price_venue_month", quantity: 1 },
                  { price: "price_graphics-operator_month", quantity: 1 },
                ],
                proration_behavior: "none",
                automatic_tax: { enabled: true },
                collection_method: "charge_automatically",
                metadata: { accountId: "acc_1" },
              },
              {
                items: [
                  { price: "price_pro_month", quantity: 1 },
                  { price: "price_graphics-operator_month", quantity: 1 },
                ],
                duration: { interval: "month", interval_count: 1 },
                proration_behavior: "none",
                automatic_tax: { enabled: true },
                collection_method: "charge_automatically",
                metadata: { accountId: "acc_1" },
              },
            ],
          });
          expect(await res.json()).toEqual({ updated: true });
        });

        it("schedules annual -> monthly for the period end too, moving add-ons with it", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ billingInterval: "year" }));
          subscriptionsRetrieveMock.mockResolvedValue(subscription(
            item("si_1", "price_pro_year", "year"),
            item("si_2", "price_graphics-operator_year", "year"),
          ));

          const { POST } = await import("../route");
          await POST(makeRequest({ plan: "pro", interval: "month", confirm: true }));

          expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
          const [, params] = schedulesUpdateMock.mock.calls[0];
          expect(params.phases[1]).toEqual(expect.objectContaining({
            items: [
              { price: "price_pro_month", quantity: 1 },
              { price: "price_graphics-operator_month", quantity: 1 },
            ],
            duration: { interval: "month", interval_count: 1 },
          }));
        });

        it("400s an upgrade that also moves annual billing to monthly", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ billingInterval: "year" }));
          subscriptionsRetrieveMock.mockResolvedValue(subscription(item("si_1", "price_pro_year", "year")));

          const { POST } = await import("../route");
          const res = await POST(makeRequest({ plan: "venue", interval: "month" }));
          expect(res.status).toBe(400);
          expect((await res.json()).error).toMatch(/annual/);
        });

        it("drops a scheduled downgrade when the admin chooses to keep their current plan", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ plan: "venue" }));
          subscriptionsRetrieveMock.mockResolvedValue({ ...subscription(item("si_1", "price_venue_month", "month")), schedule: "sub_sched_1" });
          schedulesRetrieveMock.mockResolvedValue(pendingSchedule(["price_pro_month"]));

          const { POST } = await import("../route");
          const preview = await (await POST(makeRequest({ plan: "venue", interval: "month" }))).json();
          expect(preview.preview).toEqual(expect.objectContaining({ kind: "keep", amountDue: 0 }));

          await POST(makeRequest({ plan: "venue", interval: "month", confirm: true }));
          expect(schedulesReleaseMock).toHaveBeenCalledWith("sub_sched_1");
          expect(subscriptionsUpdateMock).not.toHaveBeenCalled();
        });

        it("400s scheduling the same downgrade twice", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ plan: "venue" }));
          subscriptionsRetrieveMock.mockResolvedValue({ ...subscription(item("si_1", "price_venue_month", "month")), schedule: "sub_sched_1" });
          schedulesRetrieveMock.mockResolvedValue(pendingSchedule(["price_pro_month"]));

          const { POST } = await import("../route");
          const res = await POST(makeRequest({ plan: "pro", interval: "month" }));
          expect(res.status).toBe(400);
        });

        it("replaces a scheduled downgrade when the admin upgrades instead", async () => {
          // Venue monthly, due to move to Pro; switches Venue to annual instead
          getAccountForOrgMock.mockResolvedValue(subscriber({ plan: "venue" }));
          subscriptionsRetrieveMock.mockResolvedValue({ ...subscription(item("si_1", "price_venue_month", "month")), schedule: "sub_sched_1" });
          schedulesRetrieveMock.mockResolvedValue(pendingSchedule(["price_pro_month"]));

          const { POST } = await import("../route");
          await POST(makeRequest({ plan: "venue", interval: "year", confirm: true }));

          expect(schedulesReleaseMock).toHaveBeenCalledWith("sub_sched_1");
          expect(schedulesReleaseMock.mock.invocationCallOrder[0]).toBeLessThan(subscriptionsUpdateMock.mock.invocationCallOrder[0]);
          expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", expect.objectContaining({
            items: [{ id: "si_1", price: "price_venue_year", quantity: 1 }],
            proration_behavior: "always_invoice",
          }));
          expect(schedulesCreateMock).not.toHaveBeenCalled();
        });

        it("keeps a scheduled downgrade, now including the add-on, when one is added meanwhile", async () => {
          getAccountForOrgMock.mockResolvedValue(subscriber({ plan: "venue" }));
          subscriptionsRetrieveMock.mockResolvedValue({ ...subscription(item("si_1", "price_venue_month", "month")), schedule: "sub_sched_1" });
          schedulesRetrieveMock.mockResolvedValue(pendingSchedule(["price_pro_month"]));
          subscriptionsUpdateMock.mockResolvedValue(subscription(
            item("si_1", "price_venue_month", "month"),
            item("si_2", "price_graphics-operator_month", "month"),
          ));

          const { POST } = await import("../route");
          await POST(makeRequest({ addOn: "graphics-operator", confirm: true }));

          expect(schedulesReleaseMock.mock.invocationCallOrder[0]).toBeLessThan(subscriptionsUpdateMock.mock.invocationCallOrder[0]);
          expect(schedulesCreateMock.mock.invocationCallOrder[0]).toBeGreaterThan(subscriptionsUpdateMock.mock.invocationCallOrder[0]);
          const [, params] = schedulesUpdateMock.mock.calls[0];
          expect(params.phases[1].items).toEqual([
            { price: "price_pro_month", quantity: 1 },
            { price: "price_graphics-operator_month", quantity: 1 },
          ]);
        });
      });

      it("400s when the subscription has no plan item to change", async () => {
        getAccountForOrgMock.mockResolvedValue(subscriber());
        subscriptionsRetrieveMock.mockResolvedValue(subscription());

        const { POST } = await import("../route");
        const res = await POST(makeRequest({ plan: "venue" }));
        expect(res.status).toBe(400);
      });
    });

    it("says the billing record doesn't match Stripe when its saved subscription isn't found", async () => {
      const Stripe = (await import("stripe")).default;
      getAccountForOrgMock.mockResolvedValue(baseAccount({ plan: "pro", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_live_id" }));
      subscriptionsRetrieveMock.mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error", code: "resource_missing", message: "No such subscription: 'sub_live_id'",
      }));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("../route");
      const res = await POST(makeRequest({ plan: "venue" }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/billing record doesn't match/);
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
