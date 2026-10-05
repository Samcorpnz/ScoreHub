import { GraphicsGallery } from "./components/GraphicsGallery";
import { ContactForm } from "./components/ContactForm";
import { BrowserIcon, BroadcastIcon, GridIcon, ControlsIcon } from "./components/icons";

const APP_URL = "https://app.scorehub.co.nz";

const segments = [
  {
    key: "venue",
    color: "var(--venue)",
    name: "Venues & Clubs",
    plan: "Venue plan",
    hook: "Your scoreboard operator scores from a tablet at the table. Getting that live on the concourse screens shouldn't be a second job.",
    proof: "Browser-based control panel, nothing to install. Already wired into a scoreboard console or a third-party data feed? Bridge it in with the Data Feed add-on.",
  },
  {
    key: "nso",
    color: "var(--nso)",
    name: "NSOs & Event Ops",
    plan: "Venue / multi-org",
    hook: "You run 40 courts across a national tournament. Every table needs to score from a browser, not a hardware setup you have to configure.",
    proof: "21 sports supported out of the box, multi-tenant orgs, concurrent live matches — all from the browser control panel.",
  },
  {
    key: "broadcast",
    color: "var(--broadcast)",
    name: "Streamers & Broadcast",
    plan: "Graphics add-on",
    hook: "You run OBS solo. The scorebug needs to update itself, because you're also on commentary and camera.",
    proof: "Transparent overlay and scorebug, drop-in as an OBS/vMix/Wirecast Browser Source, synced to the live score.",
  },
] as const;

const pillars = [
  {
    Icon: BrowserIcon,
    tag: "No hardware required",
    body: "Score any match from a browser — laptop, tablet, or phone. Nothing to install at the venue.",
  },
  {
    Icon: BroadcastIcon,
    tag: "One state, every screen",
    body: "A single live match state pushes to venue displays, overlays, and the operator panel at once.",
  },
  {
    Icon: GridIcon,
    tag: "21 sports, no custom build",
    body: "Netball to indoor cricket to lawn bowls, config-driven — pricing stays flat, not \"contact us.\"",
  },
  {
    Icon: ControlsIcon,
    tag: "Built for the operator",
    body: "The browser control panel is the surface non-technical matchday staff actually touch.",
  },
] as const;

const plans = [
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
const addOns = [
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
// check or dash. Kept to claims already made elsewhere on this page/in
// requirePlan() calls (relay/src/server.ts) — no capability implied here
// that isn't gated or marketed as such today.
const comparisonRows = [
  { label: "Concurrent live matches", free: "1 at a time", pro: "Unlimited", venue: "Unlimited" },
  { label: "Sports supported", free: "21 sports", pro: "21 sports", venue: "21 sports" },
  { label: "Browser control panel", free: true, pro: true, venue: true },
  { label: "Venue & broadcast displays", free: true, pro: true, venue: true },
  { label: "Custom team & competition logos", free: false, pro: true, venue: true },
  { label: "Custom display theme (colours, font, text size)", free: false, pro: true, venue: true },
  { label: "Displays without the “Powered by ScoreHub” mark", free: false, pro: true, venue: true },
  { label: "Custom sound cues", free: false, pro: true, venue: true },
  { label: "Org structure", free: "Single org", pro: "Single org", venue: "Multi-org (NSOs, tournaments)" },
  { label: "Graphics add-on eligible", free: false, pro: true, venue: true },
  { label: "Data Feed add-on eligible", free: false, pro: true, venue: true },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ScoreHub",
  applicationCategory: "SportsApplication",
  operatingSystem: "Web",
  url: "https://scorehub.co.nz",
  description:
    "Browser-based live sport scoring app — score any match from a laptop, tablet, or phone and push one live match state to venue screens, broadcast overlays, and streaming platforms. No hardware required.",
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "NZD" },
    { "@type": "Offer", name: "Pro", price: "89", priceCurrency: "NZD" },
    { "@type": "Offer", name: "Venue", price: "349", priceCurrency: "NZD" },
    { "@type": "Offer", name: "Graphics add-on", price: "29", priceCurrency: "NZD" },
    { "@type": "Offer", name: "Data Feed add-on", price: "39", priceCurrency: "NZD" },
  ],
};

