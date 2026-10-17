import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SPORTS, getSport, type Sport } from "../../sports-data";
import { APP_URL, HELP_URL, pageMetadata } from "../../site";
import { Faq, type FaqItem } from "../../components/Faq";
import { CtaBand } from "../../components/CtaBand";
import { JsonLd, breadcrumbLd } from "../../components/JsonLd";
import { ScreenshotRow } from "../../components/Screenshot";
import { SHOTS } from "../../screenshots";

export const dynamicParams = false;

export function generateStaticParams() {
  return SPORTS.map(s => ({ sport: s.slug }));
}

type Props = { readonly params: Promise<{ sport: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const sport = getSport((await params).sport);
  if (!sport) return {};
  return pageMetadata({
    title: `${sport.name} Scoreboard & Scoring App — ScoreHub`,
    description: `Score ${sport.lower} live from any browser. ${sport.summary} Show it on venue screens, OBS overlays and phones. Free to start.`,
    path: `/sports/${sport.slug}`,
  });
}

function phoneAnswer(sport: Sport): string {
  if (sport.dedicatedPanel) {
    return `${sport.name} uses its own scoring panel, which runs in the browser on a laptop or tablet. ScoreHub's cut-down mobile panel doesn't include it, so use a tablet or laptop at the scorer's table.`;
  }
  if (sport.slug === "indoor-cricket") {
    return "Yes for runs: sign in on your phone, open the match and switch to the mobile panel. The Wicket button is on the full control panel, so use a tablet or laptop if one person is scoring everything.";
  }
  return `Yes. Sign in on your phone, open the match and switch to the mobile panel, which is laid out for one hand. It scores the same match as the full panel, so every display updates the same way. Ending a period and recording timeouts are done from the full panel.`;
}

function faqFor(sport: Sport): FaqItem[] {
  const items: FaqItem[] = [
    {
      q: `Is ScoreHub free for ${sport.lower}?`,
      a: `Yes. The Free plan includes every sport and every display type, with one live match at a time and no card required. Pro adds concurrent matches, logos and custom display themes.`,
    },
    {
      q: `Do I need a physical scoreboard to score ${sport.lower}?`,
      a: `No. ScoreHub runs in a web browser, and any screen that can open a web page can be the scoreboard: a TV with a laptop plugged in, a projector, a tablet or a phone. If your venue already has a Saturn or Vega console, the Data Feed add-on can read the score from it instead.`,
    },
    {
      q: `Can I score ${sport.lower} from a phone?`,
      a: phoneAnswer(sport),
    },
    {
      q: `Can I show the ${sport.lower} score on a live stream?`,
      a: `Yes. Add the overlay or scorebug link as a Browser Source in OBS, vMix or Wirecast. Both have transparent backgrounds, so they sit over your camera with no chroma key and update as you score.`,
    },
  ];
  if (sport.countDown) {
    items.push({
      q: "Can I change the period length?",
      a: `Yes. The template starts each period at its default (${sport.structure.toLowerCase()}), and you can type any time into the clock and select Set. Ending a period resets the clock to the template's length, so set it again at each break if your competition plays shorter periods.`,
    });
  }
  return items;
}

export default async function SportPage({ params }: Props) {
  const sport = getSport((await params).sport);
  if (!sport) notFound();

  const related = sport.related.map(getSport).filter((s): s is Sport => Boolean(s));

  return (
    <main id="main-content">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Sports", path: "/sports" },
          { name: sport.name, path: `/sports/${sport.slug}` },
        ])}
      />
      <section className="page-hero">
        <p className="breadcrumb">
          <a href="/">Home</a> / <a href="/sports">Sports</a> / {sport.name}
        </p>
        <p className="eyebrow">{sport.name}</p>
        <h1>{sport.name} scoreboard &amp; scoring app</h1>
        <p className="lede">{sport.intro}</p>
        <div className="hero-actions">
          <a href={`${APP_URL}/signup`} className="btn btn-primary">
            Score a {sport.lower} match free
          </a>
          <a href="/pricing" className="btn btn-secondary">
            See pricing
          </a>
        </div>
      </section>

      <section aria-labelledby="template-heading" className="section section-tight">
        <p className="eyebrow">The template</p>
        <h2 id="template-heading" className="section-heading">
          Set up for {sport.lower} from the first tap
        </h2>
        <dl className="spec-list">
          <div>
            <dt>Match structure</dt>
            <dd>{sport.structure}</dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd>{sport.clock}</dd>
          </div>
          {sport.timeouts && (
            <div>
              <dt>Timeouts</dt>
              <dd>{sport.timeouts}</dd>
            </div>
          )}
        </dl>
      </section>

      <section aria-labelledby="controls-heading" className="section section-tight">
        <p className="eyebrow">On the control panel</p>
        <h2 id="controls-heading" className="section-heading">
          {sport.name} scoring controls
        </h2>
        <ul className="button-list">
          {sport.buttons.map(b => (
            <li key={b.label}>
              <span className="key">{b.label}</span>
              <span>{b.desc}</span>
            </li>
          ))}
        </ul>
        {sport.options?.map(option => (
          <div key={option.name} className="prose" style={{ marginTop: "1.5rem" }}>
            <h3>{option.name}</h3>
            <p>Chosen when you create the match:</p>
            <ul>
              {option.choices.map(choice => (
                <li key={choice}>{choice}</li>
              ))}
            </ul>
          </div>
        ))}
        <p className="section-lede" style={{ margin: "1.5rem 0 0" }}>
          Every action can be undone, and you can step back through your last 50.{" "}
          <a className="text-link" href={`${HELP_URL}/sports/${sport.slug}`}>
            Read the full {sport.lower} scoring guide
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="screens-heading" className="section section-tight">
        <h2 id="screens-heading" className="sr-only">
          Screenshots
        </h2>
        <ScreenshotRow shots={sport.slug === "cricket" ? [SHOTS.controlCricket, SHOTS.cricket] : [SHOTS.control, SHOTS.advanced]} />
      </section>

      <section aria-labelledby="detail-heading" className="section section-tight">
        <p className="eyebrow">In practice</p>
        <h2 id="detail-heading" className="section-heading">
          Scoring {sport.lower} with ScoreHub
        </h2>
        <div className="prose">
          {sport.sections.map(section => (
            <div key={section.heading}>
              <h3>{section.heading}</h3>
              <p>{section.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-heading" className="section section-tight">
        <p className="eyebrow">How it works</p>
        <h2 id="how-heading" className="section-heading">
          From sign-up to scoreboard in three steps
        </h2>
        <ol className="steps">
          <li>
            <strong>Create the match</strong>
            Choose {sport.name} in the setup wizard, name the two teams and select Start Match. The
            periods, clock and score buttons are already configured.
          </li>
          <li>
            <strong>Score from a browser</strong>
            Run the match from the control panel on a laptop or tablet
            {sport.dedicatedPanel ? "" : ", or the mobile panel on a phone"}. Nothing to install at
            the venue.
          </li>
          <li>
            <strong>Put it on screen</strong>
            Copy a display link from the Outputs tab and open it on a venue screen, or add it to
            your streaming software. Every display updates as you score.
          </li>
        </ol>
      </section>

      <section aria-labelledby="displays-heading" className="section section-tight">
        <p className="eyebrow">On screen</p>
        <h2 id="displays-heading" className="section-heading">
          Where the {sport.lower} score can go
        </h2>
        <div className="card-grid">
          <a className="card" href="/solutions/venues">
            <h3>Venue screens and projectors</h3>
            <p>
              Basic, advanced and fullscreen scoreboard displays for a TV, projector or capture
              card, in your team colours.
            </p>
          </a>
          <a className="card" href="/solutions/streaming">
            <h3>Live stream overlays</h3>
            <p>
              A transparent score bar or corner scorebug as a Browser Source in OBS, vMix or
              Wirecast.
            </p>
          </a>
          <a className="card" href="/solutions/tournaments">
            <h3>Many courts at once</h3>
            <p>
              Concurrent live matches and fixture upload for tournaments, leagues and multi-court
              venues.
            </p>
          </a>
        </div>
      </section>

      <Faq items={faqFor(sport)} />

      <section aria-labelledby="related-heading" className="section section-tight">
        <p className="eyebrow">More sports</p>
        <h2 id="related-heading" className="section-heading">
          Scoring something else too?
        </h2>
        <ul className="sport-grid">
          {related.map(r => (
            <li key={r.slug}>
              <a href={`/sports/${r.slug}`}>{r.name}</a>
            </li>
          ))}
          <li>
            <a href="/sports">All 21 sports</a>
          </li>
        </ul>
      </section>

      <CtaBand heading={`Ready to score your next ${sport.lower} match?`} />
    </main>
  );
}
