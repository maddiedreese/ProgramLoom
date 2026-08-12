import { Turnstile } from "@marsidev/react-turnstile";
import {
  ArrowRight,
  CalendarRange,
  Check,
  ClipboardCheck,
  FileCheck2,
  GalleryVerticalEnd,
  MessageSquareText,
  Sparkles,
  UsersRound,
} from "lucide-react";
import {
  type ComponentType,
  type FormEvent,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";

function lazyNamed<T, K extends keyof T>(load: () => Promise<T>, name: K) {
  return lazy(async () => ({
    // Each imported module retains its own runtime prop validation; this
    // adapter only converts a named React export into React.lazy's default.
    default: (await load())[name] as ComponentType<any>,
  }));
}

const Dashboard = lazyNamed(() => import("./app/Dashboard"), "Dashboard");
const InvitePage = lazyNamed(() => import("./app/InvitePage"), "InvitePage");
const TeamPage = lazyNamed(() => import("./app/TeamPage"), "TeamPage");
const EventWorkspace = lazyNamed(
  () => import("./app/EventWorkspace"),
  "EventWorkspace",
);
const PublicCfpPage = lazyNamed(
  () => import("./app/PublicCfpPage"),
  "PublicCfpPage",
);
const PublicCfpDirectory = lazyNamed(
  () => import("./app/PublicCfpDirectory"),
  "PublicCfpDirectory",
);
const EventSubmissions = lazyNamed(
  () => import("./app/EventSubmissions"),
  "EventSubmissions",
);
const EventReviews = lazyNamed(
  () => import("./app/EventReviews"),
  "EventReviews",
);
const EventAgenda = lazyNamed(() => import("./app/EventAgenda"), "EventAgenda");
const EventWidgets = lazyNamed(
  () => import("./app/EventWidgets"),
  "EventWidgets",
);
const EventCommunications = lazyNamed(
  () => import("./app/EventCommunications"),
  "EventCommunications",
);
const CommandPalette = lazyNamed(
  () => import("./app/CommandPalette"),
  "CommandPalette",
);
const NotificationCenter = lazyNamed(
  () => import("./app/NotificationCenter"),
  "NotificationCenter",
);
const PublicWidgetPage = lazyNamed(
  () => import("./app/PublicWidgetPage"),
  "PublicWidgetPage",
);
const CRMPage = lazyNamed(() => import("./app/CRMPage"), "CRMPage");
const EventContent = lazyNamed(
  () => import("./app/EventContent"),
  "EventContent",
);
const EventCalendar = lazyNamed(
  () => import("./app/EventCalendar"),
  "EventCalendar",
);
const EventControlRoom = lazyNamed(
  () => import("./app/EventControlRoom"),
  "EventControlRoom",
);
const SubmissionEditActionPage = lazyNamed(
  () => import("./app/SubmissionEditActionPage"),
  "SubmissionEditActionPage",
);
const EventSpeakers = lazyNamed(
  () => import("./app/EventSpeakers"),
  "EventSpeakers",
);
const PublicInterestPage = lazyNamed(
  () => import("./app/PublicInterestPage"),
  "PublicInterestPage",
);
const LegalPage = lazyNamed(() => import("./app/LegalPage"), "LegalPage");
const DeveloperSettings = lazyNamed(
  () => import("./app/DeveloperSettings"),
  "DeveloperSettings",
);
const DeveloperDocs = lazyNamed(
  () => import("./app/DeveloperDocs"),
  "DeveloperDocs",
);
const OAuthAuthorize = lazyNamed(
  () => import("./app/OAuthAuthorize"),
  "OAuthAuthorize",
);
const ProductGuide = lazyNamed(
  () => import("./app/ProductGuide"),
  "ProductGuide",
);

function LoadingRoute({ label }: { label: string }) {
  return (
    <main className="loading-page" aria-busy="true">
      {label}
    </main>
  );
}

function EscapeDismissController() {
  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const layers = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"], .detail-backdrop, .modal-backdrop, .crm-modal-backdrop',
        ),
      ].filter((layer) => layer.getClientRects().length > 0);
      const layer = layers.at(-1);
      const close = layer?.querySelector<HTMLButtonElement>(
        'button[aria-label="Close"], button[aria-label^="Close "], button[data-dismiss]',
      );
      if (!close) return;
      event.preventDefault();
      close.click();
    }
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, []);
  return null;
}

