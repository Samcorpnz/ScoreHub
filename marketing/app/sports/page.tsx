import { SPORTS } from "../sports-data";
import { APP_URL, pageMetadata } from "../site";
import { CtaBand } from "../components/CtaBand";
import { JsonLd, breadcrumbLd } from "../components/JsonLd";

export const metadata = pageMetadata({
  title: "Scoreboards for 21 Sports — ScoreHub",
  description:
    "Online scoreboards and scoring templates for 21 sports, from netball and basketball to cricket, softball and lawn bowls. Periods, clock and score buttons are set up for each one.",
  path: "/sports",
});

export default function SportsIndex() {
  return (
    <main id="main-content">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Sports", path: "/sports" },
        ])}
      />
      <section className="page-hero">
        <p className="breadcrumb">
          <a href="/">Home</a> / Sports
        </p>
        <p className="eyebrow">Sports</p>
        <h1>A scoreboard for every sport you run</h1>
        <p className="lede">
          ScoreHub ships a scoring template for each of the 21 sports below. Match structure, clock
          behaviour and score buttons are already configured, so setting up a match is just picking
          the sport and naming the teams.
        </p>
        <div className="hero-actions">
          <a href={`${APP_URL}/signup`} className="btn btn-primary">
            Get Started
          </a>
          <a href="/pricing" className="btn btn-secondary">
            See pricing
          </a>
        </div>
      </section>

      <section aria-labelledby="all-sports-heading" className="section section-tight">
        <h2 id="all-sports-heading" className="sr-only">
          All sports
        </h2>
        <ul className="card-grid">
          {SPORTS.map(sport => (
            <li key={sport.slug}>
              <a className="card" href={`/sports/${sport.slug}`} style={{ height: "100%" }}>
                <p className="card-meta">{sport.structure}</p>
                <h3>{sport.name}</h3>
                <p>{sport.summary}</p>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="other-heading" className="section section-tight">
        <p className="eyebrow">Not on the list?</p>
        <h2 id="other-heading" className="section-heading">
          Score any other sport with the custom template
        </h2>
        <div className="prose">
          <p>
            The Custom template is a general-purpose scoreboard: two periods on a 10-minute
            countdown with +1, +2 and +3 buttons. Use it for a sport we don&apos;t have a named
            template for yet.
          </p>
          <p>
            If you score that sport regularly, <a href="/#contact">tell us about it</a>. Sports are
            driven by configuration, so adding one with the right period labels, clock and score
            buttons is straightforward.
          </p>
        </div>
      </section>

      <CtaBand heading="Ready to run matchday from a browser?" />
    </main>
  );
}
