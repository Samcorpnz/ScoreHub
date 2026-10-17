import { JsonLd } from "./JsonLd";

export interface FaqItem {
  q: string;
  a: string;
}

// Answers are plain text so the same string feeds the page and the FAQPage
// structured data.
export function Faq({ items, headingId = "faq-heading" }: { readonly items: readonly FaqItem[]; readonly headingId?: string }) {
  return (
    <section aria-labelledby={headingId} className="section section-tight">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map(item => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }}
      />
      <p className="eyebrow">FAQ</p>
      <h2 id={headingId} className="section-heading">
        Common questions
      </h2>
      <dl className="faq">
        {items.map(item => (
          <div key={item.q} className="faq-item">
            <dt>{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
