import { useEffect, useState } from "react";

// The active account's add-ons ("graphics-operator", "data-feed"), or null
// when billing status can't be read (e.g. a self-hosted deployment with no
// billing). `loaded` separates that from still loading. Like useBillingPlan,
// callers treat the unknown case as unrestricted — the relay enforces the
// add-on regardless.
export function useAddOns(): { addOns: string[] | null; loaded: boolean } {
  const [result, setResult] = useState<{ addOns: string[] | null; loaded: boolean }>({ addOns: null, loaded: false });
  useEffect(() => {
    fetch("/api/billing/status")
      .then(res => (res.ok ? res.json() : null))
      .then(data => setResult({ addOns: Array.isArray(data?.addOns) ? data.addOns : null, loaded: true }))
      .catch(() => setResult({ addOns: null, loaded: true }));
  }, []);
  return result;
}

// true / false once known, null while loading
export function useHasAddOn(name: string): boolean | null {
  const { addOns, loaded } = useAddOns();
  if (!loaded) return null;
  return addOns === null || addOns.includes(name);
}
