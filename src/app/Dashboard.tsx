import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  Plus,
  RefreshCw,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SidebarUser } from "./SidebarUser";

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
  status: string;
};
type Feedback = { kind: "error" | "success"; message: string };
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [airtableStatus, setAirtableStatus] = useState<AirtableStatus>();
  const [feedback, setFeedback] = useState<Feedback>();
  const selected = organizations.find(
    (organization) => organization.id === selectedId,
  );

  useEffect(() => {
    api<{ organizations: Organization[] }>("/api/organizations")
      .then(({ organizations: items }) => {
        setOrganizations(items);
        setSelectedId(items[0]?.id);
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

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedId) return;
    setSubmitting(true);
    setFeedback(undefined);
    const form = new FormData(formElement);
    try {
      const { event: created } = await api<{ event: EventRecord }>(
        `/api/organizations/${selectedId}/events`,
        {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            eventType: form.get("eventType"),
            venueName: form.get("venueName"),
            websiteUrl: form.get("websiteUrl"),
            timezone: form.get("timezone"),
            startsAt: new Date(String(form.get("startsAt"))).toISOString(),
            endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          }),
        },
      );
      setEvents((current) => [...current, created]);
      setOrganizations((current) =>
        current.map((organization) =>
          organization.id === selectedId
            ? {
                ...organization,
                eventCount: Number(organization.eventCount) + 1,
              }
            : organization,
        ),
      );
      formElement.reset();
      setFeedback({
        kind: "success",
        message: `${created.name} was created as a draft.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create the event.",
      });
    } finally {
      setSubmitting(false);
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
          <a href="/app/team">
            <UsersRound size={18} /> Team
          </a>
          <a
            href={`/app/crm${selectedId ? `?organization=${selectedId}` : ""}`}
          >
            <Building2 size={18} /> Speaker CRM
          </a>
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="kicker">Program workspace</p>
            <h1>{selected ? selected.name : "Welcome to ProgramLoom"}</h1>
          </div>
          {selected && (
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
                    : "Airtable source"
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
            </div>
            <button
              className="button button-ghost button-small"
              onClick={syncAirtable}
              disabled={syncing || !airtableStatus.configured}
            >
              <RefreshCw className={syncing ? "spin" : ""} size={15} />
              {syncing ? "Syncing…" : "Sync now"}
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
              <button
                className="button button-small"
                onClick={() =>
                  document.getElementById("new-event")?.scrollIntoView()
                }
              >
                <Plus size={16} /> New event
              </button>
            </div>
            <div className="event-grid">
              {events.map((item) => (
                <article className="event-card" key={item.id}>
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
                  <a href={`/app/events/${item.id}`}>
                    Open program <ArrowRight size={15} />
                  </a>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="empty-events">
            <CalendarDays size={34} />
            <h2>Your first program starts here.</h2>
            <p>
              Create the event shell now; CFP, speakers, agenda, and publishing
              stay connected to it.
            </p>
          </section>
        )}
        {selected && (
          <section
            className="new-event-card"
            id="new-event"
            aria-labelledby="new-event-title"
          >
            <div className="step-count">
              {events.length ? "Add another" : "Step 2 of 2"}
            </div>
            <h2 id="new-event-title">Create an event</h2>
            <form className="event-form" onSubmit={createEvent}>
              <label className="wide">
                Event name
                <input name="name" placeholder="DevFlow Conf 2027" required />
              </label>
              <label>
                Type
                <select name="eventType" defaultValue="conference">
                  <option value="conference">Conference</option>
                  <option value="summit">Summit</option>
                  <option value="festival">Festival</option>
                  <option value="internal">Internal program</option>
                </select>
              </label>
              <label>
                Timezone
                <input
                  name="timezone"
                  defaultValue={
                    Intl.DateTimeFormat().resolvedOptions().timeZone
                  }
                  required
                />
              </label>
              <label>
                Starts
                <input type="datetime-local" name="startsAt" required />
              </label>
              <label>
                Ends
                <input type="datetime-local" name="endsAt" required />
              </label>
              <label>
                Venue
                <input name="venueName" placeholder="Moscone West" />
              </label>
              <label>
                Website
                <input
                  type="url"
                  name="websiteUrl"
                  placeholder="https://example.com"
                />
              </label>
              <button
                className="button button-large wide"
                disabled={submitting}
              >
                {submitting ? "Creating event…" : "Create draft event"}
                <ArrowRight size={18} />
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
