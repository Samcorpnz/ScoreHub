// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const constructEventMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn();
const subscriptionsCancelMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => constructEventMock(...a) },
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieveMock(...a),
      cancel: (...a: unknown[]) => subscriptionsCancelMock(...a),
    },
  }),
}));

const stripeEventCreateMock = vi.fn();
const stripeEventDeleteMock = vi.fn();
const accountUpdateMock = vi.fn();
const accountUpdateManyMock = vi.fn();
const accountFindUniqueMock = vi.fn();
const accountFindFirstMock = vi.fn();
const membershipFindManyMock = vi.fn();
vi.mock("@scorehub/db", () => ({
  prisma: {
    stripeEvent: {
      create: (...a: unknown[]) => stripeEventCreateMock(...a),
      delete: (...a: unknown[]) => stripeEventDeleteMock(...a),
    },
    account: {
      update: (...a: unknown[]) => accountUpdateMock(...a),
      updateMany: (...a: unknown[]) => accountUpdateManyMock(...a),
      findUnique: (...a: unknown[]) => accountFindUniqueMock(...a),
      findFirst: (...a: unknown[]) => accountFindFirstMock(...a),
    },
    membership: {
      findMany: (...a: unknown[]) => membershipFindManyMock(...a),
    },
  },
}));

const planForPriceIdMock = vi.fn();
const addOnForPriceIdMock = vi.fn();
vi.mock("@/lib/plans", () => ({
  planForPriceId: (...a: unknown[]) => planForPriceIdMock(...a),
  addOnForPriceId: (...a: unknown[]) => addOnForPriceIdMock(...a),
  ADDON_SUBSCRIPTION_FIELD: {
    "graphics-operator": "graphicsSubscriptionId",
    "data-feed": "dataFeedSubscriptionId",
  },
}));

const sendPaymentFailedEmailMock = vi.fn();
const sendPaymentActionRequiredEmailMock = vi.fn();
const sendPaymentRecoveredEmailMock = vi.fn();
const sendSubscriptionEndedEmailMock = vi.fn();
vi.mock("@/lib/email", () => ({
  sendPaymentFailedEmail: (...a: unknown[]) => sendPaymentFailedEmailMock(...a),
  sendPaymentActionRequiredEmail: (...a: unknown[]) => sendPaymentActionRequiredEmailMock(...a),
  sendPaymentRecoveredEmail: (...a: unknown[]) => sendPaymentRecoveredEmailMock(...a),
  sendSubscriptionEndedEmail: (...a: unknown[]) => sendSubscriptionEndedEmailMock(...a),
}));

