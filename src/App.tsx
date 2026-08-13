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
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";

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

export function ModalAccessibilityController() {
  useEffect(() => {
    let activeDialog: HTMLElement | undefined;
    let initiatingControl: HTMLElement | undefined;
    let lastControl: HTMLElement | undefined;
    const background = new Map<
      HTMLElement,
      { inert: boolean; ariaHidden: string | null }
    >();

    const focusable = (dialog: HTMLElement) =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);

    function restoreBackground() {
      for (const [element, previous] of background) {
        element.inert = previous.inert;
        if (previous.ariaHidden === null)
          element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", previous.ariaHidden);
      }
      background.clear();
    }

    function isolate(dialog: HTMLElement) {
      let branch: HTMLElement = dialog;
      while (branch.parentElement && branch.parentElement !== document.body) {
        const parent = branch.parentElement;
        for (const sibling of [...parent.children]) {
          if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
          if (!background.has(sibling))
            background.set(sibling, {
              inert: sibling.inert,
              ariaHidden: sibling.getAttribute("aria-hidden"),
            });
          sibling.inert = true;
          sibling.setAttribute("aria-hidden", "true");
        }
        branch = parent;
      }
    }

    function visibleDialog() {
      return [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        ),
      ]
        .filter((dialog) => dialog.getClientRects().length > 0)
        .at(-1);
    }

    function synchronize() {
      const dialog = visibleDialog();
      if (dialog === activeDialog) return;
      const restore = initiatingControl;
      restoreBackground();
      activeDialog = dialog;
      if (!dialog) {
        initiatingControl = undefined;
        if (restore?.isConnected) restore.focus({ preventScroll: true });
        return;
      }
      initiatingControl =
        lastControl ?? (document.activeElement as HTMLElement);
      isolate(dialog);
      window.requestAnimationFrame(() => {
        if (activeDialog !== dialog || dialog.contains(document.activeElement))
          return;
        const target =
          dialog.querySelector<HTMLElement>("[autofocus]") ??
          focusable(dialog)[0] ??
          dialog;
        if (target === dialog && !dialog.hasAttribute("tabindex"))
          dialog.tabIndex = -1;
        target.focus({ preventScroll: true });
      });
    }

    function remember(event: Event) {
      const control = (
        event.target as HTMLElement | null
      )?.closest<HTMLElement>("button, a[href], [role=button]");
      if (control && !activeDialog) lastControl = control;
    }

    function keyboard(event: KeyboardEvent) {
      const dialog = activeDialog;
      if (!dialog) return;
      if (event.key === "Escape") {
        const close = dialog.querySelector<HTMLButtonElement>(
          'button[aria-label="Close"], button[aria-label^="Close "], button[data-dismiss]',
        );
        if (!close) return;
        event.preventDefault();
        close.click();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable(dialog);
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("click", remember, true);
    document.addEventListener("keydown", keyboard);
    synchronize();
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", remember, true);
      document.removeEventListener("click", remember, true);
      document.removeEventListener("keydown", keyboard);
      restoreBackground();
    };
  }, []);
  return null;
}

const EVENT_PAGE_TITLES: Record<string, string> = {
  "control-room": "Control Room",
  cfp: "Call for proposals",
  submissions: "Proposals",
  reviews: "Reviews",
  speakers: "Speakers",
  speaker: "Speaker portal",
  "speaker-portal": "Speaker portal",
  content: "Content",
  agenda: "Agenda",
  calendar: "Calendar invitations",
  communications: "Communications Center",
  widgets: "Public widgets",
};

