const LAST_UPDATED = "16 August 2026";

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section id={id} className="pt-8 mt-8" style={{ borderTop: "1px solid var(--border)" }}>
      <h2 className="text-lg font-black tracking-tight mb-3">{title}</h2>
      <div className="space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-base)" }}>
      <div className="max-w-2xl mx-auto py-12">
        <h1 className="text-2xl font-black tracking-tight">Privacy Policy</h1>
        <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Last updated: {LAST_UPDATED}</p>

        <p className="text-sm mt-6" style={{ color: "var(--text-secondary)" }}>
          <strong>Samcorp Limited</strong> (NZBN 9429051028626), 43 Grande Avenue, Mount Albert,
          Auckland, 1025, New Zealand, respects your privacy. This policy explains what personal
          information ScoreHub collects, why, who we share it with, and your rights under the
          Privacy Act 2020.
        </p>

        <Section id="collect" title="1. Information we collect">
          <p>
            Account and contact information (name, email, role, organisation details); billing
            status and transaction references from Stripe (we never receive full card numbers);
            live match/scoring data, which may include team and player names entered by an
            operator; and technical/usage information (IP address, browser, device, pages viewed).
          </p>
        </Section>

        <Section id="use" title="2. How we use it">
          <p>
            To provide and operate the Service, process subscriptions, communicate with you,
            provide support, monitor and secure the Service, comply with legal obligations, and,
            with consent, send marketing communications.
          </p>
        </Section>

        <Section id="sharing" title="3. Who we share it with">
          <p>
            Stripe (payments); Fly.io and Vercel (application hosting); Neon (database hosting);
            Upstash (caching); other members of your organisation, to the extent your role
            requires it; and law enforcement or regulators where required by law. We do not sell
            personal information.
          </p>
        </Section>

        <Section id="cross-border" title="4. Overseas storage">
          <p>
            Some providers above store or process data outside New Zealand. We take reasonable
            steps to ensure overseas disclosures are subject to protections comparable to the
            Privacy Act 2020.
          </p>
        </Section>

        <Section id="security" title="5. Security">
          <p>
            We use encrypted transport (TLS), hashed storage of long-lived tokens, and role-based
            access control. No method of transmission or storage is completely secure.
          </p>
        </Section>

        <Section id="retention" title="6. Retention">
          <p>
            We retain personal information for as long as your account is active, and afterwards
            as reasonably necessary for legal, accounting, or reporting obligations.
          </p>
        </Section>

        <Section id="rights" title="7. Your rights">
          <p>
            Under the Privacy Act 2020 you may request access to, or correction of, personal
            information we hold about you by contacting us below. If you&apos;re not satisfied
            with our response, you may complain to the New Zealand Office of the Privacy
            Commissioner (privacy.org.nz).
          </p>
        </Section>

        <Section id="players" title="8. Player and team names">
          <p>
            Operators may enter player or team names for display purposes; this is controlled by
            the operator&apos;s organisation, not Samcorp. If you want a display corrected or
            removed, contact the operator running that match in the first instance.
          </p>
        </Section>

        <Section id="changes" title="9. Changes to this policy">
          <p>
            We may update this policy from time to time; the &ldquo;Last updated&rdquo; date
            reflects the latest version.
          </p>
        </Section>

        <Section id="contact" title="10. Contact and complaints">
          <p>
            Samcorp Limited (NZBN 9429051028626), 43 Grande Avenue, Mount Albert, Auckland, 1025,
            New Zealand.
            <br />
            Email:{" "}
            <a href="mailto:hello@scorehub.co.nz" style={{ color: "var(--accent)" }}>
              hello@scorehub.co.nz
            </a>
          </p>
          <p>
            See also our{" "}
            <a href="/terms" style={{ color: "var(--accent)" }}>Terms of Use</a>.
          </p>
        </Section>
      </div>
    </div>
  );
}
