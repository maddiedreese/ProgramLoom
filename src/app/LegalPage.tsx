import { Link } from "react-router-dom";

type LegalKind = "privacy" | "terms";

const updated = "August 9, 2026";

export function LegalPage({ kind }: { kind: LegalKind }) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Link className="wordmark" to="/" aria-label="ProgramLoom home">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          <span>ProgramLoom</span>
        </Link>
        <Link className="button button-ghost button-small" to="/register">
          Start free
        </Link>
      </header>
      <main id="main-content" className="legal-page">
        <p className="kicker">ProgramLoom policies</p>
        <h1>{kind === "privacy" ? "Privacy notice" : "Terms of service"}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        {kind === "privacy" ? <PrivacyNotice /> : <Terms />}
      </main>
      <footer className="legal-footer">
        <span>ProgramLoom is AGPL-3.0 open source.</span>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href="https://github.com/maddiedreese/SaaS">Source</a>
        </nav>
      </footer>
    </div>
  );
}

function PrivacyNotice() {
  return (
    <div className="legal-copy">
      <section>
        <h2>What ProgramLoom handles</h2>
        <p>
          We process the information people provide to operate event programs:
          account identity, workspace and event settings, proposals, reviews,
          speaker profiles and logistics, uploaded files, schedules, attendee
          itinerary choices stored on the attendee’s device, and support
          communications.
        </p>
        <p>
          We also record security and operational information such as request
          identifiers, timestamps, IP-derived abuse signals, audit events, and
          error logs. PostHog receives limited product events and page views;
          session recording and automatic interaction capture are disabled.
        </p>
      </section>
      <section>
        <h2>Why and where data is processed</h2>
        <p>
          We use this data to provide, secure, troubleshoot, and improve
          ProgramLoom; deliver transactional messages; and comply with valid
          legal obligations. Cloudflare hosts the application, database, files,
          queues, abuse protection, and operational logs. Resend delivers email.
          An organizer may choose Airtable as that workspace’s business-record
          source of truth. PostHog provides privacy-limited product analytics.
        </p>
      </section>
      <section>
        <h2>Sharing, sale, and access</h2>
        <p>
          We do not sell personal information or use proposal, review, speaker,
          or attendee data for advertising. Data is shared only with the
          organizer-authorized people who need it, the service providers above,
          or when legally required. Organizers control their workspace
          membership and public program content.
        </p>
      </section>
      <section>
        <h2>Retention and your choices</h2>
        <p>
          Workspace data remains while an organizer uses the service or needs it
          for the event record. Security logs and delivery records may remain
          for a limited period for integrity and troubleshooting. You can update
          available profile fields in the product. For access, correction,
          export, or deletion requests, contact the event organizer first or use
          the private contact method in our{" "}
          <a href="https://github.com/maddiedreese/SaaS/security/policy">
            security policy
          </a>
          .
        </p>
        <p>
          ProgramLoom uses an essential secure session cookie. Turnstile may set
          abuse-prevention data. Product analytics can be blocked through
          browser privacy controls; the service does not require advertising
          cookies.
        </p>
      </section>
      <section>
        <h2>Security, international use, and changes</h2>
        <p>
          We use encrypted transport, scoped authorization, expiring sessions
          and links, private object storage, audit history, and provider access
          controls. No system can guarantee absolute security. ProgramLoom and
          its providers may process data in the United States and other
          locations where they operate.
        </p>
        <p>
          This service is intended for professional event programs, not children
          under 16. Material changes will be posted here with a new effective
          date.
        </p>
      </section>
    </div>
  );
}

function Terms() {
  return (
    <div className="legal-copy">
      <section>
        <h2>Using the service</h2>
        <p>
          You must be able to enter a binding agreement and provide accurate
          account information. Organizers are responsible for their events,
          notices to participants, team access, and the lawful collection and
          use of program data. Keep access links and authenticated sessions
          private and promptly remove people who no longer need access.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          You retain ownership of content you submit. You grant ProgramLoom the
          limited permission needed to host, process, reproduce, transmit, and
          display it as directed by you or the event organizer. You must have
          the rights and permissions required for uploads, messages, embeds, and
          public program material.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not misuse the service, access another workspace without
          permission, bypass security or usage controls, upload malicious or
          unlawful material, send unsolicited communications, interfere with
          availability, scrape private data, or use ProgramLoom to violate
          another person’s rights. We may restrict abusive activity or access
          necessary to protect the service and its users.
        </p>
      </section>
      <section>
        <h2>Free service and open-source software</h2>
        <p>
          The hosted product is currently offered without a subscription charge
          or service-level commitment. We will seek approval before enabling a
          paid resource for a user in a managed deployment. The source code is
          separately available under AGPL-3.0; that software license governs
          copying, modification, and distribution of the code, while these terms
          govern use of the hosted service.
        </p>
      </section>
      <section>
        <h2>Availability, termination, and disclaimers</h2>
        <p>
          Features may change, and maintenance or provider failures can
          interrupt service. You may stop using ProgramLoom at any time. We may
          suspend access for material violations, security risk, or legal
          necessity. The service is provided “as is” and “as available” to the
          extent permitted by law, without implied warranties or liability for
          indirect, incidental, special, consequential, or lost-profit damages.
        </p>
      </section>
      <section>
        <h2>Questions and changes</h2>
        <p>
          Material changes will be posted on this page with a new effective
          date. Questions or private security reports can be submitted through
          the contact method in the project’s{" "}
          <a href="https://github.com/maddiedreese/SaaS/security/policy">
            security policy
          </a>
          .
        </p>
      </section>
    </div>
  );
}
