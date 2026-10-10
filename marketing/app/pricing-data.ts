export const plans = [
  {
    name: "Free",
    price: "$0",
    period: "",
    detail: "One live match at a time — try it before a first game.",
  },
  {
    name: "Pro",
    price: "$89",
    period: "/mo",
    annual: "$890/yr — 2 months free",
    detail: "Concurrent matches for a single venue or club.",
  },
  {
    name: "Venue",
    price: "$349",
    period: "/mo",
    annual: "$3,490/yr — 2 months free",
    detail: "Multi-court venues, NSOs, and tournaments.",
  },
] as const;

// Optional add-ons stack on top of Pro or Venue — see requireAddOn() in
// relay/src/entitlements.ts. Both bill monthly or annually (10x monthly, 2
// months free), same as the base plans.
export const addOns = [
  {
    name: "Graphics add-on",
    price: "$29",
    period: "/mo",
    annual: "$290/yr",
    detail: "Scene-driven broadcast overlays — lower-thirds, player cards, stat panels — on one stable Browser Source URL for OBS/vMix/Wirecast.",
  },
  {
    name: "Data Feed add-on",
    price: "$39",
    period: "/mo",
    annual: "$390/yr",
    detail: "Bridge a physical Saturn/Vega scoreboard console, or pipe the live match state into a third-party graphics engine (Singular.live, Chyron, VIZRT) over REST or WebSocket.",
  },
] as const;

// Rows shown "as-is" per plan use a literal string; boolean rows render a
// check or dash. Kept to claims already made elsewhere on this site/in
// requirePlan() calls (relay/src/server.ts) — no capability implied here
// that isn't gated or marketed as such today.
export const comparisonRows = [
  { label: "Concurrent live matches", free: "1 at a time", pro: "Unlimited", venue: "Unlimited" },
  { label: "Sports supported", free: "21 sports", pro: "21 sports", venue: "21 sports" },
  { label: "Browser control panel", free: true, pro: true, venue: true },
  { label: "Venue & broadcast displays", free: true, pro: true, venue: true },
  { label: "Stream Deck & webhook control", free: true, pro: true, venue: true },
  { label: "Custom team & competition logos", free: false, pro: true, venue: true },
  { label: "Custom display theme (colours, font, text size)", free: false, pro: true, venue: true },
  { label: "Displays without the “Powered by ScoreHub” mark", free: false, pro: true, venue: true },
  { label: "Custom sound cues", free: false, pro: true, venue: true },
  { label: "Fixture upload (CSV)", free: false, pro: true, venue: true },
  { label: "Org structure", free: "Single org", pro: "Single org", venue: "Multi-org (NSOs, tournaments)" },
  { label: "Graphics add-on eligible", free: false, pro: true, venue: true },
  { label: "Data Feed add-on eligible", free: false, pro: true, venue: true },
] as const;