const capabilities = [
  {
    icon: GalleryVerticalEnd,
    title: "Collect session ideas",
    body: "Publish a clear call for proposals, ask the questions your event needs, and keep every submission easy to find.",
  },
  {
    icon: ClipboardCheck,
    title: "Review them fairly",
    body: "Send proposals to the right reviewers, collect consistent scorecards, and see exactly which reviews are unfinished.",
  },
  {
    icon: MessageSquareText,
    title: "Choose, then communicate",
    body: "Record decisions without sending them. Preview the people and message separately before any email leaves ProgramLoom.",
  },
  {
    icon: UsersRound,
    title: "Prepare every speaker",
    body: "Give speakers one private place for their profile, headshot, tasks, files, session details, and organizer feedback.",
  },
  {
    icon: FileCheck2,
    title: "Approve what will be public",
    body: "Collect real file versions and final session wording, request changes, and keep unfinished content off attendee pages.",
  },
  {
    icon: CalendarRange,
    title: "Schedule and publish",
    body: "Resolve room and speaker conflicts, keep calendar invitations current, and publish a schedule attendees can actually use.",
  },
];

function Wordmark() {
  return (
    <span className="wordmark">
      <span aria-hidden="true" className="mark">
        PL
      </span>
      ProgramLoom
    </span>
  );
}

function applicationHref(path: string) {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? path
    : `https://app.programloom.com${path}`;
}

function NotFoundPage() {
  return (
    <div className="public-state-shell">
      <main className="public-state-card" id="main-content">
        <Link to="/" className="brand" aria-label="ProgramLoom home">
          <Wordmark />
        </Link>
        <p className="kicker">Page not found</p>
        <h1>This ProgramLoom page does not exist.</h1>
        <p>
          The link may be out of date, or the page may have moved. Return to
          your workspace, browse public calls for proposals, or open the help
          center.
        </p>
        <div className="hero-actions">
          <a className="button" href={applicationHref("/app")}>
            Return to workspace
          </a>
          <a className="button button-ghost" href={applicationHref("/cfp")}>
            Browse CFPs
          </a>
          <a className="text-link" href="/help/">
            Open help center
          </a>
        </div>
      </main>
    </div>
  );
}

function MarketingPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="ProgramLoom home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary navigation">
          <a href="#product">How it works</a>
          <a href="#principles">Why ProgramLoom</a>
          <a
            className="button button-small button-ghost site-help"
            href="/help/"
          >
            Help
          </a>
          <a href={applicationHref("/cfp")}>Browse CFPs</a>
          <a
            className="button button-small button-ghost site-sign-in"
            href={applicationHref("/login")}
          >
            Sign in
          </a>
          <a
            className="button button-small"
            href={applicationHref("/register")}
          >
            Start free
          </a>
        </nav>
      </header>
      <main id="main-content">
        <section className="hero">
          <div className="eyebrow">
            <Sparkles size={15} /> Speaker programs, without the spreadsheet
            maze
          </div>
          <h1>Turn session ideas into a schedule people can trust.</h1>
          <p className="hero-copy">
            ProgramLoom gives event teams one understandable place to collect
            proposals, coordinate reviews, notify submitters, prepare speakers,
            build the schedule, and publish it for attendees.
          </p>
          <div className="hero-actions">
            <a
              className="button button-large"
              href={applicationHref("/register")}
            >
              Create your event <ArrowRight size={18} />
            </a>
            <a className="text-link" href="#walkthrough">
              See how ProgramLoom works
            </a>
            <a className="text-link" href="/help/">
              Read the help center
            </a>
          </div>
          <div className="proof-row" aria-label="What ProgramLoom provides">
            <span>
              <Check size={16} /> One connected workflow
            </span>
            <span>
              <Check size={16} /> Clear next actions
            </span>
            <span>
              <Check size={16} /> Free and open source
            </span>
          </div>
        </section>
        <section
          id="walkthrough"
          className="product-preview"
          aria-labelledby="product-preview-title"
        >
          <div className="product-preview-copy">
            <p className="kicker">Your event home base</p>
            <h2 id="product-preview-title">
              Know what is ready—and what needs attention next.
            </h2>
            <p>
              The Control Room turns the current state of your event into a
              practical to-do list. Select an item to open the proposal,
              speaker, file, message, or schedule change that needs attention.
              Finish the work and the blocker clears.
            </p>
            <p className="decision-distinction">
              <strong>Choosing an outcome does not send an email.</strong> You
              first stage the decision, then review the recipients and message
              in Communications before choosing Send decision.
            </p>
            <a className="button button-large" href="/help/getting-started">
              Learn how to create an event <ArrowRight size={18} />
            </a>
          </div>
          <figure>
            <img
              src="/programloom-control-room.jpg"
              alt="ProgramLoom Organizer Control Room showing live blockers and prioritized work"
              loading="eager"
            />
            <figcaption>
              The Control Room groups the event's saved work by importance and
              gives every item a clear next action.
            </figcaption>
          </figure>
        </section>
        <section
          id="product"
          className="capabilities"
          aria-labelledby="capabilities-title"
        >
          <div className="section-heading">
            <p className="kicker">From open call to show day</p>
            <h2 id="capabilities-title">
              One place for the work that normally gets scattered everywhere.
            </h2>
          </div>
          <div className="card-grid">
            {capabilities.map(({ icon: Icon, title, body }, index) => (
              <article className="capability-card" key={title}>
                <div className="card-number">0{index + 1}</div>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="principles" className="manifesto">
          <p className="kicker">Built for real organizing teams</p>
          <blockquote>
            “Everyone should be able to see what changed, what is ready, and
            what happens next.”
          </blockquote>
          <p>
            Organizers get a complete event view. Reviewers see only their
            assigned proposals. Speakers get a focused portal. Attendees get a
            clear public schedule—without needing to understand the tools behind
            it.
          </p>
          <a className="button button-large" href="/help/">
            Explore the help center <ArrowRight size={18} />
          </a>
        </section>
      </main>
      <footer>
        <Wordmark />
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href="/help/">Help center</a>
          <a href="https://github.com/maddiedreese/SaaS">Source</a>
        </nav>
      </footer>
    </div>
  );
}

function EntryPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [sessionState, setSessionState] = useState<
    "loading" | "anonymous" | "authenticated"
  >("loading");
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [status, setStatus] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string;
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((result: { user: SessionUser | null }) =>
        setSessionState(result.user ? "authenticated" : "anonymous"),
      )
      .catch(() => setSessionState("anonymous"));
  }, []);

  if (sessionState === "loading")
    return <LoadingRoute label="Checking your session…" />;
  if (sessionState === "authenticated")
    return (
      <Navigate
        to={
          returnTo?.startsWith("/") && !returnTo.startsWith("//")
            ? returnTo
            : "/app"
        }
        replace
      />
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitting(true);
    setStatus(undefined);
    const data = new FormData(formElement);
    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          name: registering ? data.get("name") : undefined,
          mode,
          turnstileToken,
          returnTo:
            returnTo?.startsWith("/") && !returnTo.startsWith("//")
              ? returnTo
              : undefined,
        }),
      });
      const result = (await response.json()) as {
        message?: string;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          result.error?.message ?? "We could not send the secure link.",
        );
      setStatus({
        kind: "success",
        message: result.message ?? "Check your inbox for a secure link.",
      });
      formElement.reset();
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="entry-layout">
      <section className="entry-aside">
        <Link to="/" className="brand">
          <Wordmark />
        </Link>
        <p className="kicker">Your program, in rhythm</p>
        <h1>
          {registering
            ? "Make the busy work feel beautifully quiet."
            : "Welcome back to the loom."}
        </h1>
        <p>
          ProgramLoom keeps organizers, reviewers, and speakers moving together.
        </p>
      </section>
      <section className="entry-panel" aria-labelledby="entry-title">
        <div className="entry-card">
          <p className="kicker">
            {registering ? "Create an organizer account" : "Sign in securely"}
          </p>
          <h2 id="entry-title">
            {registering
              ? "Start with your work email"
              : "Continue to ProgramLoom"}
          </h2>
          <form onSubmit={submit}>
            {registering && (
              <label>
                Full name
                <input autoComplete="name" name="name" required />
              </label>
            )}
            <label>
              Email address
              <input autoComplete="email" name="email" type="email" required />
            </label>
            {turnstileSiteKey && (
              <Turnstile
                siteKey={turnstileSiteKey}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken(undefined)}
                options={{ theme: "light" }}
              />
            )}
            {status && (
              <div
                className={`form-status form-status-${status.kind}`}
                role={status.kind === "error" ? "alert" : "status"}
              >
                {status.message}
              </div>
            )}
            <button
              className="button button-large"
              type="submit"
              disabled={
                submitting || Boolean(turnstileSiteKey && !turnstileToken)
              }
            >
              {submitting ? "Sending…" : "Email me a secure link"}{" "}
              {!submitting && <ArrowRight size={18} />}
            </button>
          </form>
          <p className="form-note">
            Passwordless sign-in. Links expire after 15 minutes.
          </p>
          <p>
            {registering ? "Already have an account?" : "New to ProgramLoom?"}{" "}
            <Link
              className="text-link"
              to={registering ? "/login" : "/register"}
            >
              {registering ? "Sign in" : "Start free"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

type SessionUser = { id: string; email: string; name: string };

function AuthenticatedPage({
  page,
}: {
  page:
    | "dashboard"
    | "team"
    | "event"
    | "submissions"
    | "reviews"
    | "speakers"
    | "content"
    | "agenda"
    | "widgets"
    | "communications"
    | "calendar"
    | "control-room"
    | "developer-settings"
    | "crm";
}) {
  const [session, setSession] = useState<{
    loading: boolean;
    user: SessionUser | null;
  }>({ loading: true, user: null });
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((result: { user: SessionUser | null }) =>
        setSession({ loading: false, user: result.user }),
      )
      .catch(() => setSession({ loading: false, user: null }));
  }, []);
  if (session.loading)
    return (
      <main id="main-content" className="loading-page" aria-busy="true">
        Loading your workspace…
      </main>
    );
  if (!session.user) return <Navigate to="/login" replace />;
  let content;
  if (page === "team") content = <TeamPage user={session.user} />;
  else if (page === "event") content = <EventWorkspace user={session.user} />;
  else if (page === "submissions")
    content = <EventSubmissions user={session.user} />;
  else if (page === "reviews") content = <EventReviews user={session.user} />;
  else if (page === "speakers") content = <EventSpeakers user={session.user} />;
  else if (page === "content") content = <EventContent user={session.user} />;
  else if (page === "agenda") content = <EventAgenda user={session.user} />;
  else if (page === "widgets") content = <EventWidgets user={session.user} />;
  else if (page === "communications")
    content = <EventCommunications user={session.user} />;
  else if (page === "calendar") content = <EventCalendar user={session.user} />;
  else if (page === "control-room")
    content = <EventControlRoom user={session.user} />;
  else if (page === "crm") content = <CRMPage user={session.user} />;
  else if (page === "developer-settings")
    content = <DeveloperSettings user={session.user} />;
  else content = <Dashboard user={session.user} />;
  return (
    <>
      <CommandPalette />
      <NotificationCenter />
      {content}
    </>
  );
}

