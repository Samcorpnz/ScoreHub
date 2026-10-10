import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SOLUTIONS, getSolution } from "../../solutions-data";
import { SPORTS } from "../../sports-data";
import { APP_URL, HELP_URL, pageMetadata } from "../../site";
import { Faq } from "../../components/Faq";
import { CtaBand } from "../../components/CtaBand";
import { GraphicsGallery } from "../../components/GraphicsGallery";
import { JsonLd, breadcrumbLd } from "../../components/JsonLd";
import { ScreenshotRow } from "../../components/Screenshot";

export const dynamicParams = false;

export function generateStaticParams() {
  return SOLUTIONS.map(s => ({ slug: s.slug }));
}

type Props = { readonly params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const solution = getSolution((await params).slug);
  if (!solution) return {};
  return pageMetadata({
    title: solution.title,
    description: solution.description,
    path: `/solutions/${solution.slug}`,
  });
}

export default async function SolutionPage({ params }: Props) {
  const solution = getSolution((await params).slug);
  if (!solution) notFound();

  const others = SOLUTIONS.filter(s => s.slug !== solution.slug);

  return (
    <main id="main-content">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: solution.name, path: `/solutions/${solution.slug}` },
        ])}
      />
      <section className="page-hero">
        <p className="breadcrumb">
          <a href="/">Home</a> / {solution.name}
        </p>
        <p className="eyebrow">{solution.eyebrow}</p>
        <h1>{solution.h1}</h1>
        <p className="lede">{solution.lede}</p>
        <div className="hero-actions">
          <a href={`${APP_URL}/signup`} className="btn btn-primary">
            Get Started
          </a>
          <a href="/pricing" className="btn btn-secondary">
            See pricing
          </a>
        </div>
      </section>

      <section aria-labelledby="screens-heading" className="section section-tight">
        <h2 id="screens-heading" className="sr-only">
          Screenshots
        </h2>
        <ScreenshotRow shots={solution.shots} />
      </section>

      {solution.sections.map((section, i) => (
        <section key={section.heading} aria-labelledby={`section-${i}`} className="section section-tight">
          <h2 id={`section-${i}`} className="section-heading">
            {section.heading}
          </h2>
          <div className="prose">
            {section.steps && (
              <ol>
                {section.steps.map(step => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {section.paragraphs.map(p => (
              <p key={p}>{p}</p>
            ))}
            {section.bullets && (
              <ul>
                {section.bullets.map(b => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {section.help && (
              <p>
                <a href={`${HELP_URL}${section.help.path}`}>{section.help.label} in the help centre</a>
              </p>
            )}
          </div>
        </section>
      ))}

      <section aria-labelledby="gallery-heading" className="section section-tight">
        <p className="eyebrow">On screen</p>
        <h2 id="gallery-heading" className="section-heading">
          The displays you can put up
        </h2>
        <GraphicsGallery />
      </section>

      <Faq items={solution.faq} />

      <section aria-labelledby="sports-heading" className="section section-tight">
        <p className="eyebrow">Sports</p>
        <h2 id="sports-heading" className="section-heading">
          Templates for 21 sports
        </h2>
        <ul className="sport-grid">
          {SPORTS.map(sport => (
            <li key={sport.slug}>
              <a href={`/sports/${sport.slug}`}>{sport.name}</a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="more-heading" className="section section-tight">
        <p className="eyebrow">Also built for</p>
        <h2 id="more-heading" className="section-heading">
          More ways to use ScoreHub
        </h2>
        <div className="card-grid">
          {others.map(other => (
            <a key={other.slug} className="card" href={`/solutions/${other.slug}`}>
              <p className="card-meta">{other.plan}</p>
              <h3>{other.name}</h3>
              <p>{other.summary}</p>
            </a>
          ))}
        </div>
      </section>

      <CtaBand heading={solution.cta} />
    </main>
  );
}
