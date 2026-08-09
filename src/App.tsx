import { Turnstile } from "@marsidev/react-turnstile";
import {
  ArrowRight,
  CalendarRange,
  Check,
  GalleryVerticalEnd,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { lazy, Suspense, type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Dashboard } from "./app/Dashboard";
import { InvitePage } from "./app/InvitePage";
import { TeamPage } from "./app/TeamPage";
import { EventWorkspace } from "./app/EventWorkspace";
import { PublicCfpPage } from "./app/PublicCfpPage";
import { EventSubmissions } from "./app/EventSubmissions";
import { EventReviews } from "./app/EventReviews";
import { EventSpeakers } from "./app/EventSpeakers";
import { EventAgenda } from "./app/EventAgenda";
import { EventWidgets } from "./app/EventWidgets";
import { PublicWidgetPage } from "./app/PublicWidgetPage";

const LazyCRMPage = lazy(() =>
  import("./app/CRMPage").then(({ CRMPage }) => ({ default: CRMPage })),
);
const LazyEventContent = lazy(() =>
  import("./app/EventContent").then(({ EventContent }) => ({
    default: EventContent,
  })),
);
const LazyPublicInterestPage = lazy(() =>
  import("./app/PublicInterestPage").then(({ PublicInterestPage }) => ({
    default: PublicInterestPage,
  })),
);

function LoadingRoute({ label }: { label: string }) {
  return (
    <main className="loading-page" aria-busy="true">
      {label}
    </main>
  );
}

const capabilities = [
  {
    icon: GalleryVerticalEnd,
    title: "Shape the program",
    body: "Collect proposals with conditional forms, route reviews, and make decisions with confidence.",
  },
  {
    icon: UsersRound,
    title: "Take care of speakers",
    body: "One calm portal for profiles, tasks, travel, files, feedback, and every deadline.",
  },
  {
    icon: CalendarRange,
    title: "Publish without collisions",
    body: "Build a multi-track schedule, catch conflicts early, and publish live, embeddable views.",
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

function MarketingPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="ProgramLoom home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#principles">Why ProgramLoom</a>
          <a
            className="button button-small button-ghost"
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
            <Sparkles size={15} /> The program workspace that keeps its promises
          </div>
          <h1>Weave every moving part into one remarkable program.</h1>
          <p className="hero-copy">
            Proposals, reviews, speakers, content, schedules, and public
            pages—connected from the first submission to showtime.
          </p>
          <div className="hero-actions">
            <a
              className="button button-large"
              href={applicationHref("/register")}
            >
              Build your first event <ArrowRight size={18} />
            </a>
            <a
              className="text-link"
              href="https://github.com/maddiedreese/SaaS"
            >
              Open-source on GitHub
            </a>
          </div>
          <div className="proof-row" aria-label="Product principles">
            <span>
              <Check size={16} /> Free to start
            </span>
            <span>
              <Check size={16} /> No attendee data resale
            </span>
            <span>
              <Check size={16} /> AGPL open source
            </span>
          </div>
        </section>
        <section
          id="product"
          className="capabilities"
          aria-labelledby="capabilities-title"
        >
          <div className="section-heading">
            <p className="kicker">One continuous workflow</p>
            <h2 id="capabilities-title">Less chasing. More programming.</h2>
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
          <p className="kicker">Designed for the people doing the work</p>
          <blockquote>
            “A program tool should reduce uncertainty, not move it into another
            spreadsheet.”
          </blockquote>
          <p>
            ProgramLoom keeps every decision, handoff, and public update
            connected—while Airtable remains available to teams that work best
            there.
          </p>
        </section>
      </main>
      <footer>
        <Wordmark />
        <span>Built in the open for event teams.</span>
      </footer>
    </div>
  );
}

function EntryPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [status, setStatus] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          name: registering ? data.get("name") : undefined,
          mode,
          turnstileToken,
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
      event.currentTarget.reset();
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
  if (page === "team") return <TeamPage user={session.user} />;
  if (page === "event") return <EventWorkspace user={session.user} />;
  if (page === "submissions") return <EventSubmissions user={session.user} />;
  if (page === "reviews") return <EventReviews user={session.user} />;
  if (page === "speakers") return <EventSpeakers user={session.user} />;
  if (page === "content")
    return (
      <Suspense fallback={<LoadingRoute label="Loading content workspace…" />}>
        <LazyEventContent user={session.user} />
      </Suspense>
    );
  if (page === "agenda") return <EventAgenda user={session.user} />;
  if (page === "widgets") return <EventWidgets user={session.user} />;
  if (page === "crm")
    return (
      <Suspense
        fallback={<LoadingRoute label="Loading the speaker network…" />}
      >
        <LazyCRMPage user={session.user} />
      </Suspense>
    );
  return <Dashboard user={session.user} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<MarketingPage />} />
      <Route path="/login" element={<EntryPage mode="login" />} />
      <Route path="/register" element={<EntryPage mode="register" />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route
        path="/c/:organizationSlug/:eventSlug/:formSlug"
        element={<PublicCfpPage />}
      />
      <Route
        path="/interest/:organizationSlug/:formSlug"
        element={
          <Suspense fallback={<LoadingRoute label="Loading interest form…" />}>
            <LazyPublicInterestPage />
          </Suspense>
        }
      />
      <Route path="/embed/:publicKey" element={<PublicWidgetPage />} />
      <Route path="/app" element={<AuthenticatedPage page="dashboard" />} />
      <Route path="/app/team" element={<AuthenticatedPage page="team" />} />
      <Route path="/app/crm" element={<AuthenticatedPage page="crm" />} />
      <Route
        path="/app/events/:eventId"
        element={<AuthenticatedPage page="event" />}
      />
      <Route
        path="/app/events/:eventId/submissions"
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
      <Route path="*" element={<MarketingPage />} />
    </Routes>
  );
}
