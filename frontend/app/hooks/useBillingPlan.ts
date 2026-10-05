import { useEffect, useState } from "react";

// The active org's account plan ("free" | "pro" | "venue"), or null while
// loading / when it can't be determined (e.g. a self-hosted deployment with
// no billing). Callers gate on an explicit "free" so the unknown case stays
// unrestricted in the UI — the relay enforces the plan regardless.
export function useBillingPlan(): string | null {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/billing/status")
      .then(res => (res.ok ? res.json() : null))
      .then(data => setPlan(data?.plan ?? null))
      .catch(() => setPlan(null));
  }, []);
  return plan;
}
