import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileInput,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  TriangleAlert,
  UsersRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { isoToZonedLocal, zonedLocalToIso } from "../lib/zonedTime";
import { SidebarUser } from "./SidebarUser";
import {
  EventTemplateStudio,
  SaveEventTemplateButton,
} from "./EventTemplateStudio";

type User = { id: string; email: string; name: string };
type Organization = {
  id: string;
  name: string;
  slug: string;
  storageMode: "native" | "airtable";
  role: string;
  eventCount: number;
};
type EventRecord = {
  id: string;
  name: string;
  slug: string;
  eventType: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  websiteUrl?: string | null;
  status: string;
  accessRole?: string;
};
type Feedback = { kind: "error" | "success"; message: string };
type MySubmission = {
  id: string;
  title: string;
  status: string;
  decisionState: string;
  submittedAt: string | null;
  updatedAt: string;
  formName: string;
  formSlug: string;
  editClosesAt: string | null;
  eventName: string;
  eventSlug: string;
  organizationName: string;
  organizationSlug: string;
};
type AirtableStatus = {
  configured: boolean;
  pending: number;
  failed: number;
  lastCompletedAt: string | null;
  lastSyncedAt: string | null;
  conflicts: Array<{
    id: string;
    entityType: string;
    direction: "push" | "pull";
    reason: string;
    createdAt: string;
  }>;
  resources: Array<{ lastSuccessAt: string | null; lastError: string | null }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
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

export function Dashboard({ user }: { user: User }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [airtableStatus, setAirtableStatus] = useState<AirtableStatus>();
  const [editingEvent, setEditingEvent] = useState<EventRecord>();
  const [savingEvent, setSavingEvent] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const selected = organizations.find(
    (organization) => organization.id === selectedId,
  );
  const canOrganize =
    selected !== undefined && ["owner", "admin"].includes(selected.role);

  useEffect(() => {
    api<{ submissions: MySubmission[] }>("/api/public/my-submissions")
      .then(({ submissions }) => setMySubmissions(submissions ?? []))
      .catch(() => setMySubmissions([]));
    api<{ organizations: Organization[] }>("/api/organizations")
      .then(({ organizations: items }) => {
        setOrganizations(items);
        const requested = new URLSearchParams(window.location.search).get(
          "organization",
        );
        setSelectedId(
          items.some((item) => item.id === requested)
            ? (requested ?? items[0]?.id)
            : items[0]?.id,
        );
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    api<{ events: EventRecord[] }>(`/api/organizations/${selectedId}/events`)
      .then(({ events: items }) => setEvents(items))
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
  }, [selectedId]);

  useEffect(() => {
    setAirtableStatus(undefined);
    if (
      !selectedId ||
      selected?.storageMode !== "airtable" ||
      !["owner", "admin"].includes(selected.role)
    )
      return;
    api<AirtableStatus>(
      `/api/integrations/organizations/${selectedId}/airtable`,
    )
      .then(setAirtableStatus)
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
  }, [selectedId, selected?.role, selected?.storageMode]);

  async function syncAirtable() {
    if (!selectedId) return;
    setSyncing(true);
    setFeedback(undefined);
    try {
      const result = await api<{ status: AirtableStatus }>(
        `/api/integrations/organizations/${selectedId}/airtable/sync`,
        { method: "POST" },
      );
      setAirtableStatus(result.status);
      setFeedback({ kind: "success", message: "Airtable sync completed." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Airtable sync failed.",
      });
    } finally {
      setSyncing(false);
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const { organization } = await api<{ organization: Organization }>(
        "/api/organizations",
        {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            storageMode:
              form.get("storageMode") === "airtable" ? "airtable" : "native",
          }),
        },
      );
      setOrganizations((current) => [...current, organization]);
      setSelectedId(organization.id);
      setFeedback({
        kind: "success",
        message: `${organization.name} is ready.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create the workspace.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function updateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEvent) return;
    setSavingEvent(true);
    setFeedback(undefined);
    const form = new FormData(event.currentTarget);
    const timezone = String(form.get("timezone"));
    try {
      const result = await api<{
        event: EventRecord;
        calendar: { updated: number; failed: number };
      }>(`/api/events/${editingEvent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          timezone,
          startsAt: zonedLocalToIso(String(form.get("startsAt")), timezone),
          endsAt: zonedLocalToIso(String(form.get("endsAt")), timezone),
          venueName: form.get("venueName") || null,
          websiteUrl: form.get("websiteUrl") || null,
        }),
      });
      setEvents((current) =>
        current.map((item) =>
          item.id === result.event.id ? { ...item, ...result.event } : item,
        ),
      );
      setEditingEvent(undefined);
      setFeedback({
        kind: result.calendar.failed ? "error" : "success",
        message: result.calendar.failed
          ? `Event details were saved, but ${result.calendar.failed} calendar update needs attention.`
          : `Event details were saved${result.calendar.updated ? ` and ${result.calendar.updated} calendar ${result.calendar.updated === 1 ? "invitation was" : "invitations were"} updated` : ""}. Next, open the Control Room to review readiness.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not update the event.",
      });
    } finally {
      setSavingEvent(false);
    }
  }

  if (loading)
    return (
      <div className="workspace-loading" aria-busy="true">
        <LoaderCircle className="spin" /> Loading your workspaces…
      </div>
    );
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <a className="wordmark sidebar-wordmark" href="/">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </a>
        <div className="workspace-switcher">
          <label htmlFor="workspace">Workspace</label>
          <select
            id="workspace"
            value={selectedId ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={!organizations.length}
          >
            {!organizations.length && (
              <option value="">No workspace yet</option>
            )}
            {organizations.map((organization) => (
              <option value={organization.id} key={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
        <nav className="app-nav" aria-label="Workspace">
          <a className="active" href="/app">
            <CalendarDays size={18} /> Events
          </a>
          {canOrganize && (
            <>
              <a href="/app/team">
                <UsersRound size={18} /> Team
              </a>
              <a
                href={`/app/crm${selectedId ? `?organization=${selectedId}` : ""}`}
              >
                <Building2 size={18} /> Speaker CRM
              </a>
            </>
          )}
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="kicker">ProgramLoom workspace</p>
            <h1>{selected ? selected.name : "Welcome to ProgramLoom"}</h1>
            {selected && canOrganize && (
              <p>
                Open an event's Control Room to see what blocks readiness and
                move accepted proposals through delivery, onboarding,
                scheduling, and publication.
              </p>
            )}
          </div>
          {canOrganize && selected && (
            <span
              className={`storage-pill ${
                airtableStatus?.failed || airtableStatus?.conflicts.length
                  ? "storage-pill-warning"
                  : ""
              }`}
            >
              <CheckCircle2 size={14} />{" "}
              {selected.storageMode === "airtable"
                ? airtableStatus?.failed || airtableStatus?.conflicts.length
                  ? "Airtable needs attention"
                  : airtableStatus?.pending
                    ? `${airtableStatus.pending} sync pending`
                    : "Airtable healthy"
                : "ProgramLoom storage"}
            </span>
          )}
        </header>
        {feedback && (
          <div
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        {!organizations.length ? (
          <section
            className="onboarding-card"
            aria-labelledby="workspace-title"
          >
            <div className="step-count">Step 1 of 2</div>
            <Building2 size={30} />
            <h2 id="workspace-title">Create your event workspace</h2>
            <p>
              Workspaces keep team access, speaker history, and multiple events
              together.
            </p>
            <form onSubmit={createOrganization}>
              <label>
                Workspace name
                <input
                  name="name"
                  placeholder="Example Events"
                  required
                  minLength={2}
                />
              </label>
              <label className="check-row">
                <input type="checkbox" name="storageMode" value="airtable" />{" "}
                <span>
                  <strong>Use Airtable as the source of truth</strong>
                  <small>
                    Best for teams that manage operational data in Airtable.
                  </small>
                </span>
              </label>
              <button className="button button-large" disabled={submitting}>
                {submitting ? "Creating…" : "Create workspace"}
                <ArrowRight size={18} />
              </button>
            </form>
          </section>
        ) : events.length ? (
          <section>
            <div className="content-heading">
              <div>
                <p className="kicker">Your events</p>
                <h2>Keep every program moving.</h2>
              </div>
              {canOrganize && (
                <button
                  className="button button-small"
                  onClick={() =>
                    document.getElementById("new-event")?.scrollIntoView()
                  }
                >
                  <Plus size={16} /> Create event
                </button>
              )}
            </div>
            <div className="event-grid">
              {events.map((item) => (
                <article
                  className="event-card"
                  key={item.id}
                  id={`event-${item.id}`}
                  tabIndex={-1}
                >
                  <div className="event-status">{item.status}</div>
                  <h3>{item.name}</h3>
                  <p>
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeZone: item.timezone,
                    }).format(new Date(item.startsAt))}
                    –
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeZone: item.timezone,
                    }).format(new Date(item.endsAt))}
                  </p>
                  <span>{item.venueName || "Venue to be confirmed"}</span>
                  <a
                    href={`/app/events/${item.id}/${
                      item.accessRole === "reviewer"
                        ? "reviews"
                        : item.accessRole === "speaker"
                          ? "speakers"
                          : "control-room"
                    }`}
                  >
                    {item.accessRole === "reviewer"
                      ? "Open review queue"
                      : item.accessRole === "speaker"
                        ? "Open speaker portal"
                        : "Open Control Room"}{" "}
                    <ArrowRight size={15} />
                  </a>
                  {selected && ["owner", "admin"].includes(selected.role) && (
                    <>
                      <button
                        className="text-button event-edit-button"
                        type="button"
                        onClick={() => setEditingEvent(item)}
                      >
                        <Pencil size={14} /> Edit event details
                      </button>
                      <SaveEventTemplateButton
                        eventId={item.id}
                        eventName={item.name}
                      />
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="empty-events">
            <CalendarDays size={34} />
            <h2>
              {canOrganize
                ? "Your first program starts here."
                : "No event access is assigned yet."}
            </h2>
            <p>
              {canOrganize
                ? "Create the event shell now; CFP, speakers, agenda, and publishing stay connected to it."
                : "Ask an organizer to invite you to the event where you will review or speak."}
            </p>
          </section>
        )}
        {selected?.storageMode === "airtable" && airtableStatus && (
          <section
            className="integration-card"
            aria-labelledby="airtable-sync-title"
          >
            <div>
              <p className="kicker">Data integration</p>
              <h2 id="airtable-sync-title">Airtable sync</h2>
              <p>
                {airtableStatus.configured
                  ? airtableStatus.lastSyncedAt
                    ? `Last synchronized ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(airtableStatus.lastSyncedAt))}.`
                    : "Ready for its first synchronization."
                  : "Airtable credentials are not configured."}
              </p>
              <div
                className="integration-health-summary"
                aria-label="Airtable sync health"
              >
                <span>{airtableStatus.pending} pending</span>
                <span>{airtableStatus.failed} failed</span>
                <span>{airtableStatus.conflicts.length} open conflicts</span>
              </div>
            </div>
            <button
              className="button button-ghost button-small"
              onClick={syncAirtable}
              disabled={syncing || !airtableStatus.configured}
            >
              <RefreshCw className={syncing ? "spin" : ""} size={15} />
              {syncing
                ? "Recovering…"
                : airtableStatus.failed || airtableStatus.conflicts.length
                  ? "Recover integration"
                  : "Sync now"}
            </button>
            {(airtableStatus.failed > 0 ||
              airtableStatus.conflicts.length > 0) && (
              <div className="integration-alert" role="alert">
                <TriangleAlert size={18} />
                <div>
                  <strong>
                    {airtableStatus.conflicts.length} unresolved sync{" "}
                    {airtableStatus.conflicts.length === 1
                      ? "conflict"
                      : "conflicts"}
                  </strong>
                  <p>
                    {airtableStatus.conflicts[0]?.reason ??
                      "A queued record could not be synchronized."}
                  </p>
                </div>
              </div>
            )}
          </section>
        )}
        {mySubmissions.length > 0 && (
          <section aria-labelledby="my-proposals-title">
            <div className="content-heading">
              <div>
                <p className="kicker">Your submissions</p>
                <h2 id="my-proposals-title">Proposals you submitted</h2>
                <p>
                  {canOrganize
                    ? "You also submitted these proposals. They are separate from the events you organize above."
                    : "Track each draft, submitted proposal, and decision in one place."}
                </p>
              </div>
            </div>
            <div className="event-grid">
              {mySubmissions.map((submission) => (
                <article className="event-card" key={submission.id}>
                  <div className="event-status">
                    {submission.decisionState !== "none"
                      ? submission.decisionState.replaceAll("_", " ")
                      : submission.status}
                  </div>
                  <FileInput size={20} />
                  <h3>{submission.title || "Untitled proposal"}</h3>
                  <p>
                    {submission.eventName} · {submission.formName}
                  </p>
                  <span>
                    Updated{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                    }).format(new Date(submission.updatedAt))}
                  </span>
                  <a
                    href={`/c/${submission.organizationSlug}/${submission.eventSlug}/${submission.formSlug}`}
                  >
                    {submission.status === "draft"
                      ? "Continue proposal"
                      : "Open proposal"}{" "}
                    <ArrowRight size={15} />
                  </a>
                </article>
              ))}
            </div>
          </section>
        )}
        {canOrganize && selected && (
          <section
            className="new-event-card"
            id="new-event"
            aria-labelledby="new-event-title"
          >
            <div className="step-count">
              {events.length ? "Add another" : "Step 2 of 2"}
            </div>
            <h2 id="new-event-title">Create an event</h2>
            <p>
              Start from a maintained template, an organization template, or a
              prior event. You will review exactly what is copied before the
              draft is created.
            </p>
            <EventTemplateStudio
              organizationId={selected.id}
              events={events}
              onCreated={(created) => {
                setEvents((current) => [...current, created]);
                setOrganizations((current) =>
                  current.map((organization) =>
                    organization.id === selected.id
                      ? {
                          ...organization,
                          eventCount: Number(organization.eventCount) + 1,
                        }
                      : organization,
                  ),
                );
                setFeedback({
                  kind: "success",
                  message: `${created.name} was created as a draft from reusable configuration.`,
                });
              }}
            />
          </section>
        )}
        {editingEvent && (
          <div
            className="modal-backdrop"
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditingEvent(undefined);
            }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                setEditingEvent(undefined);
            }}
          >
            <section
              className="modal-card event-edit-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-event-title"
            >
              <header>
                <div>
                  <p className="kicker">Event identity</p>
                  <h2 id="edit-event-title">Edit event details</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close event details"
                  autoFocus
                  onClick={() => setEditingEvent(undefined)}
                >
                  <X size={20} />
                </button>
              </header>
              <p>
                These details appear across organizer, speaker, public agenda,
                and calendar surfaces. Existing invitations are updated in place
                when calendar delivery is enabled.
              </p>
              <form onSubmit={updateEvent}>
                <label className="wide">
                  Event name
                  <input
                    name="name"
                    defaultValue={editingEvent.name}
                    required
                    minLength={2}
                  />
                </label>
                <label>
                  Timezone
                  <input
                    name="timezone"
                    defaultValue={editingEvent.timezone}
                    required
                  />
                </label>
                <label>
                  Venue
                  <input
                    name="venueName"
                    defaultValue={editingEvent.venueName ?? ""}
                    placeholder="Harbor Conference Center"
                  />
                </label>
                <label>
                  Starts
                  <input
                    type="datetime-local"
                    name="startsAt"
                    defaultValue={isoToZonedLocal(
                      editingEvent.startsAt,
                      editingEvent.timezone,
                    )}
                    required
                  />
                </label>
                <label>
                  Ends
                  <input
                    type="datetime-local"
                    name="endsAt"
                    defaultValue={isoToZonedLocal(
                      editingEvent.endsAt,
                      editingEvent.timezone,
                    )}
                    required
                  />
                </label>
                <label className="wide">
                  Event website <span className="muted">optional</span>
                  <input
                    type="url"
                    name="websiteUrl"
                    defaultValue={editingEvent.websiteUrl ?? ""}
                    placeholder="https://example.com"
                  />
                </label>
                <div className="event-edit-actions wide">
                  <button
                    className="button button-ghost"
                    type="button"
                    onClick={() => setEditingEvent(undefined)}
                  >
                    Cancel
                  </button>
                  <button className="button" disabled={savingEvent}>
                    {savingEvent ? "Saving…" : "Save event details"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
