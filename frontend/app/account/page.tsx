"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import * as Sentry from "@sentry/nextjs";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/stripe-client";
import { Card, SmallBtn } from "../components/primitives";

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    monthlyPrice: "$0",
    annualPrice: "$0",
    tagline: "Get started with one live match",
    features: ["1 live match at a time", "No custom branding"],
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
      "Sponsor bugs, lower-thirds, and scoreboard overlays without extra hardware",
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
    addOns: string[];
    graphicsSubscription: SubscriptionInfo | null;
    dataFeedSubscription: SubscriptionInfo | null;
    invoiceEmail: string | null;
    paymentMethod: { brand: string; last4: string } | null;
    upgradeDiscountAvailable: boolean;
  } | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [checkoutKind, setCheckoutKind] = useState<"plan" | AddOnId | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [addOnInterval, setAddOnInterval] = useState<Record<AddOnId, BillingInterval>>({
    "graphics-operator": "month",
    "data-feed": "month",
  });
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [finishingUp, setFinishingUp] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [addOnBusy, setAddOnBusy] = useState<Record<AddOnId, boolean>>({
    "graphics-operator": false,
    "data-feed": false,
  });

  const fetchBillingStatus = useCallback(() =>
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(data => {
        setBillingStatus(data);
        if (data.billingInterval) setBillingInterval(data.billingInterval);
        setAddOnInterval(prev => ({
          "graphics-operator": data.graphicsSubscription?.interval ?? prev["graphics-operator"],
          "data-feed": data.dataFeedSubscription?.interval ?? prev["data-feed"],
        }));
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

  // Same polling gap as waitForPlanChange, but for the add-on's own webhook
  // path (checkout.session.completed -> Account.addOns).
  async function waitForAddOnChange(addOnId: AddOnId, hadAddOn: boolean) {
    setFinishingUp(true);
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(r => setTimeout(r, 1500));
        const data = await fetchBillingStatus();
        if (data && data.addOns.includes(addOnId) !== hadAddOn) return;
      }
    } finally {
      setFinishingUp(false);
    }
  }

  useEffect(() => {
    fetchBillingStatus();
  }, [fetchBillingStatus]);

  async function upgrade(plan: "pro" | "venue") {
    setBillingBusy(true);
    setSwitchNotice(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval: billingInterval }),
      });
      const data = await res.json().catch(() => null);
      if (data?.clientSecret) {
        setCheckoutKind("plan");
        setCheckoutSecret(data.clientSecret);
      } else if (data?.switched) {
        await fetchBillingStatus();
        setSwitchNotice(`Switched to the ${data.plan} plan.`);
      } else {
        setSwitchNotice(data?.error ?? "couldn't start checkout");
      }
    } finally {
      setBillingBusy(false);
    }
  }

  async function purchaseAddOn(addOnId: AddOnId) {
    setAddOnBusy(prev => ({ ...prev, [addOnId]: true }));
    setSwitchNotice(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addOn: addOnId, interval: addOnInterval[addOnId] }),
      });
      const data = await res.json();
      if (data.clientSecret) {
        setCheckoutKind(addOnId);
        setCheckoutSecret(data.clientSecret);
      } else if (data.switched) {
        await fetchBillingStatus();
        setSwitchNotice(`Switched the ${ADD_ONS.find(a => a.id === addOnId)?.name} add-on billing interval.`);
      } else if (data.error) {
        setSwitchNotice(data.error);
      }
    } finally {
      setAddOnBusy(prev => ({ ...prev, [addOnId]: false }));
    }
  }

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
          <TeamCard orgId={session.user.activeOrgId} actorRole={session.user.activeRole} actorUserId={session.user.id} />
        )}

      {checkoutSecret ? (
        <Card title="Upgrade">
          <button
            className="text-xs font-bold mb-3"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => setCheckoutSecret(null)}
          >
            ← Back
          </button>
          <EmbeddedCheckoutProvider
            stripe={getStripeClient()}
            options={{
              clientSecret: checkoutSecret,
              onComplete: () => {
                const previousPlan = billingStatus?.plan;
                const kind = checkoutKind;
                const hadAddOn = kind && kind !== "plan" ? (billingStatus?.addOns.includes(kind) ?? false) : false;
                setCheckoutSecret(null);
                setCheckoutKind(null);
                if (kind && kind !== "plan") waitForAddOnChange(kind, hadAddOn);
                else waitForPlanChange(previousPlan);
              },
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </Card>
      ) : (
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
      )}

      {!checkoutSecret && billingStatus && (
        <Card title="Add-ons">
          <div className="space-y-3">
            {ADD_ONS.map(config => (
              <AddOnRow
                key={config.id}
                config={config}
                billingStatus={billingStatus}
                isAdmin={isAdmin}
                interval={addOnInterval[config.id]}
                setInterval={value => setAddOnInterval(prev => ({ ...prev, [config.id]: value }))}
                busy={addOnBusy[config.id]}
                onPurchase={() => purchaseAddOn(config.id)}
                onCancel={() => setAddOnCancelAtPeriodEnd(config.id, false)}
                onResume={() => setAddOnCancelAtPeriodEnd(config.id, true)}
              />
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
  interval,
  setInterval,
  busy,
  onPurchase,
  onCancel,
  onResume,
}: {
  readonly config: AddOnConfig;
  readonly billingStatus: {
    plan: string;
    addOns: string[];
    graphicsSubscription: SubscriptionInfo | null;
    dataFeedSubscription: SubscriptionInfo | null;
  };
  readonly isAdmin: boolean;
  readonly interval: BillingInterval;
  readonly setInterval: (interval: BillingInterval) => void;
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
      interval={interval}
      setInterval={setInterval}
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
  config, hasBasePlan, isAdmin, interval, setInterval, busy, onPurchase,
}: {
  readonly config: AddOnConfig;
  readonly hasBasePlan: boolean;
  readonly isAdmin: boolean;
  readonly interval: BillingInterval;
  readonly setInterval: (interval: BillingInterval) => void;
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
          <SmallBtn label="Monthly" onClick={() => setInterval("month")} active={interval === "month"} />
          <SmallBtn label="Annual (2 months free)" onClick={() => setInterval("year")} active={interval === "year"} />
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

function formatRenewalDate(unixSeconds: number | null): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatAmount(amount: number | null, currency: string | null, interval: "month" | "year" | null): string {
  if (amount == null || !currency) return "—";
  const value = (amount / 100).toLocaleString(undefined, { style: "currency", currency: currency.toUpperCase() });
  return `${value}/${interval === "year" ? "yr" : "mo"}`;
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
    invoiceEmail: string | null;
    paymentMethod: { brand: string; last4: string } | null;
    upgradeDiscountAvailable: boolean;
  };
  readonly billingInterval: BillingInterval;
  readonly setBillingInterval: (interval: BillingInterval) => void;
  readonly isAdmin: boolean;
  readonly billingBusy: boolean;
  readonly cancelBusy: boolean;
  readonly onUpgrade: (plan: "pro" | "venue") => void;
  readonly onCancel: () => void;
  readonly onResume: () => void;
}) {
  const plan = PLANS.find(p => p.id === billingStatus.plan);
  const nextTier = billingStatus.plan === "pro" ? PLANS.find(p => p.id === "venue") : null;
  const sub = billingStatus.subscription;
  const interval = billingStatus.billingInterval ?? "month";

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
            Billed {interval === "year" ? "annually" : "monthly"}
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

          <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Payment method:{" "}
              {billingStatus.paymentMethod
                ? `${capitalize(billingStatus.paymentMethod.brand)} •••• ${billingStatus.paymentMethod.last4}`
                : "—"}
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Invoices sent to: {billingStatus.invoiceEmail ?? "—"}
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {sub?.cancelAtPeriodEnd ? (
              <SmallBtn label={cancelBusy ? "Loading…" : "Resume subscription"} onClick={onResume} primary />
            ) : (
              <SmallBtn label={cancelBusy ? "Loading…" : "Downgrade to Free"} onClick={onCancel} />
            )}
          </div>
        )}
      </div>

      {isAdmin && nextTier && !sub?.cancelAtPeriodEnd && (
        <div
          className="rounded-xl p-4 mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Need more capacity? Upgrade to {nextTier.name}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{nextTier.tagline}</p>
            {billingStatus.upgradeDiscountAvailable && <DiscountBanner className="mt-2" compact />}
          </div>
          <div className="flex items-center gap-2">
            <SmallBtn label="Monthly" onClick={() => setBillingInterval("month")} active={billingInterval === "month"} />
            <SmallBtn label="Annual (2 months free)" onClick={() => setBillingInterval("year")} active={billingInterval === "year"} />
            <SmallBtn
              label={billingBusy ? "Loading…" : `Upgrade to ${nextTier.name}`}
              onClick={() => onUpgrade(nextTier.id as "venue")}
              primary
            />
          </div>
        </div>
      )}
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
                    onKeyDown={e => { if (e.key === "Enter") handleRename(pk.id); }}
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
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
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