export default function Home() {
  return (
    <main id="main-content">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <section
        style={{
          position: "relative",
          maxWidth: "var(--max-width)",
          margin: "0 auto",
          padding: "4.5rem 1.5rem 3.5rem",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-4rem",
            left: "50%",
            transform: "translateX(-50%)",
            width: "620px",
            maxWidth: "140%",
            height: "420px",
            background: "radial-gradient(ellipse closest-side, var(--accent-dim), transparent 70%)",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
        <p className="eyebrow">ScoreHub</p>
        <h1
          style={{
            fontSize: "clamp(2.6rem, 6.5vw, 4.4rem)",
            lineHeight: 0.98,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            textTransform: "uppercase",
            margin: "0 0 1.3rem",
            maxWidth: "16ch",
          }}
        >
          Live sport scoring that runs from a browser.
        </h1>
        <p
          style={{
            fontFamily: "-apple-system, sans-serif",
            fontSize: "1.15rem",
            fontWeight: 400,
            color: "var(--text-secondary)",
            maxWidth: "54ch",
            margin: "0 0 2.25rem",
          }}
        >
          Score any match from a laptop, tablet, or phone — no hardware, nothing to install — and
          push one live match state to venue screens, broadcast overlays, and the crowd&apos;s
          phones, instantly. Already wired into a scoreboard console or a third-party data feed?
          Bridge it in as an add-on.
        </p>
        <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap" }}>
          <a href={`${APP_URL}/signup`} className="btn btn-primary">
            Get Started
          </a>
          <a href="#pricing" className="btn btn-secondary">
            See pricing
          </a>
        </div>
      </section>

      <section aria-labelledby="segments-heading" className="section section-tight">
        <p className="eyebrow">Who it&apos;s for</p>
        <h2 id="segments-heading" style={{ fontSize: "1.7rem", fontWeight: 600, textTransform: "uppercase", margin: "0 0 1.5rem" }}>
          Built for how you run matchday
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1rem",
          }}
        >
          {segments.map((s) => (
            <a
              key={s.key}
              href="#pricing"
              style={{
                display: "block",
                borderRadius: 12,
                border: "1px solid var(--border)",
                borderTop: `3px solid ${s.color}`,
                background: "var(--bg-surface)",
                padding: "1.25rem 1.35rem",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "0.6rem",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 800, fontSize: "1.02rem" }}>{s.name}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: "0.65rem",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: s.color,
                    border: `1px solid ${s.color}`,
                    borderRadius: 100,
                    padding: "0.15rem 0.5rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.plan}
                </span>
              </div>
              <p style={{ margin: "0 0 0.6rem", fontSize: "0.92rem", color: "var(--text-primary)" }}>
                {s.hook}
              </p>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>{s.proof}</p>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="graphics-heading" className="section section-tight">
        <p className="eyebrow">On screen</p>
        <h2 id="graphics-heading" style={{ fontSize: "1.7rem", fontWeight: 600, textTransform: "uppercase", margin: "0 0 0.5rem" }}>
          See the graphics you can put on screen
        </h2>
        <p style={{ margin: "0 0 1.5rem", fontSize: "0.95rem", color: "var(--text-secondary)", maxWidth: "62ch" }}>
          Every display below is driven by the same live match state, entered from the browser
          control panel — venue board, broadcast overlay, or sport-specific stats panel, all
          updating together.
        </p>
        <GraphicsGallery />
      </section>

      <section aria-labelledby="why-heading" className="section section-tight">
        <p className="eyebrow">Why teams switch</p>
        <h2 id="why-heading" style={{ fontSize: "1.7rem", fontWeight: 600, textTransform: "uppercase", margin: "0 0 1.5rem" }}>
          No hardware, no drift
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.9rem",
          }}
        >
          {pillars.map(({ Icon, tag, body }) => (
            <div
              key={tag}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "1.25rem",
                background: "var(--bg-surface)",
              }}
            >
              <Icon className="icon" />
              <p style={{ margin: "0.75rem 0 0", fontSize: "0.98rem", fontWeight: 700 }}>{tag}</p>
              <p style={{ margin: "0.4rem 0 0", fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading" className="section section-tight">
        <p className="eyebrow">Plans</p>
        <h2 id="pricing-heading" style={{ fontSize: "1.7rem", fontWeight: 600, textTransform: "uppercase", margin: "0 0 0.5rem" }}>
          Pick your plan
        </h2>
        <p style={{ margin: "0 0 1.5rem", fontSize: "0.95rem", color: "var(--text-secondary)", maxWidth: "62ch" }}>
          Three plans, billed monthly or annually. Two optional add-ons stack on top of Pro or
          Venue — pick either, both, or neither.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.9rem",
            marginBottom: "1.5rem",
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.name}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "1.25rem 1.35rem",
                background: "var(--bg-surface)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>{plan.name}</p>
              <p className="mono" style={{ margin: "0.25rem 0 0.15rem", fontSize: "1.4rem", color: "var(--accent)" }}>
                {plan.price}
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{plan.period}</span>
              </p>
              {"annual" in plan && (
                <p className="mono" style={{ margin: "0 0 0.6rem", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                  {plan.annual}
                </p>
              )}
              <p style={{ margin: "annual" in plan ? 0 : "0.6rem 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                {plan.detail}
              </p>
            </div>
          ))}
        </div>

        <p className="eyebrow" style={{ margin: "0 0 0.75rem" }}>
          + Optional add-ons
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "0.9rem",
            marginBottom: "2rem",
          }}
        >
          {addOns.map((addOn) => (
            <div
              key={addOn.name}
              style={{
                border: "1px dashed var(--border-strong)",
                borderRadius: 10,
                padding: "1.1rem 1.25rem",
                background: "var(--bg-surface)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>{addOn.name}</p>
                <p className="mono" style={{ margin: 0, fontSize: "1rem", color: "var(--accent)" }}>
                  +{addOn.price}
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{addOn.period}</span>
                </p>
              </div>
              <p className="mono" style={{ margin: "0.1rem 0 0.5rem", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                {addOn.annual} · requires Pro or Venue
              </p>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>{addOn.detail}</p>
            </div>
          ))}
        </div>

        <div style={{ overflowX: "auto", marginBottom: "1.75rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, fontSize: "0.85rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border-strong)", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Feature
                </th>
                {["Free", "Pro", "Venue"].map((col) => (
                  <th
                    key={col}
                    style={{ textAlign: "left", padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border-strong)", fontWeight: 800 }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: "0.55rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    {row.label}
                  </td>
                  {[row.free, row.pro, row.venue].map((cell, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <td key={i} style={{ padding: "0.55rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
                      {typeof cell === "boolean" ? (
                        <span aria-hidden="true" style={{ color: cell ? "var(--broadcast)" : "var(--text-secondary)" }}>
                          {cell ? "✓" : "—"}
                        </span>
                      ) : (
                        cell
                      )}
                      {typeof cell === "boolean" && <span className="sr-only">{cell ? "Included" : "Not included"}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <a href={`${APP_URL}/signup`} className="btn btn-primary">
          Get Started
        </a>
      </section>

      <section id="contact" aria-labelledby="contact-heading" className="section section-tight">
        <p className="eyebrow">Talk to us</p>
        <h2 id="contact-heading" style={{ fontSize: "1.7rem", fontWeight: 600, textTransform: "uppercase", margin: "0 0 0.5rem" }}>
          Prefer a walkthrough first?
        </h2>
        <p style={{ margin: "0 0 1.5rem", fontSize: "0.95rem", color: "var(--text-secondary)", maxWidth: "62ch" }}>
          Tell us about your venue, league, or broadcast and we&apos;ll get back to you — usually
          within a business day.
        </p>
        <ContactForm />
      </section>

      <section className="cta-band" aria-labelledby="cta-heading">
        <h2
          id="cta-heading"
          style={{ fontSize: "clamp(1.6rem, 4vw, 2.4rem)", fontWeight: 600, textTransform: "uppercase", margin: "0 0 1rem" }}
        >
          Ready to run matchday from a browser?
        </h2>
        <p style={{ margin: "0 0 1.75rem", color: "var(--text-secondary)", fontSize: "1rem" }}>
          Free to try — one live match, no card required.
        </p>
        <a href={`${APP_URL}/signup`} className="btn btn-primary">
          Get Started
        </a>
      </section>
    </main>
  );
}
