import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";

const stages = [
  [
    "1. Collect proposals",
    "Build and publish a CFP with custom and conditional fields. Submitters can save drafts when enabled; final submission creates a durable proposal and real confirmation delivery.",
  ],
  [
    "2. Review proposals",
    "Use the submission workspace to search, filter, save views, and act in bulk. Routing rules assign eligible reviewer pools by form, track, format, tag, or custom answer while respecting capacity and conflicts.",
  ],
  [
    "3. Make decisions",
    "Stage decision records the intended decision without communicating it. Preview real recipients and rendered content in Communications before choosing Send decision.",
  ],
  [
    "4. Prepare speakers",
    "Communicated acceptances activate connected speaker and session records. Invitations and onboarding tasks then prepare each speaker.",
  ],
  [
    "5. Approve content",
    "Content requests collect headshots, decks, and session material. Organizers review revisions and approve the content that can enter the public program.",
  ],
  [
    "6. Build the agenda",
    "An agenda placement assigns an approved session to a time and room. Organizers resolve conflicts and send separate participant-addressed calendar invitations.",
  ],
  [
    "7. Publish the program",
    "Publish agenda makes approved placements public across the agenda, session directory, speaker directory, speaker gallery, and itinerary.",
  ],
];

const help = [
  [
    "Control Room",
    "Start here. Blocking issues appear first, and every item opens the record or filtered workspace that resolves it.",
  ],
  [
    "Global search",
    "Press Command+K on macOS or Control+K elsewhere to find events, proposals, sessions, people, tasks, files, views, and communications.",
  ],
  [
    "Notifications",
    "The bell stores role-appropriate actions across browsers. Filters, preferences, read state, and record links are durable.",
  ],
  [
    "Failure recovery",
    "Failed messages, Queue jobs, webhooks, and Airtable sync appear with a reason and an explicit Retry delivery or Recover integration path.",
  ],
];

export function ProductGuide() {
  return (
    <div className="product-guide">
      <header>
        <a className="wordmark" href="/">
          <span className="mark" aria-hidden="true">
            PL
          </span>{" "}
          ProgramLoom
        </a>
        <nav aria-label="Product guide navigation">
          <a href="#workflow">Complete workflow</a>
          <a href="#roles">Roles</a>
          <a href="#help">Finding help</a>
          <a className="button button-small" href="/app">
            Open ProgramLoom
          </a>
        </nav>
      </header>
      <main id="main-content">
        <section className="guide-hero">
          <p className="kicker">Product guide</p>
          <h1>Run a complete event program without losing the thread.</h1>
          <p>
            ProgramLoom shows organizers exactly what is blocking their program,
            gives them the tools to resolve it, and carries every accepted
            proposal safely through communication, onboarding, scheduling,
            publication, and follow-up.
          </p>
          <a className="button button-large" href="#workflow">
            Understand the workflow <ArrowRight size={17} />
          </a>
        </section>
        <section id="workflow" className="guide-section">
          <p className="kicker">The complete lifecycle</p>
          <h2>One record, connected from proposal to publication.</h2>
          <div className="guide-stage-list">
            {stages.map(([title, body]) => (
              <article key={title}>
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section id="roles" className="guide-section guide-two-column">
          <div>
            <p className="kicker">Organizer</p>
            <h2>Begin in the Control Room.</h2>
            <p>
              Owners and admins receive the full operational view. Every count
              comes from persisted work and every item points to the action that
              clears it. Resolved work disappears after live or explicit
              refresh.
            </p>
          </div>
          <div>
            <p className="kicker">Reviewer, speaker, attendee</p>
            <h2>Land in the workspace meant for you.</h2>
            <p>
              Reviewers see assigned scoring work and blind-review boundaries.
              Speakers see their profile, tasks, files, resources, and feedback.
              Attendees use anonymous, responsive agenda and itinerary views.
            </p>
          </div>
        </section>
        <section id="help" className="guide-section">
          <p className="kicker">Finding your next action</p>
          <h2>Nothing essential depends on a hidden URL.</h2>
          <div className="guide-help-grid">
            {help.map(([title, body]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className="guide-next">
            <div>
              <h3>Need the complete reference?</h3>
              <p>
                The repository user guide documents every organizer, reviewer,
                speaker, attendee, integration, and developer workflow.
              </p>
            </div>
            <a className="button button-ghost" href="/help/">
              Browse the help center
            </a>
          </div>
        </section>
      </main>
      <footer>
        <a href="/">
          <ArrowLeft size={15} /> ProgramLoom home
        </a>
        <a href="/developers">Developer documentation</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </div>
  );
}
