import {
  ArrowLeft,
  CalendarCheck2,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  XCircle,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { captureProductEvent } from "../lib/telemetry";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";

type User = { id: string; email: string; name: string };
type Settings = {
  deliveryRule: "on_placement" | "on_publication" | "manual";
  organizerName: string;
  organizerEmail: string;
  sendUpdatesAutomatically: boolean;
};
type CalendarRecord = {
  id: string;
  agendaItemId: string;
  speakerId: string;
  attendeeName: string;
  attendeeEmail: string;
  uid: string;
  sequence: number;
  state: "active" | "cancelled";
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  roomName: string | null;
  deliveryStatus: string | null;
  updatedAt: string;
};
type Revision = {
  id: string;
  calendarRecordId: string;
  messageId: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  reason: string;
  deliveryStatus: string | null;
  createdAt: string;
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

export function EventCalendar({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [records, setRecords] = useState<CalendarRecord[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  }>();

  async function load() {
    try {
      const result = await api<{
        settings: Settings | null;
        records: CalendarRecord[];
        revisions: Revision[];
      }>(`/api/calendar/admin/events/${eventId}`);
      setSettings(result.settings);
      setRecords(result.records);
      setRevisions(result.revisions);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Calendar history could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  const revisionsByRecord = useMemo(() => {
    const grouped = new Map<string, Revision[]>();
    for (const revision of revisions)
      grouped.set(revision.calendarRecordId, [
        ...(grouped.get(revision.calendarRecordId) ?? []),
        revision,
      ]);
    return grouped;
  }, [revisions]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/api/calendar/admin/events/${eventId}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          deliveryRule: data.get("deliveryRule"),
          organizerName: data.get("organizerName"),
          organizerEmail: data.get("organizerEmail"),
          sendUpdatesAutomatically:
            data.get("sendUpdatesAutomatically") === "on",
        }),
      });
      captureProductEvent("calendar_settings_updated", { event_id: eventId });
      setFeedback({
        kind: "success",
        message: "Calendar delivery rules saved.",
      });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Settings could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sync(
    record: CalendarRecord,
    operation: "create_or_update" | "cancel" | "reschedule",
  ) {
    const label =
      operation === "cancel"
        ? "send a cancellation"
        : operation === "reschedule"
          ? "resume this cancelled invitation"
          : "send the current calendar state";
    if (
      !window.confirm(
        `Confirm that you want to ${label} to ${record.attendeeName}.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        `/api/calendar/admin/events/${eventId}/items/${record.agendaItemId}/sync`,
        {
          method: "POST",
          body: JSON.stringify({ operation, speakerId: record.speakerId }),
        },
      );
      captureProductEvent("calendar_manual_action", {
        event_id: eventId,
        operation,
      });
      setFeedback({
        kind: "success",
        message:
          operation === "cancel"
            ? "Calendar cancellation prepared for durable delivery. Confirm the CANCEL revision and public removal next."
            : operation === "reschedule"
              ? "Calendar invitation explicitly rescheduled with the same UID and a higher sequence."
              : record.sequence === 0
                ? "Calendar invitation prepared for durable delivery. Its UID and sequence are recorded below."
                : "Calendar update prepared with the same UID and a higher sequence.",
      });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Calendar action failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resend(record: CalendarRecord) {
    if (
      !window.confirm(
        `Resend the latest calendar revision to ${record.attendeeName}?`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        `/api/calendar/admin/events/${eventId}/records/${record.id}/resend`,
        { method: "POST" },
      );
      setFeedback({
        kind: "success",
        message: "The latest revision was queued again and recorded.",
      });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The revision could not be resent.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="loading-page" aria-busy="true">
        <LoaderCircle className="spin" /> Loading calendar lifecycle…
      </main>
    );

  return (
    <div className="event-workspace">
      <aside className="event-sidebar">
        <a className="wordmark" href="/">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </a>
        <a className="back-link" href={`/app/events/${eventId}/agenda`}>
          <ArrowLeft size={15} /> Agenda
        </a>
        <div className="event-identity">
          <small>Participant delivery</small>
          <strong>Calendar lifecycle</strong>
          <span>{records.length} records</span>
        </div>
        <EventLifecycleNav eventId={eventId} active="calendar" />
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="event-main calendar-main">
        <header className="event-heading">
          <div>
            <p className="kicker">Participant calendar lifecycle</p>
            <h1>One event, updated in place.</h1>
            <p>
              Stable UIDs, increasing sequences, delivery evidence, and explicit
              cancellation or rescheduling.
            </p>
          </div>
          <button
            className="button button-ghost"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </header>
        {feedback && (
          <div
            role="status"
            className={`form-status form-status-${feedback.kind}`}
          >
            {feedback.message}
          </div>
        )}
        <section className="calendar-settings panel-card">
          <div>
            <p className="kicker">
              <Settings2 size={14} /> Delivery rules
            </p>
            <h2>When invitations move</h2>
          </div>
          <form onSubmit={saveSettings}>
            <label>
              Delivery trigger
              <select
                name="deliveryRule"
                defaultValue={settings?.deliveryRule ?? "on_placement"}
              >
                <option value="on_placement">When placed or changed</option>
                <option value="on_publication">When agenda is published</option>
                <option value="manual">Manual only</option>
              </select>
            </label>
            <label>
              Organizer name
              <input
                name="organizerName"
                required
                defaultValue={settings?.organizerName ?? "ProgramLoom"}
              />
            </label>
            <label>
              Organizer email
              <input
                name="organizerEmail"
                type="email"
                required
                defaultValue={
                  settings?.organizerEmail ??
                  "notifications@mail.programloom.com"
                }
              />
            </label>
            <label className="checkbox-row">
              <input
                name="sendUpdatesAutomatically"
                type="checkbox"
                defaultChecked={settings?.sendUpdatesAutomatically ?? true}
              />{" "}
              Send material updates automatically
            </label>
            <button className="button" disabled={busy}>
              Save rules
            </button>
          </form>
        </section>
        <section
          className="calendar-records"
          aria-labelledby="calendar-records-title"
        >
          <div className="section-heading">
            <p className="kicker">Current state</p>
            <h2 id="calendar-records-title">Participant invitations</h2>
          </div>
          {!records.length ? (
            <div className="empty-state">
              <CalendarCheck2 size={28} />
              <h3>No participant invitations yet</h3>
              <p>
                Place an accepted session with an assigned speaker, or publish
                under the publication delivery rule.
              </p>
              <a
                className="button button-small"
                href={`/app/events/${eventId}/agenda`}
              >
                Schedule a session
              </a>
            </div>
          ) : (
            records.map((record) => (
              <article className="calendar-record panel-card" key={record.id}>
                <div className="calendar-record-heading">
                  <div>
                    <h3>{record.title}</h3>
                    <p>
                      {record.attendeeName} · {record.attendeeEmail}
                    </p>
                  </div>
                  <span
                    className={`submission-status status-${record.state === "active" ? "accepted" : "declined"}`}
                  >
                    {record.state}
                  </span>
                </div>
                <dl className="calendar-facts">
                  <div>
                    <dt>Sequence</dt>
                    <dd>{record.sequence}</dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>{record.deliveryStatus ?? "prepared"}</dd>
                  </div>
                  <div>
                    <dt>Room</dt>
                    <dd>{record.roomName ?? "Not assigned"}</dd>
                  </div>
                  <div>
                    <dt>UID</dt>
                    <dd>
                      <code>{record.uid}</code>
                    </dd>
                  </div>
                </dl>
                <div className="inline-actions">
                  {record.state === "cancelled" ? (
                    <button
                      className="button button-small"
                      disabled={busy}
                      onClick={() => void sync(record, "reschedule")}
                    >
                      <RotateCcw size={14} /> Explicitly reschedule
                    </button>
                  ) : (
                    <>
                      <button
                        className="button button-small"
                        disabled={busy}
                        onClick={() => void sync(record, "create_or_update")}
                      >
                        <RefreshCw size={14} />{" "}
                        {record.sequence === 0
                          ? "Send calendar invitation"
                          : "Send calendar update"}
                      </button>
                      <button
                        className="button button-small button-danger"
                        disabled={busy}
                        onClick={() => void sync(record, "cancel")}
                      >
                        <XCircle size={14} /> Cancel calendar invitation
                      </button>
                    </>
                  )}
                  <button
                    className="button button-small button-ghost"
                    disabled={busy}
                    onClick={() => void resend(record)}
                  >
                    <Send size={14} /> Resend latest
                  </button>
                </div>
                <details>
                  <summary>
                    Revision history (
                    {revisionsByRecord.get(record.id)?.length ?? 0})
                  </summary>
                  <ol className="calendar-history">
                    {(revisionsByRecord.get(record.id) ?? []).map(
                      (revision) => (
                        <li key={revision.id}>
                          <span>
                            <strong>{revision.method}</strong> sequence{" "}
                            {revision.sequence} · {revision.reason} ·{" "}
                            {revision.deliveryStatus ?? "prepared"}
                          </span>
                          <a
                            className="text-link"
                            href={`/api/calendar/admin/events/${eventId}/revisions/${revision.id}/ics`}
                          >
                            <Download size={14} /> Inspect ICS
                          </a>
                        </li>
                      ),
                    )}
                  </ol>
                </details>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
