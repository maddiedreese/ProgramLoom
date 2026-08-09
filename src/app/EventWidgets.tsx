import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  FileInput,
  Files,
  Inbox,
  LoaderCircle,
  Pencil,
  Plus,
  UsersRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SidebarUser } from "./SidebarUser";
import { captureProductEvent } from "../lib/telemetry";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  name: string;
  organizationName: string;
  status?: string;
  primaryColor?: string;
};
type Track = { id: string; name: string };
type Widget = {
  id: string;
  publicKey: string;
  name: string;
  widgetType: string;
  config: {
    theme: string;
    primaryColor: string;
    showSearch: boolean;
    showFilters: boolean;
    trackIds: string[];
    fields: string[];
  };
};
async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed.");
  return result;
}

export function EventWidgets({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventRecord>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Widget>();
  const [feedback, setFeedback] = useState<{
    message: string;
    error?: boolean;
  }>();
  async function load() {
    const result = await api<{
      event: EventRecord;
      tracks: Track[];
      widgets: Widget[];
    }>(`/api/widgets/admin/events/${eventId}`);
    setEvent(result.event);
    setTracks(result.tracks);
    setWidgets(result.widgets);
  }
  useEffect(() => {
    load()
      .catch((error: Error) =>
        setFeedback({ message: error.message, error: true }),
      )
      .finally(() => setLoading(false));
  }, [eventId]);
  async function create(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    try {
      await api(
        `/api/widgets/admin/events/${eventId}${editing ? `/${editing.id}` : ""}`,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({
            name: data.get("name"),
            widgetType: data.get("widgetType"),
            config: {
              theme: data.get("theme"),
              primaryColor: data.get("primaryColor"),
              showSearch: data.get("showSearch") === "on",
              showFilters: data.get("showFilters") === "on",
              trackIds: data.getAll("trackIds"),
              fields: data.getAll("fields"),
            },
          }),
        },
      );
      form.reset();
      const wasEditing = Boolean(editing);
      setEditing(undefined);
      await load();
      captureProductEvent(
        wasEditing ? "public_widget_updated" : "public_widget_created",
        {
          event_id: eventId,
          widget_type: data.get("widgetType"),
        },
      );
      setFeedback({
        message: wasEditing
          ? "Live widget updated everywhere."
          : "Live widget created.",
      });
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error ? error.message : "Could not save widget.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="loading-page">
        <LoaderCircle className="spin" /> Loading widget studio…
      </main>
    );
  return (
    <div className="event-workspace">
      <aside className="event-sidebar">
        <a className="wordmark" href="/">
          <span className="mark">PL</span>ProgramLoom
        </a>
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> All events
        </a>
        <div className="event-identity">
          <small>{event?.organizationName}</small>
          <strong>{event?.name}</strong>
        </div>
        <nav className="event-nav">
          <a href={`/app/events/${eventId}`}>
            <FileInput size={18} /> CFP
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
            <CheckCircle2 size={18} /> Agenda
          </a>
          <a className="active" href={`/app/events/${eventId}/widgets`}>
            <Code2 size={18} /> Public widgets
          </a>
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main className="event-main widgets-main">
        <header className="event-heading">
          <div>
            <p className="kicker">Embed studio</p>
            <h1>Publish everywhere.</h1>
            <p>
              Five live views, one source of truth, with durable feeds and
              personal calendars.
            </p>
          </div>
        </header>
        {feedback && (
          <div
            className={`form-status ${feedback.error ? "form-status-error" : "form-status-success"}`}
          >
            {feedback.message}
          </div>
        )}
        <div className="widget-admin-layout">
          <form
            className="widget-builder"
            key={editing?.id ?? "new"}
            onSubmit={create}
          >
            <h2>{editing ? "Edit live widget" : "Create a widget"}</h2>
            <label>
              Name
              <input
                name="name"
                placeholder="Main conference agenda"
                defaultValue={editing?.name}
                required
              />
            </label>
            <label>
              View
              <select
                name="widgetType"
                defaultValue={editing?.widgetType ?? "agenda"}
              >
                <option value="sessions">Sessions</option>
                <option value="speakers">Speakers</option>
                <option value="agenda">Agenda</option>
                <option value="itinerary">Personal itinerary</option>
                <option value="gallery">Gallery</option>
              </select>
            </label>
            <div className="widget-builder-row">
              <label>
                Theme
                <select
                  name="theme"
                  defaultValue={editing?.config.theme ?? "light"}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                Brand color
                <input
                  name="primaryColor"
                  type="color"
                  defaultValue={
                    editing?.config.primaryColor ??
                    event?.primaryColor ??
                    "#315c45"
                  }
                />
              </label>
            </div>
            <label className="check-row">
              <input
                name="showSearch"
                type="checkbox"
                defaultChecked={editing?.config.showSearch ?? true}
              />
              <span>
                <strong>Search</strong>
                <small>Let visitors search live content.</small>
              </span>
            </label>
            <label className="check-row">
              <input
                name="showFilters"
                type="checkbox"
                defaultChecked={editing?.config.showFilters ?? true}
              />
              <span>
                <strong>Track filter</strong>
                <small>Expose available program tracks.</small>
              </span>
            </label>
            <fieldset>
              <legend>Filter to tracks</legend>
              {tracks.map((track) => (
                <label key={track.id}>
                  <input
                    name="trackIds"
                    type="checkbox"
                    value={track.id}
                    defaultChecked={editing?.config.trackIds.includes(track.id)}
                  />
                  {track.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Visible fields</legend>
              {[
                "title",
                "abstract",
                "speakers",
                "track",
                "room",
                "time",
                "company",
                "bio",
              ].map((field) => (
                <label key={field}>
                  <input
                    name="fields"
                    type="checkbox"
                    value={field}
                    defaultChecked={
                      editing
                        ? editing.config.fields.includes(field)
                        : [
                            "title",
                            "speakers",
                            "track",
                            "room",
                            "time",
                          ].includes(field)
                    }
                  />
                  {field}
                </label>
              ))}
            </fieldset>
            <button className="button button-large" disabled={busy}>
              {editing ? <Pencil size={16} /> : <Plus size={16} />}
              {editing ? "Update everywhere" : "Create live widget"}
            </button>
            {editing && (
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setEditing(undefined)}
              >
                <X size={16} /> Cancel editing
              </button>
            )}
          </form>
          <section className="widget-config-list">
            <h2>Live widgets</h2>
            {widgets.map((widget) => {
              const src = `https://programloom.com/embed/${widget.publicKey}`;
              const snippet = `<iframe src="${src}" title="${widget.name}" loading="lazy" style="width:100%;min-height:720px;border:0" allow="clipboard-write"></iframe>`;
              return (
                <article key={widget.id}>
                  <div>
                    <em>{widget.widgetType}</em>
                    <h3>{widget.name}</h3>
                    <span>
                      {widget.config.theme} · {widget.config.fields.length}{" "}
                      fields
                    </span>
                  </div>
                  <div className="widget-links">
                    <button type="button" onClick={() => setEditing(widget)}>
                      <Pencil size={14} /> Edit
                    </button>
                    <a href={src} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> Preview
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(snippet)}
                    >
                      <Clipboard size={14} /> Copy embed
                    </button>
                    <a
                      href={`/api/widgets/public/${widget.publicKey}/feed.json`}
                    >
                      JSON
                    </a>
                    <a
                      href={`/api/widgets/public/${widget.publicKey}/feed.xml`}
                    >
                      XML
                    </a>
                    <a
                      href={`/api/widgets/public/${widget.publicKey}/agenda.ics`}
                    >
                      iCal
                    </a>
                  </div>
                  <code>{snippet}</code>
                </article>
              );
            })}
            {!widgets.length && (
              <div className="submission-empty">
                <Code2 size={28} />
                <h2>No widgets yet</h2>
                <p>Create the first live public surface.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
