import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Code2,
  FileInput,
  Files,
  Gauge,
  Inbox,
  Mail,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { captureProductEvent } from "../lib/telemetry";
import { SidebarUser } from "./SidebarUser";

type User = { id: string; email: string; name: string };
type Issue = {
  category: string;
  entityType: string;
  entityId: string;
  title: string;
  detail: string;
  severity: "blocking" | "warning" | "info";
  status: string;
  deadline: string | null;
  occurredAt: string;
  actionUrl: string;
  trackId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
};
type Overview = {
  event: { id: string; name: string };
  counts: Record<string, number>;
  severityCounts: Record<"blocking" | "warning" | "info", number>;
  total: number;
  items: Issue[];
  owners: { id: string; name: string }[];
  tracks: { id: string; name: string }[];
  pagination: { page: number; pageSize: number; total: number };
  refreshedAt: string;
};

const categories = [
  [
    "submissions_new",
    "Drafts & new proposals",
    "Proposals needing initial triage",
  ],
  [
    "reviewer_assignment",
    "Reviewer assignment",
    "Proposals without active reviewers",
  ],
  ["reviews_incomplete", "Incomplete reviews", "Open review work by round"],
  ["review_conflicts", "Recusals & conflicts", "Unresolved reviewer conflicts"],
  [
    "decisions_pending",
    "Decisions pending",
    "Reviewed proposals awaiting action",
  ],
  [
    "decisions_uncommunicated",
    "Decisions not sent",
    "Staged outcomes awaiting communication",
  ],
  ["deliveries", "Delivery exceptions", "Pending and failed program messages"],
  ["portal_access", "Portal access", "Accepted speakers without active access"],
  ["onboarding", "Onboarding", "Incomplete and overdue tasks"],
  ["assets", "Files & headshots", "Missing or returned speaker assets"],
  ["content_review", "Content review", "Content awaiting approval"],
  [
    "public_exclusions",
    "Public exclusions",
    "Unapproved sessions held from public pages",
  ],
  ["agenda_missing", "Agenda placement", "Accepted sessions not yet placed"],
  ["schedule_conflicts", "Schedule conflicts", "Room and speaker collisions"],
  [
    "agenda_unpublished",
    "Unpublished agenda",
    "Schedule changes not yet public",
  ],
  ["queue_failures", "Queue jobs", "Retrying or exhausted background work"],
  ["airtable_sync", "Airtable sync", "Backlog, failures, and conflicts"],
  [
    "integration_failures",
    "Integrations",
    "External or scheduled-job incidents",
  ],
] as const;

