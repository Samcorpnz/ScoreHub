"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import * as Sentry from "@sentry/nextjs";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/stripe-client";
import { Card, SmallBtn } from "../components/primitives";
import { BridgeTokensCard, DataFeedTokensCard, StreamDeckTokensCard } from "../components/TokenCards";

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    monthlyPrice: "$0",
    annualPrice: "$0",
    tagline: "Get started with one live match",
    features: ["1 live match at a time", "No custom branding", "“Powered by ScoreHub” mark on displays"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    monthlyPrice: "$89",
    annualPrice: "$890",
    tagline: "For regular events and clubs",
    features: [
      "Concurrent live matches across your account",
      "Custom team logos",
      "Custom competition logo",
      "Custom display theme, no ScoreHub mark",
      "Custom sounds",
    ],
  },
  {
    id: "venue" as const,
    name: "Venue",
    monthlyPrice: "$349",
    annualPrice: "$3,490",
    tagline: "For venues running multiple courts at once",
    features: ["Everything in Pro", "Sized for high-volume, multi-court venues"],
  },
];

type AddOnId = "graphics-operator" | "data-feed";
type BillingInterval = "month" | "year";

type AddOnConfig = {
  id: AddOnId;
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  tagline: string;
  valueProps: string[];
  subscriptionKey: "graphicsSubscription" | "dataFeedSubscription";
};

const ADD_ONS: AddOnConfig[] = [
  {
    id: "graphics-operator",
    name: "Graphics Operator",
    monthlyPrice: "$29",
    annualPrice: "$290",
    tagline: "Broadcast-style scene graphics for /display, driven from the control panel",
    valueProps: [
      "Lower thirds, player stat cards, and headshot bios without extra hardware",
      "Switch scenes live from the same control panel your operator already uses",
    ],
    subscriptionKey: "graphicsSubscription",
  },
  {
    id: "data-feed",
    name: "Data Feed",
    monthlyPrice: "$39",
    annualPrice: "$390",
    tagline: "Bridge a physical scoreboard console, or pipe live match state into a third-party graphics engine",
    valueProps: [
      "Connect a physical Saturn/Vega console to score from at the venue",
      "Authenticated REST/WebSocket feed for Singular.live, Chyron, VIZRT, and similar",
    ],
    subscriptionKey: "dataFeedSubscription",
  },
];

// What a change to an existing subscription will cost, from the checkout
// route's preview, for the admin to confirm before it's made.
type ChangePreview = {
  // "schedule": a downgrade, taking effect at effectiveAt with no refund.
  // "keep": drops a scheduled downgrade.
  kind: "update" | "schedule" | "keep";
  effectiveAt: number | null;
  interval?: BillingInterval;
  chargedNow: boolean;
  // Totals include GST worked out by Stripe Tax; tax is the GST part.
  amountDue: number;
  tax: number;
  prorated: number;
  currency: string;
  invoiceDate: number | null;
  prorationDate: number;
};

type PendingChange = {
  target: "plan" | AddOnId;
  description: string;
  request: Record<string, unknown>;
  preview: ChangePreview;
};

type ScheduledChange = { plan: "pro" | "venue"; interval: BillingInterval; at: number };

type SubscriptionInfo = {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  amount: number | null;
  currency: string | null;
  interval: BillingInterval | null;
};

