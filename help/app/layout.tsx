import type { Metadata } from "next";
import { AskAssistant } from "./components/AskAssistant";
import { oswald } from "./fonts";
import "./globals.css";

const APP_URL = "https://app.scorehub.co.nz";
const SITE_URL = "https://scorehub.co.nz";
const HELP_URL = "https://help.scorehub.co.nz";

export const metadata: Metadata = {
  metadataBase: new URL(HELP_URL),
  title: {
    default: "ScoreHub Help Centre",
    template: "%s — ScoreHub Help Centre",
  },
  description:
    "Documentation for ScoreHub — setting up matches for every supported sport, connecting a scoring console, managing your account and team, and billing.",
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className={oswald.variable}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <nav aria-label="Primary" className="site-nav">
            <a href="/" className="wordmark" style={{ display: "flex", alignItems: "center" }}>
              Score<span style={{ color: "var(--accent)" }}>Hub</span>
              <span className="help-badge">Help</span>
            </a>
            <div className="nav-links">
              <a href={SITE_URL}>Website</a>
              <a href={`${APP_URL}/login`}>Log in</a>
              <a href={`${APP_URL}/signup`} className="nav-cta">
                Get Started
              </a>
            </div>
          </nav>
        </header>
        <main id="main-content">{children}</main>
        <AskAssistant />
        <footer className="site-footer">
          <a href="/">Help centre home</a>
          <span aria-hidden="true"> · </span>
          <a href={SITE_URL}>scorehub.co.nz</a>
          <span aria-hidden="true"> · </span>
          <a href="mailto:hello@scorehub.co.nz">hello@scorehub.co.nz</a>
        </footer>
      </body>
    </html>
  );
}
