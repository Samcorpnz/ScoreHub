import { APP_URL } from "../site";

export function CtaBand({ heading }: { readonly heading: string }) {
  return (
    <section className="cta-band" aria-labelledby="cta-heading">
      <h2
        id="cta-heading"
        style={{ fontSize: "clamp(1.6rem, 4vw, 2.4rem)", fontWeight: 600, textTransform: "uppercase", margin: "0 0 1rem" }}
      >
        {heading}
      </h2>
      <p style={{ margin: "0 0 1.75rem", color: "var(--text-secondary)", fontSize: "1rem" }}>
        Free to try — one live match, no card required.
      </p>
      <a href={`${APP_URL}/signup`} className="btn btn-primary">
        Get Started
      </a>
    </section>
  );
}