export function titleForPath(pathname: string) {
  if (pathname === "/")
    return "ProgramLoom — Turn proposals into a trusted program";
  if (pathname === "/login") return "Sign in — ProgramLoom";
  if (pathname === "/register") return "Create your account — ProgramLoom";
  if (pathname === "/invite") return "Accept your invitation — ProgramLoom";
  if (pathname === "/guide") return "How ProgramLoom works";
  if (pathname === "/program") return "Explore ProgramLoom Summit 2027";
  if (pathname === "/evaluate") return "Choose a ProgramLoom persona";
  if (pathname === "/developers") return "Developer platform — ProgramLoom";
  if (pathname === "/oauth/authorize")
    return "Authorize application — ProgramLoom";
  if (pathname === "/action/submission-edit")
    return "Edit proposal — ProgramLoom";
  if (pathname === "/privacy") return "Privacy notice — ProgramLoom";
  if (pathname === "/terms") return "Terms of service — ProgramLoom";
  if (
    pathname === "/cfp" ||
    pathname.startsWith("/cfp/") ||
    pathname.startsWith("/c/")
  )
    return "Calls for proposals — ProgramLoom";
  if (pathname.startsWith("/interest/"))
    return "Speaker interest form — ProgramLoom";
  if (pathname.startsWith("/embed/")) return "Public program — ProgramLoom";
  if (pathname === "/app") return "Events — ProgramLoom";
  if (pathname === "/app/team") return "Team — ProgramLoom";
  if (pathname === "/app/crm") return "Speaker CRM — ProgramLoom";
  if (pathname === "/app/settings") return "Developer settings — ProgramLoom";

  if (/^\/app\/events\/[^/]+\/submissions\/[^/]+$/.test(pathname))
    return "Proposal details — ProgramLoom";

  const eventRoute = pathname.match(/^\/app\/events\/[^/]+(?:\/([^/]+))?$/);
  if (eventRoute) {
    const section = eventRoute[1];
    const label = section
      ? (EVENT_PAGE_TITLES[section] ?? "Event workspace")
      : "Event workspace";
    return `${label} — ProgramLoom`;
  }
  return "Page not found — ProgramLoom";
}

const DEFAULT_DESCRIPTION =
  "ProgramLoom shows event organizers what is blocking their program and carries every accepted proposal through review, communication, onboarding, scheduling, and publication.";

export function descriptionForPath(pathname: string) {
  if (pathname === "/") return DEFAULT_DESCRIPTION;
  if (pathname === "/login" || pathname === "/register")
    return "Sign in to ProgramLoom or create an organizer account to manage an event program.";
  if (pathname === "/invite")
    return "Accept a ProgramLoom invitation to join an event as a reviewer, speaker, or organizer.";
  if (pathname === "/guide")
    return "Follow a proposal from an open call through review, decision communication, speaker preparation, scheduling, and publication.";
  if (pathname === "/program")
    return "Explore the live multi-day ProgramLoom Summit 2027 agenda, speakers, itinerary, and machine-readable public feeds.";
  if (pathname === "/evaluate")
    return "Choose the normal Organizer, Reviewer, Speaker, or Attendee entry route for ProgramLoom.";
  if (pathname === "/developers")
    return "Connect trusted event tools to ProgramLoom with scoped API tokens, webhooks, OAuth, query access, and an authorized MCP server.";
  if (
    pathname === "/cfp" ||
    pathname.startsWith("/cfp/") ||
    pathname.startsWith("/c/")
  )
    return "Browse open calls for proposals or submit and manage your session idea.";
  if (pathname.startsWith("/embed/"))
    return "Browse a live, accessible event program published with ProgramLoom.";
  if (pathname.startsWith("/interest/"))
    return "Share your speaking interests with an event organizer through a secure ProgramLoom form.";
  if (pathname === "/privacy")
    return "Learn what information ProgramLoom handles, why it is used, and the choices available to organizers, reviewers, speakers, and attendees.";
  if (pathname === "/terms")
    return "Read the terms that govern use of the hosted ProgramLoom service.";
  if (pathname.startsWith("/app"))
    return "Manage proposals, reviews, speakers, content, communications, schedules, and publication in ProgramLoom.";
  return DEFAULT_DESCRIPTION;
}

export function shouldIndexPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/guide" ||
    pathname === "/program" ||
    pathname === "/developers" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/cfp" ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/interest/") ||
    pathname.startsWith("/embed/")
  );
}

export function canonicalUrlForPath(pathname: string, currentOrigin: string) {
  const isLocal = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(
    currentOrigin,
  );
  const usesMarketingOrigin =
    pathname === "/" ||
    pathname === "/guide" ||
    pathname === "/program" ||
    pathname === "/developers" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname.startsWith("/embed/");
  const origin = isLocal
    ? currentOrigin
    : usesMarketingOrigin
      ? "https://programloom.com"
      : "https://app.programloom.com";
  return new URL(pathname, origin).toString();
}

function setDocumentMeta(
  attribute: "name" | "property",
  key: string,
  content: string,
) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

function DocumentMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const normalizedPathname =
      pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    const title = titleForPath(normalizedPathname);
    const description = descriptionForPath(normalizedPathname);
    const canonicalUrl = canonicalUrlForPath(
      normalizedPathname,
      window.location.origin,
    );
    document.title = title;
    setDocumentMeta("name", "description", description);
    setDocumentMeta(
      "name",
      "robots",
      shouldIndexPath(normalizedPathname)
        ? "index, follow, max-image-preview:large"
        : "noindex, nofollow",
    );
    setDocumentMeta("property", "og:title", title);
    setDocumentMeta("property", "og:description", description);
    setDocumentMeta("property", "og:url", canonicalUrl);
    setDocumentMeta("name", "twitter:title", title);
    setDocumentMeta("name", "twitter:description", description);
    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = canonicalUrl;
  }, [pathname]);
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

const summitEventId = "5c33f61d-3af6-41ff-8b2e-6268181001f8";
const summitWidgets = {
  agenda: "agenda-8b0020bb6481415f864a",
  sessions: "sessions-bfdfc1515f0d4bf8aea4",
  speakers: "speakers-675b59dd225f4152acf3",
  gallery: "gallery-f0410c5463644a2fbae0",
  itinerary: "itinerary-2508fc81fad24cb591fc",
} as const;
const walkthroughReleaseUrl =
  "https://github.com/maddiedreese/ProgramLoom/releases/tag/programloom-final-walkthrough-2026-08-12";
const walkthroughVideoUrl =
  "/programloom-walkthrough.mp4?v=judge-first-2026-08-12";
const judgeTourVideoUrl = "/programloom-judge-tour.mp4?v=judge-first-final";

const productionProof = [
  "Real Resend delivery",
  "Gmail + Apple Calendar lifecycle",
  "Airtable healthy",
  "77 production browser scenarios",
  "237 unit and API tests",
] as const;

export const evaluatorPersonas = [
  {
    name: "Organizer",
    note: "Organizers can access the Control Room and manage proposals, reviews, decisions, speakers, content, communications, and publication for events they are authorized to manage.",
    path: `/login?returnTo=/app/events/${summitEventId}/control-room`,
  },
  {
    name: "Reviewer",
    note: "Reviewers can access only assigned review work and the proposal information permitted by the event's review settings.",
    path: `/login?returnTo=/app/events/${summitEventId}/reviews`,
  },
  {
    name: "Speaker",
    note: "Speakers can access only their connected portal records, onboarding tasks, files, profile, and sessions.",
    path: `/login?returnTo=/app/events/${summitEventId}/speaker`,
  },
  {
    name: "Public Program",
    note: "Attendees can explore the published agenda, speakers, sessions, and personal itinerary without authentication.",
    path: "/program",
  },
] as const;

const seededProofRoutes = [
  {
    label: "Control Room blockers",
    detail: "Persisted next actions and live affected-record counts.",
    path: `/login?returnTo=/app/events/${summitEventId}/control-room`,
  },
  {
    label: "Published CFP",
    detail:
      "Public, multi-section proposal form with server-equivalent validation.",
    path: "/c/devflow-programs/programloom-summit-2027/cfp",
    public: true,
  },
  {
    label: "Review workspace",
    detail:
      "Assigned, incomplete, conflicted, recused, and completed review states.",
    path: `/login?returnTo=/app/events/${summitEventId}/reviews`,
  },
  {
    label: "Outstanding speaker work",
    detail: "Onboarding tasks, requested files, and content approval blockers.",
    path: `/login?returnTo=/app/events/${summitEventId}/speakers?taskProgress=incomplete`,
  },
  {
    label: "Schedule conflict lab",
    detail:
      "Reserved sessions demonstrate conflict detection and explicit resolution.",
    path: `/login?returnTo=/app/events/${summitEventId}/agenda`,
  },
  {
    label: "Failed delivery recovery",
    detail:
      "Retryable failure, Retry delivery, durable state, audit, and notification.",
    path: `/login?returnTo=/app/events/${summitEventId}/communications?status=failed`,
  },
  {
    label: "Public program outputs",
    detail: "Agenda, speakers, itinerary, JSON, XML, ICS, and embed output.",
    path: "/program",
    public: true,
  },
] as const;