function makeRequest(body = "{}", signature: string | null = "sig_test") {
  const headers: Record<string, string> = {};
  if (signature !== null) headers["stripe-signature"] = signature;
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function stripeEvent(type: string, object: Record<string, unknown>, id = "evt_1") {
  return { id, type, data: { object } };
}

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const m of [
      constructEventMock,
      subscriptionsRetrieveMock,
      subscriptionsCancelMock,
      stripeEventCreateMock,
      stripeEventDeleteMock,
      accountUpdateMock,
      accountUpdateManyMock,
      accountFindUniqueMock,
      accountFindFirstMock,
      membershipFindManyMock,
      planForPriceIdMock,
      addOnForPriceIdMock,
      sendPaymentFailedEmailMock,
      sendPaymentActionRequiredEmailMock,
      sendPaymentRecoveredEmailMock,
      sendSubscriptionEndedEmailMock,
    ]) {
      m.mockReset();
    }
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeEventCreateMock.mockResolvedValue({ id: "evt_1" });
    subscriptionsCancelMock.mockResolvedValue({});
    planForPriceIdMock.mockReturnValue(null);
    addOnForPriceIdMock.mockReturnValue(null);
    membershipFindManyMock.mockResolvedValue([]);
  });

  it("returns 500 when the stripe-signature header is missing", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}", null));
    expect(res.status).toBe(500);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it("returns 400 when signature verification fails", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(stripeEventCreateMock).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate event without reprocessing it", async () => {
    constructEventMock.mockReturnValue(stripeEvent("invoice.payment_failed", {}));
    stripeEventCreateMock.mockRejectedValue(new Error("unique constraint"));
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true, duplicate: true });
    expect(accountFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 500 and deletes the event row when processing throws", async () => {
    constructEventMock.mockReturnValue(
      stripeEvent("invoice.payment_failed", { customer: "cus_1" }),
    );
    accountFindFirstMock.mockRejectedValue(new Error("db down"));
    stripeEventDeleteMock.mockResolvedValue({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(stripeEventDeleteMock).toHaveBeenCalledWith({ where: { id: "evt_1" } });
    errSpy.mockRestore();
  });

  it("returns 200 with received:true for an unhandled event type", async () => {
    constructEventMock.mockReturnValue(stripeEvent("payment_intent.created", {}));
    const { POST } = await import("../route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  describe("checkout.session.completed", () => {
    it("no-ops when accountId/customer/subscription are missing or malformed", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("checkout.session.completed", { customer: "cus_1", subscription: "sub_1" }),
      );
      const { POST } = await import("../route");
      await POST(makeRequest());
      expect(accountUpdateMock).not.toHaveBeenCalled();
      expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
    });

    it("adds an add-on subscription when metadata.addOn is set", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("checkout.session.completed", {
          client_reference_id: "acc_1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { addOn: "graphics-operator" },
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({
        id: "sub_1",
        items: { data: [{ price: { id: "price_graphics" } }] },
      });
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: [] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { graphicsSubscriptionId: "sub_1", addOns: ["graphics-operator"] },
      });
    });

    it("adds a data-feed add-on subscription onto its own dedicated field", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("checkout.session.completed", {
          client_reference_id: "acc_1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { addOn: "data-feed" },
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({
        id: "sub_1",
        items: { data: [{ price: { id: "price_data_feed" } }] },
      });
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: [] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { dataFeedSubscriptionId: "sub_1", addOns: ["data-feed"] },
      });
    });

    it("maps the price id to a plan and records it on the account", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("checkout.session.completed", {
          client_reference_id: "acc_1",
          customer: "cus_1",
          subscription: "sub_1",
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({
        id: "sub_1",
        items: { data: [{ price: { id: "price_pro", recurring: { interval: "month" } } }] },
      });
      planForPriceIdMock.mockReturnValue("pro");

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: {
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
          plan: "pro",
          billingInterval: "month",
        },
      });
    });

    it("logs an error and leaves plan unset for an unmapped price id", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("checkout.session.completed", {
          client_reference_id: "acc_1",
          customer: "cus_1",
          subscription: "sub_1",
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({
        id: "sub_1",
        items: { data: [{ price: { id: "price_unknown" } }] },
      });
      planForPriceIdMock.mockReturnValue(null);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("unmapped priceId"));
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", billingInterval: null },
      });
      errSpy.mockRestore();
    });

    it("falls back to metadata.accountId when client_reference_id is absent", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("checkout.session.completed", {
          metadata: { accountId: "acc_2" },
          customer: "cus_1",
          subscription: "sub_1",
        }),
      );
      subscriptionsRetrieveMock.mockResolvedValue({ id: "sub_1", items: { data: [] } });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "acc_2" } }));
    });
  });

  describe("customer.subscription.updated", () => {
    it("activates the add-on via metadata.addOn when the subscription is active", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "active",
          metadata: { accountId: "acc_1", addOn: "graphics-operator" },
          items: { data: [] },
        }),
      );
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: [] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { graphicsSubscriptionId: "sub_1", addOns: ["graphics-operator"] },
      });
    });

    it("removes the add-on when the add-on subscription is no longer active", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "canceled",
          metadata: { accountId: "acc_1", addOn: "graphics-operator" },
          items: { data: [] },
        }),
      );
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: ["graphics-operator"] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { graphicsSubscriptionId: null, addOns: [] },
      });
    });

    it("detects an add-on subscription via priceId when metadata.addOn is absent", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "active",
          metadata: {},
          items: { data: [{ price: { id: "price_graphics" } }] },
        }),
      );
      addOnForPriceIdMock.mockReturnValue("graphics-operator");
      accountFindFirstMock.mockResolvedValue({ id: "acc_1", addOns: [] });
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: [] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountFindFirstMock).toHaveBeenCalledWith({
        where: { OR: [{ graphicsSubscriptionId: "sub_1" }, { dataFeedSubscriptionId: "sub_1" }] },
      });
      expect(accountUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "acc_1" } }),
      );
    });

    it("no-ops the add-on branch when the account can't be found", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "active",
          metadata: { addOn: "graphics-operator" },
          items: { data: [] },
        }),
      );
      accountFindFirstMock.mockResolvedValue(null);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).not.toHaveBeenCalled();
    });

    it("updates the base plan when the subscription is active", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "active",
          metadata: {},
          items: { data: [{ price: { id: "price_venue", recurring: { interval: "year" } } }] },
        }),
      );
      planForPriceIdMock.mockReturnValue("venue");
      accountFindFirstMock.mockResolvedValue({ id: "acc_1", plan: "free", graphicsSubscriptionId: null });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { stripeSubscriptionId: "sub_1", plan: "venue", billingInterval: "year" },
      });
    });

    it("downgrades to free and cancels the graphics add-on when the base plan lapses", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "unpaid",
          metadata: {},
          items: { data: [{ price: { id: "price_venue" } }] },
        }),
      );
      accountFindFirstMock.mockResolvedValue({
        id: "acc_1",
        plan: "venue",
        graphicsSubscriptionId: "sub_graphics",
      });
      membershipFindManyMock.mockResolvedValue([{ user: { email: "admin@example.com" } }]);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { stripeSubscriptionId: "sub_1", plan: "free", billingInterval: null },
      });
      expect(subscriptionsCancelMock).toHaveBeenCalledWith("sub_graphics");
      // removeAddOn's own findUnique/update — the account was already fetched above
      expect(accountFindUniqueMock).toHaveBeenCalledWith({ where: { id: "acc_1" } });
      expect(sendSubscriptionEndedEmailMock).toHaveBeenCalledWith({
        to: ["admin@example.com"],
        plan: "venue",
      });
    });

    it("keeps the plan and add-ons while a failed payment is being retried (past_due)", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "past_due",
          metadata: {},
          items: { data: [{ price: { id: "price_venue", recurring: { interval: "month" } } }] },
        }),
      );
      planForPriceIdMock.mockReturnValue("venue");
      accountFindFirstMock.mockResolvedValue({
        id: "acc_1",
        plan: "venue",
        graphicsSubscriptionId: "sub_graphics",
      });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { stripeSubscriptionId: "sub_1", plan: "venue", billingInterval: "month" },
      });
      expect(subscriptionsCancelMock).not.toHaveBeenCalled();
      expect(sendSubscriptionEndedEmailMock).not.toHaveBeenCalled();
    });

    it("keeps an add-on while its own failed payment is being retried (past_due)", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "past_due",
          metadata: { accountId: "acc_1", addOn: "graphics-operator" },
          items: { data: [] },
        }),
      );
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: ["graphics-operator"] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { graphicsSubscriptionId: "sub_1", addOns: ["graphics-operator"] },
      });
    });

    it("does not send a subscription-ended email when the account was already on the free plan", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "canceled",
          metadata: {},
          items: { data: [] },
        }),
      );
      accountFindFirstMock.mockResolvedValue({ id: "acc_1", plan: "free" });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(sendSubscriptionEndedEmailMock).not.toHaveBeenCalled();
    });

    it("no-ops the base-plan branch when the account can't be found", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.updated", {
          id: "sub_1",
          status: "active",
          metadata: {},
          items: { data: [] },
        }),
      );
      accountFindFirstMock.mockResolvedValue(null);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.deleted", () => {
    it("removes the add-on via metadata.addOn when the account is found", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.deleted", {
          id: "sub_1",
          metadata: { accountId: "acc_1", addOn: "graphics-operator" },
        }),
      );
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: ["graphics-operator"] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: "acc_1" },
        data: { graphicsSubscriptionId: null, addOns: [] },
      });
      expect(accountUpdateManyMock).not.toHaveBeenCalled();
    });

    it("no-ops the add-on branch when the account isn't found", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.deleted", {
          id: "sub_1",
          metadata: { addOn: "graphics-operator" },
        }),
      );
      accountFindFirstMock.mockResolvedValue(null);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateMock).not.toHaveBeenCalled();
    });

    it("downgrades the account to free via updateMany for a base-plan cancellation", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.deleted", { id: "sub_1", metadata: {} }),
      );
      accountFindFirstMock.mockResolvedValue({ id: "acc_1", plan: "pro", graphicsSubscriptionId: null });
      membershipFindManyMock.mockResolvedValue([{ user: { email: "admin@example.com" } }]);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(accountUpdateManyMock).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: "sub_1" },
        data: { plan: "free", stripeSubscriptionId: null, billingInterval: null },
      });
      expect(sendSubscriptionEndedEmailMock).toHaveBeenCalledWith({
        to: ["admin@example.com"],
        plan: "pro",
      });
    });

    it("cascades to cancel a running graphics add-on on base-plan cancellation", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("customer.subscription.deleted", { id: "sub_1", metadata: {} }),
      );
      accountFindFirstMock.mockResolvedValue({ id: "acc_1", graphicsSubscriptionId: "sub_graphics" });
      accountFindUniqueMock.mockResolvedValue({ id: "acc_1", addOns: ["graphics-operator"] });

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(subscriptionsCancelMock).toHaveBeenCalledWith("sub_graphics");
    });
  });

  describe("invoice.payment_failed", () => {
    it("no-ops when the invoice customer isn't a string", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_failed", { customer: { id: "cus_1" } }),
      );
      const { POST } = await import("../route");
      await POST(makeRequest());
      expect(sendPaymentFailedEmailMock).not.toHaveBeenCalled();
    });

    it("no-ops when no account matches the Stripe customer id", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_failed", { customer: "cus_1" }),
      );
      accountFindFirstMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      await POST(makeRequest());
      expect(sendPaymentFailedEmailMock).not.toHaveBeenCalled();
    });

    it("emails the distinct set of admin addresses for the account", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_failed", { customer: "cus_1" }),
      );
      accountFindFirstMock.mockResolvedValue({ id: "acc_1" });
      membershipFindManyMock.mockResolvedValue([
        { user: { email: "admin@example.com" } },
        { user: { email: "admin@example.com" } },
        { user: { email: "second-admin@example.com" } },
      ]);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(sendPaymentFailedEmailMock).toHaveBeenCalledWith({
        to: ["admin@example.com", "second-admin@example.com"],
      });
    });
  });

  describe("invoice.payment_action_required / invoice.payment_attempt_required", () => {
    it.each(["invoice.payment_action_required", "invoice.payment_attempt_required"])(
      "emails admins with the hosted invoice link for %s",
      async type => {
        constructEventMock.mockReturnValue(
          stripeEvent(type, { customer: "cus_1", hosted_invoice_url: "https://stripe.example/invoice" }),
        );
        accountFindFirstMock.mockResolvedValue({ id: "acc_1" });
        membershipFindManyMock.mockResolvedValue([{ user: { email: "admin@example.com" } }]);

        const { POST } = await import("../route");
        await POST(makeRequest());

        expect(sendPaymentActionRequiredEmailMock).toHaveBeenCalledWith({
          to: ["admin@example.com"],
          hostedInvoiceUrl: "https://stripe.example/invoice",
        });
      },
    );

    it("no-ops when no account matches the Stripe customer id", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_action_required", { customer: "cus_1" }),
      );
      accountFindFirstMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      await POST(makeRequest());
      expect(sendPaymentActionRequiredEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_succeeded", () => {
    it("no-ops on a routine renewal (attempt_count 1)", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_succeeded", { customer: "cus_1", attempt_count: 1 }),
      );
      const { POST } = await import("../route");
      await POST(makeRequest());
      expect(accountFindFirstMock).not.toHaveBeenCalled();
      expect(sendPaymentRecoveredEmailMock).not.toHaveBeenCalled();
    });

    it("emails admins when the payment succeeded after a prior failed attempt", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_succeeded", { customer: "cus_1", attempt_count: 2 }),
      );
      accountFindFirstMock.mockResolvedValue({ id: "acc_1" });
      membershipFindManyMock.mockResolvedValue([{ user: { email: "admin@example.com" } }]);

      const { POST } = await import("../route");
      await POST(makeRequest());

      expect(sendPaymentRecoveredEmailMock).toHaveBeenCalledWith({ to: ["admin@example.com"] });
    });

    it("no-ops when no account matches the Stripe customer id", async () => {
      constructEventMock.mockReturnValue(
        stripeEvent("invoice.payment_succeeded", { customer: "cus_1", attempt_count: 2 }),
      );
      accountFindFirstMock.mockResolvedValue(null);
      const { POST } = await import("../route");
      await POST(makeRequest());
      expect(sendPaymentRecoveredEmailMock).not.toHaveBeenCalled();
    });
  });
});
