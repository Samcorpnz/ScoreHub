import { APP_URL, HELP_URL, pageMetadata } from "../site";
import { PlanCards, ComparisonTable } from "../components/PricingTables";
import { Faq, type FaqItem } from "../components/Faq";
import { CtaBand } from "../components/CtaBand";
import { JsonLd, breadcrumbLd } from "../components/JsonLd";

export const metadata = pageMetadata({
  title: "Pricing — Free, Pro & Venue Plans — ScoreHub",
  description:
    "ScoreHub pricing in NZD: Free for one live match at a time, Pro at $89/month for concurrent matches and branding, Venue at $349/month for multi-court venues and tournaments. Annual billing saves two months.",
  path: "/pricing",
});

const faq: FaqItem[] = [
  {
    q: "Is there a free plan?",
    a: "Yes. Every account starts on Free with no card required. It includes every sport, every display type and Stream Deck control, with one live match at a time.",
  },
  {
    q: "What counts as a live match?",
    a: "A match is live from when it's started until someone selects End Match. Upcoming fixtures and ended matches don't count, so you can have as many of those as you like on any plan.",
  },
  {
    q: "What currency are the prices in?",
    a: "All prices are in New Zealand dollars (NZD).",
  },
  {
    q: "How does annual billing work?",
    a: "The annual price on every plan and add-on is ten times the monthly price, so you get two months free.",
  },
  {
    q: "What's the difference between Pro and Venue?",
    a: "Both include concurrent live matches, logos, display themes, sound cues and fixture upload. Pro suits a single venue or club. Venue is sized for multi-court venues, national sports organisations and tournaments, with a multi-organisation structure.",
  },
  {
    q: "Do I need an add-on to show the score in OBS or on a venue screen?",
    a: "No. ScoreHub's own displays, including the streaming overlay and scorebug, are included in every plan. The Graphics add-on adds switchable broadcast scenes, and the Data Feed add-on connects a physical console or third-party graphics software.",
  },
  {
    q: "Can I use the add-ons on the Free plan?",
    a: "No. The Graphics and Data Feed add-ons need an active Pro or Venue plan. Each add-on is billed separately on top of the plan.",
  },
  {
    q: "Does one plan cover more than one organisation?",
    a: "A plan and its add-ons belong to your account. If your account has more than one organisation, they share the plan.",
  },
  {
    q: "Can I cancel at any time?",
    a: "Yes. Cancelling schedules the plan to end at the close of the current billing period. You keep paid features until then, and the account moves to Free afterwards. You can resume before that date without checking out again.",
  },
];

export default function PricingPage() {
  return (
    <main id="main-content">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ])}
      />
      <section className="page-hero">
        <p className="breadcrumb">
          <a href="/">Home</a> / Pricing
        </p>
        <p className="eyebrow">Pricing</p>
        <h1>Simple pricing for live scoring</h1>
        <p className="lede">
          Three plans, billed monthly or annually in NZD. Start free with one live match at a time,
          and move up when you need more courts running at once or your own branding on the
          displays.
        </p>
      </section>

      <section aria-labelledby="plans-heading" className="section section-tight">
        <h2 id="plans-heading" className="sr-only">
          Plans and add-ons
        </h2>
        <PlanCards />
        <a href={`${APP_URL}/signup`} className="btn btn-primary">
          Get Started
        </a>
      </section>

      <section aria-labelledby="compare-heading" className="section section-tight">
        <p className="eyebrow">Compare</p>
        <h2 id="compare-heading" className="section-heading">
          What each plan includes
        </h2>
        <ComparisonTable />
        <p className="section-lede" style={{ margin: 0 }}>
          Plans are managed from the Account page in the app.{" "}
          <a className="text-link" href={`${HELP_URL}/billing`}>
            Billing help
          </a>{" "}
          covers upgrading, invoices and cancelling.
        </p>
      </section>

      <Faq items={faq} />

      <section aria-labelledby="talk-heading" className="section section-tight">
        <p className="eyebrow">Talk to us</p>
        <h2 id="talk-heading" className="section-heading">
          Not sure which plan fits?
        </h2>
        <div className="prose">
          <p>
            Tell us about your venue, league or broadcast and we&apos;ll point you at the right
            plan. <a href="/#contact">Request a walkthrough</a> or email{" "}
            <a href="mailto:hello@scorehub.co.nz">hello@scorehub.co.nz</a>.
          </p>
        </div>
      </section>

      <CtaBand heading="Ready to run matchday from a browser?" />
    </main>
  );
}