function ProductionProof() {
  return (
    <aside className="production-proof" aria-label="Verified in production">
      <strong>Verified in production</strong>
      <ul>
        {productionProof.map((claim) => (
          <li key={claim}>
            <Check size={15} aria-hidden="true" /> {claim}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function EvaluatorEntryPage() {
  return (
    <main className="persona-entry" id="main-content">
      <Link to="/" className="brand" aria-label="ProgramLoom home">
        <Wordmark />
      </Link>
      <p className="kicker">Judge ProgramLoom</p>
      <h1>See the differentiator first. Verify the depth next.</h1>
      <p className="persona-intro">
        Watch the 90-second Control Room tour, then open Organizer, Reviewer,
        Speaker, and Public Program. Every privileged route uses normal
        authentication and authorization; no public privileged session exists.
      </p>
      <section className="judge-start" aria-labelledby="judge-start-title">
        <div>
          <p className="kicker">Start here · 90 seconds</p>
          <h2 id="judge-start-title">
            You do not manage a conference by navigating CRUD pages. You manage
            blockers.
          </h2>
          <p>
            The tour starts in the Control Room with an incomplete review, an
            unsent decision, a missing speaker asset, and an accepted talk
            without a slot—then opens their direct resolution paths from
            persisted next actions.
          </p>
        </div>
        <video
          controls
          playsInline
          preload="metadata"
          poster="/programloom-control-room.jpg?v=programloom-summit-2027"
          aria-label="90-second Judge ProgramLoom tour"
        >
          <source src={judgeTourVideoUrl} type="video/mp4" />
        </video>
      </section>
      <ProductionProof />
      <section className="judge-decisions" aria-labelledby="decisions-title">
        <p className="kicker">Three intentional product decisions</p>
        <h2 id="decisions-title">Built for consequences, not checkboxes.</h2>
        <div>
          <article>
            <strong>Stage decision ≠ Send decision</strong>
            <p>Organizers cannot accidentally email hundreds of speakers.</p>
          </article>
          <article>
            <strong>Next actions come from persisted facts</strong>
            <p>
              The Control Room never depends on a manually maintained progress
              flag.
            </p>
          </article>
          <article>
            <strong>Calendars update and cancel correctly</strong>
            <p>
              Stable UID and increasing sequence prevent stale participant
              calendars.
            </p>
          </article>
        </div>
      </section>
      <h2 className="persona-heading">Open each production perspective</h2>
      <div className="persona-grid">
        {evaluatorPersonas.map((persona) => (
          <article key={persona.name}>
            <h2>{persona.name}</h2>
            <p>{persona.note}</p>
            <a
              className="button"
              href={
                persona.name === "Public Program"
                  ? persona.path
                  : applicationHref(persona.path)
              }
            >
              {persona.name === "Public Program"
                ? "Open Public Program"
                : `Continue as ${persona.name}`}
            </a>
          </article>
        ))}
      </div>
      <section className="seeded-proof" aria-labelledby="seeded-proof-title">
        <p className="kicker">Exact seeded proof routes</p>
        <h2 id="seeded-proof-title">No scavenger hunt required.</h2>
        <div>
          {seededProofRoutes.map((route) => (
            <a
              key={route.label}
              href={
                "public" in route && route.public
                  ? route.path
                  : applicationHref(route.path)
              }
            >
              <strong>{route.label}</strong>
              <span>{route.detail}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProgramExplorePage() {
  const agendaKey = summitWidgets.agenda;
  const publicLinks = [
    [
      "Public CFP",
      applicationHref("/c/devflow-programs/programloom-summit-2027/cfp"),
    ],
    ["Agenda", `/embed/${agendaKey}`],
    ["Speakers", `/embed/${summitWidgets.speakers}`],
    ["Itinerary", `/embed/${summitWidgets.itinerary}`],
    ["JSON", `/api/widgets/public/${agendaKey}/feed.json`],
    ["XML", `/api/widgets/public/${agendaKey}/feed.xml`],
    ["ICS", `/api/widgets/public/${agendaKey}/agenda.ics`],
    ["Embed", `/api/widgets/public/${agendaKey}/embed.js`],
  ] as const;
  return (
    <div className="public-program-page">
      <header>
        <Link to="/" className="brand" aria-label="ProgramLoom home">
          <Wordmark />
        </Link>
        <a href="/help/attendees">Attendee help</a>
      </header>
      <main id="main-content">
        <p className="kicker">Explore the program</p>
        <h1>ProgramLoom Summit 2027</h1>
        <p>
          A polished, multi-day program for teams building calm, inclusive,
          reliable technical events. All records below come from the current
          published production program.
        </p>
        <nav
          className="public-program-links"
          aria-label="Public program outputs"
        >
          {publicLinks.map(([label, href]) => (
            <a key={label} href={href} className="button button-ghost">
              {label}
            </a>
          ))}
        </nav>
        <iframe
          className="public-program-frame"
          title="Live ProgramLoom Summit 2027 agenda"
          src={`/embed/${agendaKey}`}
          loading="eager"
        />
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
        <section className="hero" id="walkthrough">
          <div className="hero-message">
            <div className="eyebrow">
              <Sparkles size={15} /> Speaker programs, without the spreadsheet
              maze
            </div>
            <h1>Turn session ideas into a schedule people can trust.</h1>
            <p className="hero-copy">
              ProgramLoom shows organizers exactly what is blocking their
              program, gives them the tools to resolve it, and carries every
              accepted proposal safely through communication, onboarding,
              scheduling, publication, and follow-up.
            </p>
            <p className="hero-lifecycle">
              Collect proposals, review them, make decisions, prepare speakers,
              approve content, build the agenda, and publish the program from
              one connected record.
            </p>
            <div className="hero-actions">
              <Link className="button button-large" to="/evaluate">
                Judge ProgramLoom <ArrowRight size={18} />
              </Link>
              <a
                className="button button-large button-ghost"
                href={applicationHref("/register")}
              >
                Create your first event. <ArrowRight size={18} />
              </a>
              <a className="text-link" href={applicationHref("/app")}>
                Open ProgramLoom.
              </a>
              <a className="text-link" href="/help/">
                Read the help center.
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
            <ProductionProof />
          </div>
          <figure className="hero-control-room">
            <video
              aria-label="ProgramLoom continuous production walkthrough"
              controls
              playsInline
              poster="/programloom-control-room.jpg?v=programloom-summit-2027"
              preload="metadata"
            >
              <source src={walkthroughVideoUrl} type="video/mp4" />
              Your browser cannot play the walkthrough video. Open the full
              walkthrough using the link below.
            </video>
            <figcaption>
              <strong>Complete production walkthrough · 3:33 · 30 steps</strong>
              <span>
                Silent on-screen guidance through event creation, review,
                decisions, speaker preparation, publication, and cancellation.
              </span>
              <span className="walkthrough-hero-links">
                <a href={walkthroughReleaseUrl}>
                  Open walkthrough and evidence
                </a>
                <Link to="/program">Explore the live program</Link>
              </span>
            </figcaption>
          </figure>
        </section>
        <section
          id="control-room"
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
              <strong>Staging a decision does not communicate it.</strong> You
              first stage the decision, then review the recipients and message
              in Communications before choosing Send decision.
            </p>
            <a className="button button-large" href="/help/getting-started">
              Learn how to create an event <ArrowRight size={18} />
            </a>
          </div>
          <figure>
            <img
              src="/programloom-control-room.jpg?v=15f20fd6"
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
          className="marketing-live-program"
          aria-labelledby="live-program-title"
        >
          <div>
            <p className="kicker">Live production program</p>
            <h2 id="live-program-title">
              Explore a real multi-speaker session.
            </h2>
            <p>
              This interactive preview reads the current persisted public
              records for ProgramLoom Summit 2027. Search, open the session, and
              inspect its speakers without leaving this page.
            </p>
            <Link className="button button-ghost" to="/program">
              Explore the full program <ArrowRight size={18} />
            </Link>
          </div>
          <iframe
            title="Live multi-speaker ProgramLoom Summit session"
            src={`/embed/${summitWidgets.sessions}?search=${encodeURIComponent("Building Sustainable Review Panels")}`}
            loading="eager"
          />
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
          <a href="https://github.com/maddiedreese/ProgramLoom">Source</a>
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
            <div className="turnstile-slot" data-visual-dynamic>
              {turnstileSiteKey && (
                <Turnstile
                  siteKey={turnstileSiteKey}
                  onSuccess={setTurnstileToken}
                  onExpire={() => setTurnstileToken(undefined)}
                  options={{ theme: "light" }}
                />
              )}
            </div>
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

function EventDefaultRedirect() {
  const { eventId } = useParams();
  return <Navigate replace to={`/app/events/${eventId}/control-room`} />;
}

export function App() {
  return (
    <>
      <DocumentMetadata />
      <ModalAccessibilityController />
      <Suspense fallback={<LoadingRoute label="Loading ProgramLoom…" />}>
        <Routes>
          <Route path="/" element={<MarketingPage />} />
          <Route path="/program" element={<ProgramExplorePage />} />
          <Route path="/evaluate" element={<EvaluatorEntryPage />} />
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
            element={<EventDefaultRedirect />}
          />
          <Route
            path="/app/events/:eventId/cfp"
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
