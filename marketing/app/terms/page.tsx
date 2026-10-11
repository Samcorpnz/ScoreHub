import type { Metadata } from "next";

const SITE_URL = "https://scorehub.co.nz";
const LAST_UPDATED = "15 August 2026";

export const metadata: Metadata = {
  title: "Terms of Use — ScoreHub",
  description:
    "Terms of Use governing access to and use of ScoreHub, provided by Samcorp Limited.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return (
    <main id="main-content">
      <div className="legal">
        <h1>Terms of Use</h1>
        <p className="legal-updated">Last updated: {LAST_UPDATED}</p>

        <div className="legal-callout">
          <p>
            This is a plain-language summary, not a substitute for the full terms below: ScoreHub
            is provided &ldquo;as is&rdquo; for live sport scoring and display; you&apos;re
            responsible for the accuracy of scores entered by your operators; and our liability to
            you is capped and excludes indirect losses, to the maximum extent New Zealand law
            allows. Read the full terms for the details that actually govern your use of the
            Service.
          </p>
        </div>

        <div className="legal-toc">
          <p>Contents</p>
          <ol>
            <li>
              <a href="#acceptance">Acceptance of these terms</a>
            </li>
            <li>
              <a href="#service">The Service</a>
            </li>
            <li>
              <a href="#accounts">Accounts and organisations</a>
            </li>
            <li>
              <a href="#viewers">Public display pages and viewers</a>
            </li>
            <li>
              <a href="#billing">Subscriptions, billing and Stripe</a>
            </li>
            <li>
              <a href="#acceptable-use">Acceptable use</a>
            </li>
            <li>
              <a href="#content">Your content and match data</a>
            </li>
            <li>
              <a href="#accuracy">Accuracy of scores and data</a>
            </li>
            <li>
              <a href="#ip">Intellectual property</a>
            </li>
            <li>
              <a href="#third-party">Third-party services</a>
            </li>
            <li>
              <a href="#availability">Availability and support</a>
            </li>
            <li>
              <a href="#warranty">Disclaimer of warranties</a>
            </li>
            <li>
              <a href="#liability">Limitation of liability</a>
            </li>
            <li>
              <a href="#indemnity">Indemnity</a>
            </li>
            <li>
              <a href="#termination">Suspension and termination</a>
            </li>
            <li>
              <a href="#law">Governing law</a>
            </li>
            <li>
              <a href="#changes">Changes to these terms</a>
            </li>
            <li>
              <a href="#contact">Contact</a>
            </li>
          </ol>
        </div>

        <h2 id="acceptance">1. Acceptance of these terms</h2>
        <p>
          These Terms of Use (<strong>Terms</strong>) govern access to and use of ScoreHub — the
          website, control panel, display pages, bridge software, and related services (the{" "}
          <strong>Service</strong>) — provided by <strong>Samcorp Limited</strong>, a company
          incorporated in New Zealand (<strong>Samcorp</strong>, <strong>we</strong>,{" "}
          <strong>us</strong>, or <strong>our</strong>).
        </p>
        <p>
          By creating an account, accessing the control panel, running the bridge software, or
          viewing a ScoreHub display page, you agree to be bound by these Terms. If you are
          entering into these Terms on behalf of an organisation (a club, venue, National Sporting
          Organisation, or other entity), you confirm you have authority to bind that organisation,
          and &ldquo;you&rdquo; refers to that organisation as well as the individual user.
        </p>
        <p>If you do not agree to these Terms, do not use the Service.</p>

        <h2 id="service">2. The Service</h2>
        <p>
          ScoreHub lets an operator score a live sporting match from a control panel and pushes
          that live match state to display pages, broadcast overlays, and other viewers. The
          Service may draw match data from manual entry, a connected scoring console (via the
          bridge software), or a supported third-party data feed.
        </p>
        <p>
          We may add, change, or remove features, and may release new versions of the bridge
          software, at any time. We are not obliged to maintain compatibility with any particular
          console, browser, or device indefinitely.
        </p>

        <h2 id="accounts">3. Accounts and organisations</h2>
        <p>
          To use the control panel you must register an account and, in most cases, belong to an
          organisation within our multi-tenant account structure. You are responsible for:
        </p>
        <ul>
          <li>the accuracy of information you provide when registering;</li>
          <li>
            maintaining the confidentiality of your login credentials and any Scoped Tokens issued
            to your organisation (for bridge or Control API access);
          </li>
          <li>all activity that occurs under your account or your organisation&apos;s tokens; and</li>
          <li>
            promptly notifying us at{" "}
            <a href="mailto:hello@scorehub.co.nz">hello@scorehub.co.nz</a> of any unauthorised
            use.
          </li>
        </ul>
        <p>
          Administrators within an organisation may invite, remove, or change the role of other
          members of that organisation. We are not responsible for disputes between members of the
          same organisation over account access or control.
        </p>

        <h2 id="viewers">4. Public display pages and viewers</h2>
        <p>
          Display pages (<span className="mono">/display/*</span>) may be viewed by members of the
          public without an account, at the discretion of the operator who shares the link. If you
          view a display page without an account, these Terms apply to you to the extent relevant
          — in particular the disclaimers in sections 8, 12, and 13 — but you have no account,
          make no payment, and are not bound by section 5.
        </p>
        <p>
          Operators are responsible for deciding what match data is displayed publicly and to
          whom. We do not vet, endorse, or take responsibility for the content of any specific
          match, competition, or organisation using the Service.
        </p>

        <h2 id="billing">5. Subscriptions, billing and Stripe</h2>
        <p>
          Paid plans (currently ScoreHub Pro, ScoreHub Venue, and add-ons such as ScoreHub
          Graphics) are billed in New Zealand dollars, monthly or annually, as described at
          checkout. Prices may change on notice; changes take effect at your next renewal.
        </p>
        <p>
          All payments are processed by <strong>Stripe, Inc.</strong>. We do not receive or store
          your full card details — they are handled entirely by Stripe under Stripe&apos;s own
          terms and privacy policy. By subscribing you also agree to Stripe&apos;s terms of
          service applicable to purchases you make through our checkout.
        </p>
        <p>
          Subscriptions renew automatically at the end of each billing period unless cancelled
          before the renewal date. Cancelling stops future renewals but, unless we say otherwise
          or the law requires it, does not entitle you to a refund of amounts already paid for the
          current billing period. Free-tier limits (such as the one-concurrent-live-match limit)
          apply as described in the product at the time.
        </p>
        <p>
          Where you acquire the Service for the purposes of a business (which includes any
          organisation, club, venue, or NSO account), you agree that sections 9, 12A, and 13 of
          the Fair Trading Act 1986 do not apply to that supply, and, to the extent it would
          otherwise apply and to the maximum extent permitted by law, the Consumer Guarantees Act
          1993 does not apply to that supply. Nothing in this section excludes rights that cannot
          lawfully be excluded.
        </p>

        <h2 id="acceptable-use">6. Acceptable use</h2>
        <p>You must not, and must not permit others to:</p>
        <ul>
          <li>use the Service for any unlawful purpose or in breach of any applicable law;</li>
          <li>
            attempt to gain unauthorised access to the Service, other organisations&apos; data, or
            underlying infrastructure;
          </li>
          <li>
            interfere with, overload, or disrupt the Service (including the relay, bridge, or
            display pages) or any connected console or feed;
          </li>
          <li>
            reverse engineer, decompile, or attempt to extract source code from the Service, except
            to the extent applicable law prevents this restriction;
          </li>
          <li>
            resell, sublicense, or provide the Service to third parties as your own product without
            our prior written consent; or
          </li>
          <li>
            upload or transmit content through the Service that is defamatory, infringing, or
            otherwise unlawful.
          </li>
        </ul>
        <p>
          We may suspend access immediately, without notice, where we reasonably believe this
          section has been breached.
        </p>

        <h2 id="content">7. Your content and match data</h2>
        <p>
          You retain ownership of the match data, team and player names, scores, and other content
          you or your organisation input into the Service (<strong>Your Content</strong>). You
          grant us a licence to host, process, transmit, and display Your Content solely to
          provide the Service to you (and, where you choose to make it public, to viewers of your
          display pages).
        </p>
        <p>
          You are responsible for ensuring you have the necessary rights and consents to input
          Your Content, including any player or participant names entered into the Service, and
          for complying with any applicable privacy or data protection law when doing so.
        </p>

        <h2 id="accuracy">8. Accuracy of scores and data</h2>
        <p>
          Match state, scores, and timing shown by the Service are entered or fed in by operators,
          scoring consoles, or third-party data providers — not verified by Samcorp. The Service is
          a display and distribution tool, not an official scoring or timekeeping authority.
        </p>
        <p>
          We do not warrant the accuracy, completeness, or timeliness of any score, match state, or
          related data, and we are not responsible for decisions made in reliance on it — including
          for broadcast, wagering, results reporting, or competition record purposes. Where
          official results are required, they should be independently verified against the
          governing competition&apos;s own records.
        </p>

        <h2 id="ip">9. Intellectual property</h2>
        <p>
          The Service, including its software, design, graphics templates, and branding
          (excluding Your Content), is owned by Samcorp or its licensors and protected by
          intellectual property laws. Nothing in these Terms transfers any of that intellectual
          property to you. You may not use Samcorp&apos;s or ScoreHub&apos;s name, logo, or
          branding without our prior written consent, except as reasonably necessary to identify
          the source of a display page or overlay you operate.
        </p>

        <h2 id="third-party">10. Third-party services</h2>
        <p>
          The Service relies on third-party infrastructure and service providers, including but
          not limited to Fly.io (hosting), Vercel (hosting), Neon (database), Upstash (caching),
          and Stripe (payments). Availability of the Service depends on the availability of these
          providers, and we are not liable for outages, data loss, or other issues caused by a
          third-party provider outside our reasonable control.
        </p>

        <h2 id="availability">11. Availability and support</h2>
        <p>
          We aim to keep the Service available but do not guarantee uninterrupted or error-free
          operation. We may perform maintenance, and the Service may be unavailable from time to
          time. Live-event operators should have a manual fallback (e.g. a manual scoreboard or
          console-direct display) for matches where continuous availability is critical, as we do
          not guarantee real-time delivery for time-critical or safety-critical use.
        </p>

        <h2 id="warranty">12. Disclaimer of warranties</h2>
        <p>
          To the maximum extent permitted by law, the Service is provided{" "}
          <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>, without warranties
          of any kind, whether express, implied, or statutory, including any implied warranties of
          merchantability, fitness for a particular purpose, non-infringement, or that the Service
          will be uninterrupted, secure, or error-free. Section 5 addresses the extent to which
          statutory guarantees are excluded for business customers.
        </p>

        <h2 id="liability">13. Limitation of liability</h2>
        <p>
          Nothing in these Terms limits or excludes liability that cannot lawfully be limited or
          excluded, including liability for death or personal injury caused by negligence, or for
          fraud or fraudulent misrepresentation.
        </p>
        <p>Subject to that, to the maximum extent permitted by law:</p>
        <ul>
          <li>
            Samcorp&apos;s total aggregate liability to you arising out of or in connection with
            the Service, whether in contract, tort (including negligence), or otherwise, is
            limited to the total fees actually paid by you to Samcorp for the Service in the twelve
            (12) months immediately preceding the event giving rise to the claim; and
          </li>
          <li>
            Samcorp is not liable for any indirect, incidental, special, consequential, or
            punitive damages, or for any loss of profits, revenue, data, goodwill, or business
            opportunity, even if we have been advised of the possibility of such loss, and even if
            a remedy fails of its essential purpose.
          </li>
        </ul>
        <p>
          If you use the Service without a paid plan (including as an anonymous display viewer),
          our aggregate liability to you is limited to NZ$100.
        </p>
        <p>
          These limitations apply regardless of the number of claims and are a fundamental basis of
          the bargain between you and Samcorp in providing the Service at its current price.
        </p>

        <h2 id="indemnity">14. Indemnity</h2>
        <p>
          You agree to indemnify and hold Samcorp harmless from any claims, losses, liabilities,
          and expenses (including reasonable legal fees) arising out of Your Content, your breach
          of these Terms, or your misuse of the Service, except to the extent caused by
          Samcorp&apos;s own breach of these Terms or negligence.
        </p>

        <h2 id="termination">15. Suspension and termination</h2>
        <p>
          You may stop using the Service and cancel your subscription at any time through account
          settings or by contacting us. We may suspend or terminate your access if you breach these
          Terms, if required by law, or where reasonably necessary to protect the Service or other
          users, and may terminate for convenience on reasonable notice. On termination, your right
          to access the Service ends; sections that by their nature should survive (including
          sections 9, 12, 13, 14, and 16) continue to apply.
        </p>

        <h2 id="law">16. Governing law</h2>
        <p>
          These Terms are governed by the laws of New Zealand, and you submit to the non-exclusive
          jurisdiction of the courts of New Zealand.
        </p>

        <h2 id="changes">17. Changes to these terms</h2>
        <p>
          We may update these Terms from time to time. We will update the &ldquo;Last
          updated&rdquo; date above, and for material changes we will make reasonable efforts to
          notify account holders (such as by email or in-app notice). Continued use of the Service
          after changes take effect constitutes acceptance of the updated Terms.
        </p>

        <h2 id="contact">18. Contact</h2>
        <p>
          Samcorp Limited (NZBN 9429051028626)
          <br />
          43 Grande Avenue, Mount Albert, Auckland, 1025, New Zealand
          <br />
          Email: <a href="mailto:hello@scorehub.co.nz">hello@scorehub.co.nz</a>
        </p>
        <p>
          See also our <a href="/privacy">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}