function PublicCfpAlias() {
  const { organizationSlug, eventSlug, formSlug } = useParams();
  return (
    <Navigate replace to={`/c/${organizationSlug}/${eventSlug}/${formSlug}`} />
  );
}

export function App() {
  return (
    <>
      <EscapeDismissController />
      <Suspense fallback={<LoadingRoute label="Loading ProgramLoom…" />}>
        <Routes>
          <Route path="/" element={<MarketingPage />} />
          <Route path="/login" element={<EntryPage mode="login" />} />
          <Route path="/register" element={<EntryPage mode="register" />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/cfp" element={<PublicCfpDirectory />} />
          <Route
            path="/cfp/:organizationSlug/:eventSlug/:formSlug"
            element={<PublicCfpAlias />}
          />
          <Route path="/privacy" element={<LegalPage kind="privacy" />} />
          <Route path="/terms" element={<LegalPage kind="terms" />} />
          <Route path="/developers" element={<DeveloperDocs />} />
          <Route path="/guide" element={<ProductGuide />} />
          <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
          <Route
            path="/c/:organizationSlug/:eventSlug/:formSlug"
            element={<PublicCfpPage />}
          />
          <Route
            path="/interest/:organizationSlug/:formSlug"
            element={<PublicInterestPage />}
          />
          <Route path="/embed/:publicKey" element={<PublicWidgetPage />} />
          <Route
            path="/action/submission-edit"
            element={<SubmissionEditActionPage />}
          />
          <Route path="/app" element={<AuthenticatedPage page="dashboard" />} />
          <Route path="/dashboard" element={<Navigate to="/app" replace />} />
          <Route path="/admin" element={<Navigate to="/app" replace />} />
          <Route path="/organizer" element={<Navigate to="/app" replace />} />
          <Route path="/app/team" element={<AuthenticatedPage page="team" />} />
          <Route path="/app/crm" element={<AuthenticatedPage page="crm" />} />
          <Route
            path="/app/settings"
            element={<AuthenticatedPage page="developer-settings" />}
          />
          <Route
            path="/app/events/:eventId"
            element={<AuthenticatedPage page="event" />}
          />
          <Route
            path="/app/events/:eventId/submissions"
            element={<AuthenticatedPage page="submissions" />}
          />
          <Route
            path="/app/events/:eventId/submissions/:submissionId"
            element={<AuthenticatedPage page="submissions" />}
          />
          <Route
            path="/app/events/:eventId/reviews"
            element={<AuthenticatedPage page="reviews" />}
          />
          <Route
            path="/app/events/:eventId/speakers"
            element={<AuthenticatedPage page="speakers" />}
          />
          <Route
            path="/app/events/:eventId/speaker"
            element={<AuthenticatedPage page="speakers" />}
          />
          <Route
            path="/app/events/:eventId/speaker-portal"
            element={<AuthenticatedPage page="speakers" />}
          />
          <Route
            path="/app/events/:eventId/content"
            element={<AuthenticatedPage page="content" />}
          />
          <Route
            path="/app/events/:eventId/agenda"
            element={<AuthenticatedPage page="agenda" />}
          />
          <Route
            path="/app/events/:eventId/widgets"
            element={<AuthenticatedPage page="widgets" />}
          />
          <Route
            path="/app/events/:eventId/communications"
            element={<AuthenticatedPage page="communications" />}
          />
          <Route
            path="/app/events/:eventId/calendar"
            element={<AuthenticatedPage page="calendar" />}
          />
          <Route
            path="/app/events/:eventId/control-room"
            element={<AuthenticatedPage page="control-room" />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
