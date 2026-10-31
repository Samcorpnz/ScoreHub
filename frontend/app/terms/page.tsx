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

export default function TermsPage() {
  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-base)" }}>
      <div className="max-w-2xl mx-auto py-12">
        <h1 className="text-2xl font-black tracking-tight">Terms of Use</h1>
        <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Last updated: {LAST_UPDATED}</p>

        <p className="text-sm mt-6" style={{ color: "var(--text-secondary)" }}>
          These Terms of Use govern access to and use of ScoreHub — the website, control panel,
          display pages, bridge software, and related services (the <strong>Service</strong>) —
          provided by <strong>Samcorp Limited</strong> (NZBN 9429051028626), 43 Grande Avenue,
          Mount Albert, Auckland, 1025, New Zealand (<strong>Samcorp</strong>, <strong>we</strong>,{" "}
          <strong>us</strong>). By creating an account or using the Service you agree to be bound
          by these Terms. If you act on behalf of an organisation, &ldquo;you&rdquo; includes that
          organisation.
        </p>

        <Section id="accounts" title="1. Accounts and organisations">
          <p>
            You are responsible for the accuracy of information provided when registering, for
            keeping your login credentials and any Scoped Tokens confidential, and for all
            activity under your account or organisation.
          </p>
        </Section>

        <Section id="viewers" title="2. Public display pages">
          <p>
            Display pages may be viewed by the public without an account, at the operator&apos;s
            discretion. Operators are responsible for what match data is made public.
          </p>
        </Section>

        <Section id="billing" title="3. Subscriptions, billing and Stripe">
          <p>
            Paid plans are billed in NZD, monthly or annually. Payments are processed entirely by{" "}
            <strong>Stripe, Inc.</strong> — we never receive or store your full card details.
            Subscriptions renew automatically unless cancelled before the renewal date; cancelling
            does not entitle you to a refund of amounts already paid for the current period unless
            required by law.
          </p>
          <p>
            Where you acquire the Service for business purposes, sections 9, 12A, and 13 of the
            Fair Trading Act 1986 do not apply, and to the extent permitted by law the Consumer
            Guarantees Act 1993 does not apply to that supply.
          </p>
        </Section>

        <Section id="acceptable-use" title="4. Acceptable use">
          <p>
            You must not misuse the Service — including unauthorised access, interfering with the
            relay, bridge, or display pages, reverse engineering, reselling the Service as your
            own, or uploading unlawful content. We may suspend access immediately for a breach of
            this section.
          </p>
        </Section>

        <Section id="content" title="5. Your content and match data">
          <p>
            You retain ownership of match data, team/player names, and scores you input, referred
            to as <strong>Your Content</strong>. You grant us a licence to host and display it to
            provide the Service. You are responsible for having the necessary rights and consents
            to input Your Content, including player names.
          </p>
        </Section>

        <Section id="accuracy" title="6. Accuracy of scores and data">
          <p>
            Scores and match state are entered by operators or fed from consoles/third-party data
            sources — not verified by Samcorp. We do not warrant their accuracy and are not
            responsible for decisions made in reliance on them, including for broadcast, wagering,
            or official results purposes.
          </p>
        </Section>

        <Section id="ip" title="7. Intellectual property">
          <p>
            The Service (excluding Your Content) is owned by Samcorp or its licensors. These Terms
            do not transfer any of that intellectual property to you.
          </p>
        </Section>

        <Section id="availability" title="8. Availability">
          <p>
            We aim to keep the Service available but do not guarantee uninterrupted or error-free
            operation. Operators of time-critical or safety-critical events should have a manual
            fallback.
          </p>
        </Section>

        <Section id="warranty" title="9. Disclaimer of warranties">
          <p>
            To the maximum extent permitted by law, the Service is provided &ldquo;as is&rdquo;
            and &ldquo;as available&rdquo;, without warranties of any kind, express or implied.
          </p>
        </Section>

        <Section id="liability" title="10. Limitation of liability">
          <p>
            Nothing here limits liability that cannot lawfully be limited, including for death or
            personal injury caused by negligence, or fraud. Subject to that, Samcorp&apos;s total
            aggregate liability arising out of the Service is limited to the fees you paid us in
            the 12 months preceding the claim, and we are not liable for indirect, consequential,
            or special damages, or loss of profits, revenue, data, or goodwill. For use without a
            paid plan, our aggregate liability is limited to NZ$100.
          </p>
        </Section>

        <Section id="termination" title="11. Suspension and termination">
          <p>
            You may cancel at any time. We may suspend or terminate access for breach of these
            Terms, as required by law, or on reasonable notice for convenience.
          </p>
        </Section>

        <Section id="law" title="12. Governing law">
          <p>These Terms are governed by the laws of New Zealand.</p>
        </Section>

        <Section id="changes" title="13. Changes to these terms">
          <p>
            We may update these Terms; the &ldquo;Last updated&rdquo; date reflects the latest
            version, and continued use after changes take effect constitutes acceptance.
          </p>
        </Section>

        <Section id="contact" title="14. Contact">
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
            <a href="/privacy" style={{ color: "var(--accent)" }}>Privacy Policy</a>.
          </p>
        </Section>
      </div>
    </div>
  );
}