export default function AccountPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.activeRole === "ADMIN";
  const [billingStatus, setBillingStatus] = useState<{
    plan: string;
    billingInterval: BillingInterval | null;
    hasStripeCustomer: boolean;
    subscription: SubscriptionInfo | null;
    scheduledChange?: ScheduledChange | null;
    addOns: string[];
    graphicsSubscription: SubscriptionInfo | null;
    dataFeedSubscription: SubscriptionInfo | null;
    invoiceEmail: string | null;
    paymentMethod: { brand: string; last4: string } | null;
    upgradeDiscountAvailable: boolean;
    stripeUnavailable?: boolean;
  } | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [finishingUp, setFinishingUp] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [addOnBusy, setAddOnBusy] = useState<Record<AddOnId, boolean>>({
    "graphics-operator": false,
    "data-feed": false,
  });
  // Shown under the add-on's own row — the page-level switchNotice sits up by
  // the plans, out of sight of an add-on button at the bottom of the page.
  const [addOnNotice, setAddOnNotice] = useState<Partial<Record<AddOnId, { message: string; isError: boolean }>>>({});

  const fetchBillingStatus = useCallback(() =>
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(data => {
        setBillingStatus(data);
        if (data.billingInterval) setBillingInterval(data.billingInterval);
        return data;
      })
      .catch(() => null), []);

  // The webhook that actually updates Account.plan lands asynchronously after
  // Stripe's onComplete fires, so a single fetch right after checkout usually
  // still reads the pre-upgrade plan. Poll briefly until it changes.
  async function waitForPlanChange(previousPlan: string | undefined) {
    setFinishingUp(true);
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(r => setTimeout(r, 1500));
        const data = await fetchBillingStatus();
        if (data && data.plan !== previousPlan) return;
      }
    } finally {
      setFinishingUp(false);
    }
  }

  useEffect(() => {
    void fetchBillingStatus();
  }, [fetchBillingStatus]);

  async function upgrade(plan: "pro" | "venue", interval: BillingInterval = billingInterval) {
    setBillingBusy(true);
    setSwitchNotice(null);
    setPendingChange(null);
    const request = { plan, interval };
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => null);
      if (data?.clientSecret) {
        setCheckoutSecret(data.clientSecret);
      } else if (data?.preview) {
        // Already subscribed: the change goes on the same subscription, paid
        // with the card on file, once the admin confirms what it costs.
        const name = PLANS.find(p => p.id === plan)?.name ?? plan;
        const preview: ChangePreview = data.preview;
        setPendingChange({
          target: "plan",
          description: `${preview.kind === "keep" ? "Stay on" : "Switch to"} ${name}, billed ${cadenceLabel(interval)}`,
          request,
          preview: data.preview,
        });
      } else {
        setSwitchNotice(data?.error ?? "couldn't start checkout");
      }
    } finally {
      setBillingBusy(false);
    }
  }

  async function purchaseAddOn(addOnId: AddOnId) {
    setAddOnBusy(prev => ({ ...prev, [addOnId]: true }));
    setAddOnNotice(prev => ({ ...prev, [addOnId]: undefined }));
    setPendingChange(null);
    const notify = (message: string, isError: boolean) => setAddOnNotice(prev => ({ ...prev, [addOnId]: { message, isError } }));
    const request = { addOn: addOnId };
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => null);
      if (data?.preview) {
        const name = ADD_ONS.find(a => a.id === addOnId)?.name ?? addOnId;
        setPendingChange({ target: addOnId, description: `Add ${name} to your plan`, request, preview: data.preview });
      } else {
        notify(data?.error ?? "Couldn't start checkout — please try again.", true);
      }
    } catch {
      notify("Couldn't reach the server — please try again.", true);
    } finally {
      setAddOnBusy(prev => ({ ...prev, [addOnId]: false }));
    }
  }

  async function confirmChange() {
    if (!pendingChange) return;
    const { target, request, preview } = pendingChange;
    const notify = (message: string, isError = false) => {
      if (target === "plan") setSwitchNotice(message);
      else setAddOnNotice(prev => ({ ...prev, [target]: { message, isError } }));
    };
    setConfirmBusy(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, confirm: true, prorationDate: preview.prorationDate }),
      });
      const data = await res.json().catch(() => null);
      setPendingChange(null);
      if (data?.updated) {
        await fetchBillingStatus();
        notify(confirmedNotice(pendingChange));
      } else {
        notify(data?.error ?? "Couldn't make that change — please try again.", true);
      }
    } catch {
      notify("Couldn't reach the server — please try again.", true);
    } finally {
      setConfirmBusy(false);
    }
  }

  const confirmPanel = (target: "plan" | AddOnId) =>
    pendingChange?.target === target ? (
      <ConfirmChange
        change={pendingChange}
        busy={confirmBusy}
        onConfirm={confirmChange}
        onCancel={() => setPendingChange(null)}
      />
    ) : null;

  async function setAddOnCancelAtPeriodEnd(addOnId: AddOnId, resume: boolean) {
    setAddOnBusy(prev => ({ ...prev, [addOnId]: true }));
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, addOn: addOnId }),
      });
      if (res.ok) await fetchBillingStatus();
    } finally {
      setAddOnBusy(prev => ({ ...prev, [addOnId]: false }));
    }
  }

  async function manageBilling() {
    setBillingBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) globalThis.location.href = data.url;
    } finally {
      setBillingBusy(false);
    }
  }

  async function setCancelAtPeriodEnd(resume: boolean) {
    setCancelBusy(true);
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      if (res.ok) await fetchBillingStatus();
    } finally {
      setCancelBusy(false);
    }
  }

  // Checkout takes over the whole page rather than sitting in a card in the
  // narrow account column: Stripe only switches to its two-column layout
  // (order summary beside the payment form) when it has the width.
  if (checkoutSecret) {
    return (
      <div className="p-6 w-full">
        <button
          className="text-xs font-bold mb-4"
          style={{ color: "var(--text-secondary)" }}
          onClick={() => setCheckoutSecret(null)}
        >
          ← Back
        </button>
        <div className="rounded-xl overflow-hidden" data-testid="checkout-panel">
          <EmbeddedCheckoutProvider
            stripe={getStripeClient()}
            options={{
              clientSecret: checkoutSecret,
              onComplete: () => {
                const previousPlan = billingStatus?.plan;
                setCheckoutSecret(null);
                void waitForPlanChange(previousPlan);
              },
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    );
  }

  const dataFeedEntitled = billingStatus ? billingStatus.addOns.includes("data-feed") : null;

  return (
    <div className="p-6 w-full max-w-5xl mx-auto space-y-6">
      <Card title="Organization">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {session?.user?.name ?? "—"}
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
          Role: {session?.user?.activeRole ?? "—"}
        </p>
      </Card>

      <DisplayNameCard initialName={session?.user?.name ?? ""} />
      <PasswordCard />
      <EmailCard currentEmail={session?.user?.email ?? ""} />
      <PasskeysCard />

      {session?.user?.activeOrgId &&
        (session.user.activeRole === "ADMIN" || session.user.activeRole === "MANAGER") && (
          <>
            <TeamCard orgId={session.user.activeOrgId} actorRole={session.user.activeRole} actorUserId={session.user.id} />
            <BridgeTokensCard orgId={session.user.activeOrgId} dataFeedEntitled={dataFeedEntitled} />
            <StreamDeckTokensCard orgId={session.user.activeOrgId} />
            <DataFeedTokensCard orgId={session.user.activeOrgId} dataFeedEntitled={dataFeedEntitled} />
          </>
        )}

      <Card title="Plan & Billing">
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          Free allows one live match at a time and no custom branding. Pro and Venue unlock custom logos/theme and
          concurrent matches across your account.
        </p>
        {!isAdmin && (
          <p className="text-xs mb-4" style={{ color: "var(--text-dim)" }}>
            Only an account ADMIN can change billing.
          </p>
        )}
        {finishingUp && <StatusText message="Finishing up your upgrade…" />}
        {switchNotice && <StatusText message={switchNotice} />}
        {confirmPanel("plan")}
        {billingStatus?.stripeUnavailable && (
          <div data-testid="billing-stripe-unavailable">
            <StatusText isError message="Some billing details couldn't be loaded from our payment provider, so they're missing below. If this keeps happening, please contact support." />
          </div>
        )}

        {billingStatus && billingStatus.plan !== "free" ? (
          <SubscriptionPanel
            billingStatus={billingStatus}
            billingInterval={billingInterval}
            setBillingInterval={setBillingInterval}
            isAdmin={isAdmin}
            billingBusy={billingBusy}
            cancelBusy={cancelBusy}
            onUpgrade={upgrade}
            onCancel={() => setCancelAtPeriodEnd(false)}
            onResume={() => setCancelAtPeriodEnd(true)}
          />
        ) : (
          <>
            {billingStatus?.upgradeDiscountAvailable && (
              <DiscountBanner className="mb-4" />
            )}
            <div className="flex items-center gap-2 mb-4">
              <SmallBtn label="Monthly" onClick={() => setBillingInterval("month")} active={billingInterval === "month"} />
              <SmallBtn label="Annual (2 months free)" onClick={() => setBillingInterval("year")} active={billingInterval === "year"} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {PLANS.map(plan => {
                const isCurrentPlan = billingStatus?.plan === plan.id;
                const isCurrent = isCurrentPlan && (plan.id === "free" || billingStatus?.billingInterval === billingInterval);
                let priceSuffix: string;
                if (plan.id === "free") {
                  priceSuffix = "";
                } else if (billingInterval === "month") {
                  priceSuffix = "/mo";
                } else {
                  priceSuffix = "/yr";
                }
                let planAction: React.ReactNode;
                if (isCurrent) {
                  planAction = <SmallBtn label="Current plan" onClick={() => {}} active />;
                } else if (plan.id !== "free" && isAdmin) {
                  planAction = (
                    <SmallBtn
                      label={billingBusy ? "Loading…" : `Upgrade to ${plan.name}`}
                      onClick={() => upgrade(plan.id)}
                      primary
                    />
                  );
                } else {
                  planAction = null;
                }
                return (
                  <div
                    key={plan.id}
                    className="rounded-xl p-4 flex flex-col"
                    style={{
                      background: "var(--bg-elevated)",
                      border: `1px solid ${isCurrent ? "var(--border-accent)" : "var(--border)"}`,
                    }}
                  >
                    <p className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
                      {plan.name}
                    </p>
                    <p className="mt-2">
                      <span className="text-2xl font-black" style={{ color: "var(--accent)" }}>
                        {billingInterval === "month" ? plan.monthlyPrice : plan.annualPrice}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                        {priceSuffix}
                      </span>
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{plan.tagline}</p>
                    <ul className="text-xs mt-3 space-y-1 flex-1" style={{ color: "var(--text-secondary)" }}>
                      {plan.features.map(f => (
                        <li key={f}>• {f}</li>
                      ))}
                    </ul>
                    <div className="mt-4">
                      {planAction}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {isAdmin && billingStatus?.hasStripeCustomer && (
          <div className="mt-4">
            <SmallBtn label={billingBusy ? "Loading…" : "Manage billing"} onClick={manageBilling} />
          </div>
        )}
      </Card>

      {billingStatus && (
        <Card title="Add-ons">
          <div className="space-y-3">
            {ADD_ONS.map(config => (
              <div key={config.id}>
              <AddOnRow
                config={config}
                billingStatus={billingStatus}
                isAdmin={isAdmin}
                busy={addOnBusy[config.id]}
                onPurchase={() => purchaseAddOn(config.id)}
                onCancel={() => setAddOnCancelAtPeriodEnd(config.id, false)}
                onResume={() => setAddOnCancelAtPeriodEnd(config.id, true)}
              />
              {confirmPanel(config.id)}
              {addOnNotice[config.id] && (
                <div data-testid={`addon-notice-${config.id}`}>
                  <StatusText message={addOnNotice[config.id]!.message} isError={addOnNotice[config.id]!.isError} />
                </div>
              )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function AddOnRow({
  config,
  billingStatus,
  isAdmin,
  busy,
  onPurchase,
  onCancel,
  onResume,
}: {
  readonly config: AddOnConfig;
  readonly billingStatus: {
    plan: string;
    billingInterval: BillingInterval | null;
    addOns: string[];
    graphicsSubscription: SubscriptionInfo | null;
    dataFeedSubscription: SubscriptionInfo | null;
  };
  readonly isAdmin: boolean;
  readonly busy: boolean;
  readonly onPurchase: () => void;
  readonly onCancel: () => void;
  readonly onResume: () => void;
}) {
  const hasBasePlan = billingStatus.plan === "pro" || billingStatus.plan === "venue";
  const isActive = billingStatus.addOns.includes(config.id);
  const sub = billingStatus[config.subscriptionKey];

  return isActive && sub ? (
    <ActiveAddOn config={config} sub={sub} isAdmin={isAdmin} busy={busy} onCancel={onCancel} onResume={onResume} />
  ) : (
    <InactiveAddOn
      config={config}
      hasBasePlan={hasBasePlan}
      isAdmin={isAdmin}
      interval={billingStatus.billingInterval ?? "month"}
      busy={busy}
      onPurchase={onPurchase}
    />
  );
}

function ActiveAddOn({
  config, sub, isAdmin, busy, onCancel, onResume,
}: {
  readonly config: AddOnConfig;
  readonly sub: NonNullable<SubscriptionInfo>;
  readonly isAdmin: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onResume: () => void;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}
    >
      <div>
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--accent)" }}>
          {config.name}
        </p>
        <p className="text-lg font-black mt-1" style={{ color: "var(--text-primary)" }}>
          {formatAmount(sub.amount, sub.currency, sub.interval)}
        </p>
        {sub.cancelAtPeriodEnd ? (
          <p className="text-xs mt-1" style={{ color: "var(--danger, #e05252)" }}>
            Cancels on {formatRenewalDate(sub.currentPeriodEnd)}.
          </p>
        ) : (
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            Renews {formatRenewalDate(sub.currentPeriodEnd)}
          </p>
        )}
      </div>
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {sub.cancelAtPeriodEnd ? (
            <SmallBtn label={busy ? "Loading…" : "Resume add-on"} onClick={onResume} primary />
          ) : (
            <SmallBtn label={busy ? "Loading…" : "Cancel add-on"} onClick={onCancel} />
          )}
        </div>
      )}
    </div>
  );
}

function InactiveAddOn({
  config, hasBasePlan, isAdmin, interval, busy, onPurchase,
}: {
  readonly config: AddOnConfig;
  readonly hasBasePlan: boolean;
  readonly isAdmin: boolean;
  // The plan's: add-ons are billed on the same subscription, so they renew
  // together and appear on one invoice.
  readonly interval: BillingInterval;
  readonly busy: boolean;
  readonly onPurchase: () => void;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div>
        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{config.name}</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{config.tagline}</p>
        <ul className="text-xs mt-2 space-y-0.5" style={{ color: "var(--text-secondary)" }}>
          {config.valueProps.map(v => (
            <li key={v}>• {v}</li>
          ))}
        </ul>
        {!hasBasePlan && (
          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Requires a Pro or Venue plan.</p>
        )}
      </div>
      {hasBasePlan && isAdmin && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-black" style={{ color: "var(--accent)" }}>
            {interval === "month" ? config.monthlyPrice : config.annualPrice}
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>{interval === "month" ? "/mo" : "/yr"}</span>
          </span>
          <SmallBtn label={busy ? "Loading…" : `Add ${config.name}`} onClick={onPurchase} primary />
        </div>
      )}
    </div>
  );
}

function confirmedNotice({ target, preview }: PendingChange): string {
  if (target !== "plan") return "Add-on added — it's ready to use now.";
  if (preview.kind === "schedule") return `Done. Your plan changes on ${formatRenewalDate(preview.effectiveAt)}.`;
  if (preview.kind === "keep") return "Your scheduled plan change is cancelled.";
  return "Your plan has been changed.";
}

function ConfirmChange({
  change, busy, onConfirm, onCancel,
}: {
  readonly change: PendingChange;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const { preview } = change;
  const money = (amount: number) =>
    (amount / 100).toLocaleString(undefined, { style: "currency", currency: preview.currency.toUpperCase() });
  const withGst = (amount: number) => preview.tax > 0 ? `${money(amount)} (including ${money(preview.tax)} GST)` : money(amount);
  let cost: string;
  if (preview.kind === "keep") {
    cost = "Your plan carries on as it is, and nothing changes on your bill.";
  } else if (preview.kind === "schedule") {
    const per = preview.interval === "year" ? "year" : "month";
    cost = `Nothing to pay today and no refund: your current plan stays until ${formatRenewalDate(preview.effectiveAt)}, `
      + `then you're billed ${withGst(preview.amountDue)} a ${per}.`;
  } else if (preview.chargedNow) {
    cost = `${withGst(preview.amountDue)} will be charged to your card on file now.`;
  } else {
    const proratedNote = preview.prorated > 0 ? `, including ${money(preview.prorated)} for the rest of this billing period` : "";
    cost = `Nothing to pay today. It's added to your next invoice on ${formatRenewalDate(preview.invoiceDate)}, which will be ${withGst(preview.amountDue)}${proratedNote}.`;
  }
  return (
    <div
      className="rounded-xl p-4 my-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}
      data-testid={`confirm-change-${change.target}`}
    >
      <div>
        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{change.description}</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{cost}</p>
      </div>
      <div className="flex gap-2">
        <SmallBtn label="Cancel" onClick={onCancel} />
        <SmallBtn label={busy ? "Loading…" : "Confirm"} onClick={onConfirm} primary />
      </div>
    </div>
  );
}

function formatRenewalDate(unixSeconds: number | null): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatAmount(amount: number | null, currency: string | null, interval: "month" | "year" | null): string {
  if (amount == null || !currency) return "—";
  const value = (amount / 100).toLocaleString(undefined, { style: "currency", currency: currency.toUpperCase() });
  return `${value}/${interval === "year" ? "yr" : "mo"}`;
}

function cadenceLabel(interval: BillingInterval | null | undefined): string {
  return interval === "year" ? "annually" : "monthly";
}

function SubscriptionPanel({
  billingStatus,
  billingInterval,
  setBillingInterval,
  isAdmin,
  billingBusy,
  cancelBusy,
  onUpgrade,
  onCancel,
  onResume,
}: {
  readonly billingStatus: {
    plan: string;
    billingInterval: BillingInterval | null;
    subscription: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null; amount: number | null; currency: string | null } | null;
    scheduledChange?: ScheduledChange | null;
    invoiceEmail: string | null;
    paymentMethod: { brand: string; last4: string } | null;
    upgradeDiscountAvailable: boolean;
  };
  readonly billingInterval: BillingInterval;
  readonly setBillingInterval: (interval: BillingInterval) => void;
  readonly isAdmin: boolean;
  readonly billingBusy: boolean;
  readonly cancelBusy: boolean;
  readonly onUpgrade: (plan: "pro" | "venue", interval?: BillingInterval) => void;
  readonly onCancel: () => void;
  readonly onResume: () => void;
}) {
  const plan = PLANS.find(p => p.id === billingStatus.plan);
  const sub = billingStatus.subscription;
  const interval = billingStatus.billingInterval ?? "month";
  const scheduled = billingStatus.scheduledChange;
  const scheduledName = PLANS.find(p => p.id === scheduled?.plan)?.name;
  const currentPlanId = billingStatus.plan as "pro" | "venue";
  const otherInterval: BillingInterval = interval === "year" ? "month" : "year";
  const otherIntervalName = otherInterval === "year" ? "annual" : "monthly";

  return (
    <div>
      <div
        className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}
      >
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--accent)" }}>
              {plan?.name ?? billingStatus.plan} plan
            </p>
            <SubscriptionStatusPill status={sub?.status} cancelAtPeriodEnd={sub?.cancelAtPeriodEnd} />
          </div>
          <p className="text-lg font-black mt-1" style={{ color: "var(--text-primary)" }}>
            {formatAmount(sub?.amount ?? null, sub?.currency ?? null, interval)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
            Billed {cadenceLabel(interval)}
          </p>
          {sub?.cancelAtPeriodEnd ? (
            <p className="text-xs mt-1" style={{ color: "var(--danger, #e05252)" }}>
              Cancels on {formatRenewalDate(sub.currentPeriodEnd)} — you&apos;ll move to Free after that.
            </p>
          ) : (
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              Renews {formatRenewalDate(sub?.currentPeriodEnd ?? null)}
            </p>
          )}
          {scheduled && (
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }} data-testid="scheduled-change">
              Changes to {scheduledName}, billed {cadenceLabel(scheduled.interval)}, on {formatRenewalDate(scheduled.at)}.
            </p>
          )}

          <PaymentDetails paymentMethod={billingStatus.paymentMethod} invoiceEmail={billingStatus.invoiceEmail} />
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {scheduled && !sub?.cancelAtPeriodEnd && (
              <SmallBtn
                label={billingBusy ? "Loading…" : `Keep ${plan?.name ?? billingStatus.plan}`}
                onClick={() => onUpgrade(currentPlanId, interval)}
                primary
              />
            )}
            {!scheduled && !sub?.cancelAtPeriodEnd && (
              <SmallBtn
                label={billingBusy ? "Loading…" : `Switch to ${otherIntervalName} billing`}
                onClick={() => onUpgrade(currentPlanId, otherInterval)}
              />
            )}
            {sub?.cancelAtPeriodEnd ? (
              <SmallBtn label={cancelBusy ? "Loading…" : "Resume subscription"} onClick={onResume} primary />
            ) : (
              <SmallBtn label={cancelBusy ? "Loading…" : "Downgrade to Free"} onClick={onCancel} />
            )}
          </div>
        )}
      </div>

      {isAdmin && !scheduled && !sub?.cancelAtPeriodEnd && (
        <OtherTierOffer
          currentPlan={billingStatus.plan}
          upgradeDiscountAvailable={billingStatus.upgradeDiscountAvailable}
          billingInterval={billingInterval}
          setBillingInterval={setBillingInterval}
          billingBusy={billingBusy}
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}

function PaymentDetails({ paymentMethod, invoiceEmail }: {
  readonly paymentMethod: { brand: string; last4: string } | null; readonly invoiceEmail: string | null;
}) {
  return (
    <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Payment method:{" "}
        {paymentMethod ? `${capitalize(paymentMethod.brand)} •••• ${paymentMethod.last4}` : "—"}
      </p>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Invoices sent to: {invoiceEmail ?? "—"}
      </p>
    </div>
  );
}

// Pro offers Venue as an upgrade; Venue offers Pro as a downgrade.
function OtherTierOffer({ currentPlan, upgradeDiscountAvailable, billingInterval, setBillingInterval, billingBusy, onUpgrade }: {
  readonly currentPlan: string;
  readonly upgradeDiscountAvailable: boolean;
  readonly billingInterval: BillingInterval;
  readonly setBillingInterval: (interval: BillingInterval) => void;
  readonly billingBusy: boolean;
  readonly onUpgrade: (plan: "pro" | "venue", interval?: BillingInterval) => void;
}) {
  const otherTier = PLANS.find(p => p.id === (currentPlan === "pro" ? "venue" : "pro"))!;
  const otherIsUpgrade = otherTier.id === "venue";
  const action = otherIsUpgrade ? "Upgrade" : "Switch";
  return (
    <div
      className="rounded-xl p-4 mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div>
        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          {otherIsUpgrade ? `Need more capacity? Upgrade to ${otherTier.name}` : `Need less? Switch to ${otherTier.name}`}
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          {otherIsUpgrade
            ? otherTier.tagline
            : `${otherTier.tagline}. Takes effect at the end of the period you've paid for, with no refund.`}
        </p>
        {otherIsUpgrade && upgradeDiscountAvailable && <DiscountBanner className="mt-2" compact />}
      </div>
      <div className="flex items-center gap-2">
        <SmallBtn label="Monthly" onClick={() => setBillingInterval("month")} active={billingInterval === "month"} />
        <SmallBtn label="Annual (2 months free)" onClick={() => setBillingInterval("year")} active={billingInterval === "year"} />
        <SmallBtn
          label={billingBusy ? "Loading…" : `${action} to ${otherTier.name}`}
          onClick={() => onUpgrade(otherTier.id as "pro" | "venue")}
          primary={otherIsUpgrade}
        />
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function SubscriptionStatusPill({ status, cancelAtPeriodEnd }: { readonly status?: string; readonly cancelAtPeriodEnd?: boolean }) {
  if (!status) return null;
  let label = "Active";
  let color = "var(--accent)";
  if (cancelAtPeriodEnd) {
    label = "Canceling";
    color = "var(--danger, #e05252)";
  } else if (status === "past_due" || status === "unpaid") {
    label = "Payment issue";
    color = "var(--danger, #e05252)";
  } else if (status !== "active" && status !== "trialing") {
    label = status;
    color = "var(--text-dim)";
  }
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
      style={{ color, border: `1px solid ${color}` }}
    >
      {label}
    </span>
  );
}

function DiscountBanner({ className, compact }: { readonly className?: string; readonly compact?: boolean }) {
  return (
    <div
      className={`rounded-lg ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${className ?? ""}`}
      style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: "1px solid var(--accent)" }}
    >
      <p className={compact ? "text-xs font-bold" : "text-sm font-bold"} style={{ color: "var(--accent)" }}>
        Limited-time offer: upgrade now and get 20% off your first 3 months
      </p>
    </div>
  );
}

// Client-side mirror of lib/roles.ts's rank table, used only to decide
// which roles to *offer* in the UI — the API routes are the authoritative
// enforcement, this just avoids showing controls that would 403.
const ROLE_RANK: Record<string, number> = { ADMIN: 3, MANAGER: 2, OPERATOR: 1, VIEWER: 0 };
const ALL_ROLES = ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const;

function assignableRoles(actorRole: string): string[] {
  if (actorRole === "ADMIN") return [...ALL_ROLES];
  return ALL_ROLES.filter(r => ROLE_RANK[r] < ROLE_RANK.MANAGER);
}

function canActOnRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === "ADMIN") return true;
  return ROLE_RANK[targetRole] < ROLE_RANK.MANAGER;
}

// email is only present for callers who can manage members (see the members
// API route); lower-privilege roles get names/roles without everyone's email.
type Member = { userId: string; name: string; email?: string; role: string; memberSince: string };
type PendingInvite = { id: string; email: string; role: string; createdAt: string; expiresAt: string };
type TeamData = { members: Member[]; invitations: PendingInvite[] };

async function fetchTeam(orgId: string): Promise<TeamData> {
  const [membersRes, invitesRes] = await Promise.all([
    fetch(`/api/orgs/${orgId}/members`).then(r => r.json()).catch(() => ({ members: [] })),
    fetch(`/api/orgs/${orgId}/invitations`).then(r => r.json()).catch(() => ({ invitations: [] })),
  ]);
  return { members: membersRes.members ?? [], invitations: invitesRes.invitations ?? [] };
}

function TeamCard({ orgId, actorRole, actorUserId }: { readonly orgId: string; readonly actorRole: string; readonly actorUserId: string }) {
  const { data, mutate: refresh } = useSWR(orgId, fetchTeam);
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState(assignableRoles(actorRole).at(-1) ?? "VIEWER");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  const roleOptions = assignableRoles(actorRole);

  async function handleInvite() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't send invitation");
      setInviteEmail("");
      setStatus({ message: `Invitation sent to ${inviteEmail}.`, isError: false });
      await refresh();
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    await fetch(`/api/orgs/${orgId}/invitations/${invitationId}`, { method: "DELETE" });
    await refresh();
  }

  async function handleRoleChange(userId: string, role: string) {
    const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({ message: data?.error ?? "couldn't change role", isError: true });
      return;
    }
    await refresh();
  }

  async function handleRemove(userId: string) {
    const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({ message: data?.error ?? "couldn't remove member", isError: true });
      return;
    }
    await refresh();
  }

  return (
    <Card title="Team">
      <div className="space-y-2">
        {members.map(m => (
          <div key={m.userId} className="flex items-center justify-between gap-2 py-1">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {m.name}
                {m.email && <span style={{ color: "var(--text-dim)" }}> ({m.email})</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canActOnRole(actorRole, m.role) && m.userId !== actorUserId ? (
                <select
                  className="rounded-lg px-2 py-1 text-xs font-semibold"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  value={m.role}
                  onChange={e => handleRoleChange(m.userId, e.target.value)}
                >
                  {ALL_ROLES.filter(r => r === m.role || roleOptions.includes(r)).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{m.role}</span>
              )}
              {canActOnRole(actorRole, m.role) && m.userId !== actorUserId && (
                <SmallBtn label="Remove" onClick={() => handleRemove(m.userId)} />
              )}
            </div>
          </div>
        ))}
      </div>

      {invitations.length > 0 && (
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "var(--text-dim)" }}>
            Pending invitations
          </p>
          <div className="space-y-2">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-2">
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {inv.email} — {inv.role}
                </p>
                <SmallBtn label="Revoke" onClick={() => handleRevoke(inv.id)} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "var(--text-dim)" }}>
          Invite someone
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="Email address"
            className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
          />
          <select
            className="rounded-lg px-2 py-2 text-sm font-semibold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
          >
            {roleOptions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <SmallBtn label={busy ? "Sending…" : "Invite"} onClick={handleInvite} primary />
        </div>
        {status && <StatusText message={status.message} isError={status.isError} />}
      </div>
    </Card>
  );
}

function StatusText({ message, isError }: { readonly message: string; readonly isError?: boolean }) {
  return (
    <p className="text-xs mt-2" style={{ color: isError ? "var(--danger)" : "var(--text-secondary)" }}>{message}</p>
  );
}

function DisplayNameCard({ initialName }: { readonly initialName: string }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/account/name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't update name");
      setStatus({ message: "Name updated.", isError: false });
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Display Name">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <SmallBtn label={busy ? "Saving…" : "Save"} onClick={handleSave} primary />
      </div>
      {status && <StatusText message={status.message} isError={status.isError} />}
    </Card>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleUpdate() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't update password");
      setCurrentPassword("");
      setNewPassword("");
      setStatus({ message: "Password updated.", isError: false });
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Password">
      <div className="space-y-2">
        <input
          type="password"
          placeholder="Current password"
          className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="New password (min. 8 characters)"
          className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
        />
        <SmallBtn label={busy ? "Updating…" : "Update Password"} onClick={handleUpdate} primary />
      </div>
      {status && <StatusText message={status.message} isError={status.isError} />}
    </Card>
  );
}

function EmailCard({ currentEmail }: { readonly currentEmail: string }) {
  const [pending, setPending] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/account/email")
      .then(r => r.json())
      .then(data => setPending(data?.pending ?? null))
      .catch(() => {});
  }, []);

  async function handleSend() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, currentPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't request email change");
      setPending(data.newEmail);
      setShowForm(false);
      setCurrentPassword("");
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Email Address">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>{currentEmail}</p>

      {pending && (
        <StatusText message={`A verification link was sent to ${pending} — click it to confirm the change.`} />
      )}

      {!pending && !showForm && (
        <div className="mt-3">
          <SmallBtn label="Change email" onClick={() => setShowForm(true)} />
        </div>
      )}

      {!pending && showForm && (
        <div className="space-y-2 mt-3">
          <input
            type="email"
            placeholder="New email address"
            className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Current password"
            className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
          />
          <SmallBtn label={busy ? "Sending…" : "Send verification link"} onClick={handleSend} primary />
        </div>
      )}

      {status && <StatusText message={status.message} isError={status.isError} />}
    </Card>
  );
}