const resolvable = new Set([
  "submissions_new",
  "review_conflicts",
  "schedule_conflicts",
  "integration_failures",
]);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "The request could not be completed.",
    );
  return result;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function EventControlRoom({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const initial = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const [filters, setFilters] = useState({
    category: initial.get("category") ?? "",
    severity: initial.get("severity") ?? "",
    owner: initial.get("owner") ?? "",
    status: initial.get("status") ?? "",
    deadline: initial.get("deadline") ?? "",
    track: initial.get("track") ?? "",
  });
  const [overview, setOverview] = useState<Overview>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      const query = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => value),
      );
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query.size ? `?${query}` : ""}`,
      );
      try {
        const result = await api<Overview>(
          `/api/control-room/events/${eventId}?${query}`,
        );
        setOverview(result);
        setError("");
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The Control Room could not be loaded.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId, filters],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function assignOwner(issue: Issue, ownerUserId: string) {
    await api(
      `/api/control-room/events/${eventId}/issues/${issue.category}/${issue.entityType}/${issue.entityId}/owner`,
      {
        method: "PUT",
        body: JSON.stringify({ ownerUserId: ownerUserId || null }),
      },
    );
    captureProductEvent("control_room_owner_changed", {
      event_id: eventId,
      category: issue.category,
    });
    await load(true);
  }

  async function resolve(issue: Issue) {
    await api(
      `/api/control-room/events/${eventId}/issues/${issue.category}/${issue.entityType}/${issue.entityId}/resolve`,
      { method: "POST" },
    );
    captureProductEvent("control_room_issue_resolved", {
      event_id: eventId,
      category: issue.category,
    });
    await load(true);
  }

  const blocking = overview?.severityCounts.blocking ?? 0;
  return (
    <div className="workspace-shell event-workspace">
      <aside className="workspace-sidebar event-sidebar">
        <a className="wordmark sidebar-wordmark" href="/">
          <span className="mark">PL</span> ProgramLoom
        </a>
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> All events
        </a>
        <label className="control-mobile-nav">
          <span>Event workspace</span>
          <select
            aria-label="Event workspace"
            value="control-room"
            onChange={(event) => {
              window.location.href =
                event.target.value === "cfp"
                  ? `/app/events/${eventId}`
                  : `/app/events/${eventId}/${event.target.value}`;
            }}
          >
            <option value="control-room">Control Room</option>
            <option value="cfp">Call for proposals</option>
            <option value="submissions">Submissions</option>
            <option value="reviews">Reviews</option>
            <option value="speakers">Speakers</option>
            <option value="content">Content</option>
            <option value="agenda">Agenda</option>
            <option value="widgets">Public widgets</option>
            <option value="communications">Communications</option>
          </select>
        </label>
        <div className="event-identity">
          <small>Organizer workspace</small>
          <strong>{overview?.event.name ?? "Event"}</strong>
          <span>operations</span>
        </div>
        <nav className="event-nav" aria-label="Event workspace">
          <a className="active" href={`/app/events/${eventId}/control-room`}>
            <Gauge size={18} /> Control Room
          </a>
          <a href={`/app/events/${eventId}`}>
            <FileInput size={18} /> Call for proposals
          </a>
          <a href={`/app/events/${eventId}/submissions`}>
            <Inbox size={18} /> Submissions
          </a>
          <a href={`/app/events/${eventId}/reviews`}>
            <CheckCircle2 size={18} /> Reviews
          </a>
          <a href={`/app/events/${eventId}/speakers`}>
            <UsersRound size={18} /> Speakers
          </a>
          <a href={`/app/events/${eventId}/content`}>
            <Files size={18} /> Content
          </a>
          <a href={`/app/events/${eventId}/agenda`}>
            <CalendarClock size={18} /> Agenda
          </a>
          <a href={`/app/events/${eventId}/widgets`}>
            <Code2 size={18} /> Public widgets
          </a>
          <a href={`/app/events/${eventId}/communications`}>
            <Mail size={18} /> Communications
          </a>
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="event-main control-room-main">
        <header className="event-heading control-room-heading">
          <div>
            <p className="kicker">Organizer Control Room</p>
            <h1>What is blocking this program?</h1>
            <p>
              Live operational work, ordered by severity, deadline, and age.
            </p>
          </div>
          <button
            className="button button-ghost"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "spin" : ""} size={16} /> Refresh
          </button>
        </header>
        {error && (
          <div className="form-status form-status-error" role="alert">
            Some operational data could not be loaded. {error}{" "}
            <button onClick={() => void load()}>Try again</button>
          </div>
        )}
        <section
          className="control-room-summary"
          aria-label="Operational summary"
          aria-busy={loading}
        >
          <article className="summary-blocking">
            <CircleAlert size={20} />
            <span>Blocking</span>
            <strong>{blocking}</strong>
          </article>
          <article>
            <ClipboardCheck size={20} />
            <span>Total open work</span>
            <strong>{overview?.total ?? "—"}</strong>
          </article>
          <article>
            <RefreshCw size={20} />
            <span>Last refreshed</span>
            <strong>
              {overview ? formatDate(overview.refreshedAt) : "Loading…"}
            </strong>
          </article>
        </section>
        <section
          className="control-category-grid"
          aria-label="Control Room categories"
        >
          {categories.map(([key, label, description]) => {
            const count = overview?.counts[key] ?? 0;
            return (
              <button
                key={key}
                className={filters.category === key ? "active" : ""}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    category: current.category === key ? "" : key,
                  }))
                }
                aria-pressed={filters.category === key}
              >
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <b className={count ? "has-work" : "clear"}>{count}</b>
              </button>
            );
          })}
        </section>
        <section className="control-worklist" aria-labelledby="worklist-title">
          <div className="control-worklist-heading">
            <div>
              <p className="kicker">Prioritized work</p>
              <h2 id="worklist-title">
                {filters.category
                  ? categories.find(([key]) => key === filters.category)?.[1]
                  : "All open work"}
              </h2>
            </div>
            <span>{overview?.total ?? 0} records</span>
          </div>
          <div className="control-filters">
            <label>
              Severity
              <select
                value={filters.severity}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    severity: event.target.value,
                  }))
                }
              >
                <option value="">All</option>
                <option value="blocking">Blocking</option>
                <option value="warning">Warning</option>
                <option value="info">Information</option>
              </select>
            </label>
            <label>
              Owner
              <select
                value={filters.owner}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    owner: event.target.value,
                  }))
                }
              >
                <option value="">All</option>
                <option value="unassigned">Unassigned</option>
                {overview?.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Deadline
              <select
                value={filters.deadline}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    deadline: event.target.value,
                  }))
                }
              >
                <option value="">Any</option>
                <option value="overdue">Overdue</option>
                <option value="upcoming">Upcoming</option>
              </select>
            </label>
            <label>
              Status
              <input
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                placeholder="Any status"
              />
            </label>
            <label>
              Track
              <select
                value={filters.track}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    track: event.target.value,
                  }))
                }
              >
                <option value="">All tracks</option>
                {overview?.tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <div className="control-empty" aria-busy="true">
              <RefreshCw className="spin" /> Loading live operational data…
            </div>
          ) : overview?.items.length ? (
            <div className="control-issues">
              {overview.items.map((issue) => (
                <article
                  key={`${issue.category}:${issue.entityId}`}
                  className={`control-issue severity-${issue.severity}`}
                >
                  <div className="control-severity" title={issue.severity}>
                    {issue.severity === "blocking" ? (
                      <CircleAlert />
                    ) : (
                      <AlertTriangle />
                    )}
                  </div>
                  <div className="control-issue-copy">
                    <span>
                      {categories.find(
                        ([key]) => key === issue.category,
                      )?.[1] ?? issue.category}
                    </span>
                    <a href={issue.actionUrl}>{issue.title}</a>
                    <p>{issue.detail}</p>
                    <small>
                      {issue.status} ·{" "}
                      {issue.deadline
                        ? `Due ${formatDate(issue.deadline)}`
                        : `Open since ${formatDate(issue.occurredAt)}`}
                    </small>
                  </div>
                  <div className="control-issue-actions">
                    <label>
                      <span className="sr-only">Owner for {issue.title}</span>
                      <select
                        aria-label={`Owner for ${issue.title}`}
                        value={issue.ownerUserId ?? ""}
                        onChange={(event) =>
                          void assignOwner(issue, event.target.value)
                        }
                      >
                        <option value="">Unassigned</option>
                        {overview.owners.map((owner) => (
                          <option key={owner.id} value={owner.id}>
                            {owner.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <a
                      className="button button-small button-ghost"
                      href={issue.actionUrl}
                    >
                      Open
                    </a>
                    {resolvable.has(issue.category) &&
                      !(
                        issue.category === "submissions_new" &&
                        issue.status === "draft"
                      ) && (
                        <button
                          className="text-button"
                          onClick={() => void resolve(issue)}
                        >
                          {issue.category === "submissions_new"
                            ? "Mark triaged"
                            : issue.category === "integration_failures"
                              ? "Acknowledge"
                              : "Resolve"}
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="control-empty">
              <CheckCircle2 />
              <strong>This category is clear.</strong>
              <span>
                No records match the current filters. ProgramLoom will surface
                new work here automatically.
              </span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
