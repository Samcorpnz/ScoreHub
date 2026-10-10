import type { Metadata } from "next";
import { oswald } from "./fonts";
import { APP_URL, HELP_URL, OG_IMAGE, SITE_URL } from "./site";
import { SPORTS } from "./sports-data";
import { SOLUTIONS } from "./solutions-data";
import { JsonLd } from "./components/JsonLd";
import "./globals.css";

const TITLE = "Online Scoreboard & Live Sport Scoring App — ScoreHub";
const DESCRIPTION =
  "ScoreHub is a browser-based live scoring app — score any match from a laptop, tablet, or phone and push one live match state to venue screens, broadcast overlays, and the crowd's phones. No hardware required.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "live scoring software",
    "scoreboard app",
    "sports scoring app",
    "browser based scoring",
    "streaming scorebug overlay",
    "netball scoring software",
    "tournament scoring software",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "ScoreHub",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_NZ",
    images: [{ ...OG_IMAGE, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ScoreHub",
  legalName: "Samcorp Limited",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
  email: "hello@scorehub.co.nz",
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className={oswald.variable}>
      <body>
        <JsonLd data={organization} />
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <nav aria-label="Primary" className="site-nav">
            <a href="/" className="wordmark">
              Score<span style={{ color: "var(--accent)" }}>Hub</span>
            </a>
            <div className="nav-links">
              <a href="/sports">Sports</a>
              <a href="/solutions/venues">Venues</a>
              <a href="/solutions/tournaments">Tournaments</a>
              <a href="/solutions/streaming">Streaming</a>
              <a href="/pricing">Pricing</a>
            </div>
            <div className="nav-group">
              <a href={`${APP_URL}/login`} className="nav-login">
                Log in
              </a>
              <a href={`${APP_URL}/signup`} className="nav-cta">
                Get Started
              </a>
            </div>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <nav aria-label="Footer" className="footer-grid">
            <div>
              <h2>Product</h2>
              <ul>
                <li>
                  <a href="/pricing">Pricing</a>
                </li>
                {SOLUTIONS.map(s => (
                  <li key={s.slug}>
                    <a href={`/solutions/${s.slug}`}>{s.name}</a>
                  </li>
                ))}
                <li>
                  <a href="/#contact">Request a walkthrough</a>
                </li>
              </ul>
            </div>
            <div className="footer-sports">
              <h2>
                <a href="/sports">Sports</a>
              </h2>
              <ul>
                {SPORTS.map(s => (
                  <li key={s.slug}>
                    <a href={`/sports/${s.slug}`}>{s.name}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Support</h2>
              <ul>
                <li>
                  <a href={HELP_URL}>Help Centre</a>
                </li>
                <li>
                  <a href={`${HELP_URL}/getting-started`}>Getting started</a>
                </li>
                <li>
                  <a href={`${APP_URL}/login`}>Log in</a>
                </li>
                <li>
                  <a href="mailto:hello@scorehub.co.nz">hello@scorehub.co.nz</a>
                </li>
              </ul>
            </div>
          </nav>
          <a href="/terms">Terms of Use</a>
          <span aria-hidden="true"> · </span>
          <a href="/privacy">Privacy Policy</a>
        </footer>
      </body>
    </html>
  );
}