type Passkey = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

async function fetchPasskeys(): Promise<Passkey[]> {
  const res = await fetch("/api/webauthn/passkeys");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.passkeys) ? data.passkeys : [];
}

function PasskeysCard() {
  // On a transient fetch failure SWR keeps the last successful list rather
  // than clearing it, matching the previous catch-and-keep behavior.
  const { data: passkeys = [], mutate: refresh } = useSWR("/api/webauthn/passkeys", fetchPasskeys);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleAdd() {
    setBusy(true);
    setStatus(null);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");

      const optionsRes = await fetch("/api/webauthn/register/options", { method: "POST" });
      const options = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) throw new Error(options?.error ?? "couldn't start passkey registration");

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, name: newName.trim() || undefined }),
      });
      const data = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) throw new Error(data?.error ?? "couldn't save passkey");

      await refresh();
      setAdding(false);
      setNewName("");
      setStatus({ message: "Passkey added.", isError: false });
    } catch (e) {
      Sentry.captureException(e);
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/webauthn/passkeys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't rename passkey");
      await refresh();
      setEditingId(null);
      setEditName("");
      setStatus({ message: "Passkey renamed.", isError: false });
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/webauthn/passkeys/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "couldn't remove passkey");
      await refresh();
      setStatus({ message: "Passkey removed.", isError: false });
    } catch (e) {
      setStatus({ message: e instanceof Error ? e.message : String(e), isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Passkeys">
      {passkeys.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No passkeys yet.</p>
      )}
      {passkeys.length > 0 && (
        <div className="space-y-2">
          {passkeys.map(pk => (
            <div key={pk.id} className="flex items-center justify-between gap-2">
              {editingId === pk.id ? (
                <div className="flex flex-1 gap-2">
                  <input
                    type="text"
                    maxLength={100}
                    autoFocus
                    className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void handleRename(pk.id); }}
                  />
                  <SmallBtn label={busy ? "Working…" : "Save"} onClick={() => handleRename(pk.id)} primary />
                  <SmallBtn label="Cancel" onClick={() => { setEditingId(null); setEditName(""); }} />
                </div>
              ) : (
                <>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {pk.name ?? "Unnamed passkey"} · added {new Date(pk.createdAt).toLocaleDateString()}
                  </span>
                  <div className="flex gap-2">
                    <SmallBtn label="Rename" onClick={() => { setEditingId(pk.id); setEditName(pk.name ?? ""); }} />
                    <SmallBtn label="Remove" onClick={() => handleRemove(pk.id)} />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        {adding ? (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. MacBook Pro"
              maxLength={100}
              autoFocus
              className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void handleAdd(); }}
            />
            <SmallBtn label={busy ? "Working…" : "Continue"} onClick={handleAdd} primary />
            <SmallBtn label="Cancel" onClick={() => { setAdding(false); setNewName(""); }} />
          </div>
        ) : (
          <SmallBtn label="Add a passkey" onClick={() => setAdding(true)} primary />
        )}
      </div>
      {status && <StatusText message={status.message} isError={status.isError} />}
    </Card>
  );
}
