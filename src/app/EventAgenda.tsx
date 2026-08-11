import {
  ArrowLeft,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  Clock3,
  Code2,
  FileInput,
  Files,
  Inbox,
  LoaderCircle,
  MapPin,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";
import { EventPageGuide } from "./EventPageGuide";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  organizationName?: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};
type Track = { id: string; name: string; color: string };
type Room = { id: string; name: string; capacity: number | null };
type Session = {
  id: string;
  title: string;
  abstract: string;
  trackId: string | null;
  speakerIds: string[];
  speakerNames: string[];
};
type Speaker = {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
};
type AgendaItem = {
  id: string;
  submissionId: string | null;
  trackId: string | null;
  roomId: string | null;
  itemType: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  version: number;
  cancelledAt: string | null;
  roomName: string | null;
  trackName: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string };
    conflicts?: { message: string }[];
  };
  if (!response.ok)
    throw new Error(
      result.conflicts?.map((conflict) => conflict.message).join(" ") ||
        result.error?.message ||
        "The request could not be completed.",
    );
  return result;
}

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function dayKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function eventDays(event: EventRecord) {
  const days: Array<{ key: string; value: string }> = [];
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  for (
    let cursor = start;
    cursor <= end && days.length < 31;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const value = cursor.toISOString();
    const key = dayKey(value, event.timezone);
    if (!days.some((day) => day.key === key)) days.push({ key, value });
  }
  const endKey = dayKey(event.endsAt, event.timezone);
  if (!days.some((day) => day.key === endKey))
    days.push({ key: endKey, value: event.endsAt });
  return days;
}

function EventChrome({
  event,
  eventId,
  user,
  children,
}: {
  event?: EventRecord;
  eventId: string;
  user: User;
  children: React.ReactNode;
}) {
  return (
    <div className="event-workspace">
      <aside className="event-sidebar">
        <a className="wordmark" href="/">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </a>
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> All events
        </a>
        <div className="event-identity">
          <small>{event?.organizationName}</small>
          <strong>{event?.name}</strong>
          <span>{event?.status}</span>
        </div>
        <EventLifecycleNav eventId={eventId} active="agenda" />
        <SidebarUser user={user} />
      </aside>
      {children}
    </div>
  );
}

export function EventAgenda({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventRecord>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedDay, setSelectedDay] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const feedbackRef = useRef<HTMLDivElement>(null);

  async function load() {
    const result = await api<{
      event: EventRecord;
      tracks: Track[];
      rooms: Room[];
      sessions: Session[];
      speakers: Speaker[];
      items: AgendaItem[];
    }>(`/api/agenda/admin/events/${eventId}`);
    setEvent(result.event);
    setTracks(result.tracks);
    setRooms(result.rooms);
    setSessions(result.sessions);
    setSpeakers(result.speakers ?? []);
    setItems(result.items);
  }
  useEffect(() => {
    load()
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [eventId]);
  useEffect(() => {
    if (!items.length || !window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [items]);
  useEffect(() => {
    if (!feedback) return;
    window.requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
      feedbackRef.current?.focus({ preventScroll: true });
    });
  }, [feedback]);

  async function act(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await operation();
      await load();
      setFeedback({ kind: "success", message });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The change could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function createRoom(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    await act(
      () =>
        api(`/api/agenda/admin/events/${eventId}/rooms`, {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            capacity: data.get("capacity")
              ? Number(data.get("capacity"))
              : null,
          }),
        }),
      "Room added.",
    );
    form.reset();
  }
  async function createTrack(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    await act(
      () =>
        api(`/api/events/${eventId}/tracks`, {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            color: data.get("color"),
            description: null,
          }),
        }),
      "Track added.",
    );
    form.reset();
  }
  async function addSession(session: Session) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await api<{ item: AgendaItem }>(
        `/api/agenda/admin/events/${eventId}/items`,
        {
          method: "POST",
          body: JSON.stringify({
            submissionId: session.id,
            itemType: "session",
            trackId: session.trackId,
          }),
        },
      );
      await load();
      setFeedback({
        kind: "success",
        message: `${session.title} added. Choose its room and time in the highlighted placement form.`,
      });
      window.requestAnimationFrame(() => {
        const target = document.getElementById(
          `agenda-placement-${result.item.id}`,
        );
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The session could not be added to the agenda.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function addAllAcceptedSessions() {
    if (!availableSessions.length) return;
    await act(
      () =>
        Promise.all(
          availableSessions.map((session) =>
            api(`/api/agenda/admin/events/${eventId}/items`, {
              method: "POST",
              body: JSON.stringify({
                submissionId: session.id,
                itemType: "session",
                trackId: session.trackId,
              }),
            }),
          ),
        ),
      `${availableSessions.length} accepted ${availableSessions.length === 1 ? "session was" : "sessions were"} added to the agenda. Set each room and time below, or use assisted scheduling.`,
    );
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".agenda-placement")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  async function addBlock(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    await act(
      () =>
        api(`/api/agenda/admin/events/${eventId}/items`, {
          method: "POST",
          body: JSON.stringify({
            itemType: data.get("itemType"),
            title: data.get("title"),
            description: data.get("description") || null,
          }),
        }),
      "Agenda block added.",
    );
    form.reset();
  }
  async function place(
    item: AgendaItem,
    formEvent: FormEvent<HTMLFormElement>,
  ) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    const session = item.submissionId
      ? sessions.find((candidate) => candidate.id === item.submissionId)
      : undefined;
    await act(
      async () => {
        if (session) {
          const speakerIds = data.getAll("speakerIds").map(String);
          await api(
            `/api/agenda/admin/events/${eventId}/sessions/${session.id}/speakers`,
            {
              method: "PUT",
              body: JSON.stringify({ speakerIds }),
            },
          );
        }
        return api(`/api/agenda/admin/events/${eventId}/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            roomId: data.get("roomId"),
            trackId: data.get("trackId") || null,
            startsAt: new Date(String(data.get("startsAt"))).toISOString(),
            endsAt: new Date(String(data.get("endsAt"))).toISOString(),
            reschedule: Boolean(item.cancelledAt),
          }),
        });
      },
      item.cancelledAt
        ? `${item.title} explicitly rescheduled and restored. Review its calendar sequence, then publish the agenda.`
        : `${item.title} scheduled without conflicts. Next, send its calendar invitation or publish the agenda.`,
    );
  }
  async function cancel(item: AgendaItem) {
    if (
      !window.confirm(
        `Cancel “${item.title}”? This removes it from public agendas and sends participant calendar cancellations.`,
      )
    )
      return;
    await act(
      () =>
        api(`/api/agenda/admin/events/${eventId}/items/${item.id}/cancel`, {
          method: "POST",
          body: "{}",
        }),
      `${item.title} cancelled and removed from public agendas.`,
    );
  }
  async function removeBlock(item: AgendaItem) {
    if (
      !window.confirm(
        `Remove “${item.title}”? This removes the block from organizer and public agendas.`,
      )
    )
      return;
    await act(
      () =>
        api(`/api/agenda/admin/events/${eventId}/items/${item.id}`, {
          method: "DELETE",
        }),
      `${item.title} removed from the agenda.`,
    );
  }
  async function clear(item: AgendaItem) {
    if (
      !window.confirm(
        `Clear the placement for “${item.title}”? The session will return to the unscheduled queue and its room and time will be removed.`,
      )
    )
      return;
    await act(
      () =>
        api(`/api/agenda/admin/events/${eventId}/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ roomId: null, startsAt: null, endsAt: null }),
        }),
      `${item.title} returned to unscheduled. Next, choose a new room and time before publishing the agenda.`,
    );
  }
  async function assist(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    const apply =
      (
        (formEvent.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null
      )?.value === "true";
    await act(
      async () => {
        const result = await api<{ placements: unknown[] }>(
          `/api/agenda/admin/events/${eventId}/assist`,
          {
            method: "POST",
            body: JSON.stringify({
              startsAt: new Date(String(data.get("startsAt"))).toISOString(),
              endsAt: new Date(String(data.get("endsAt"))).toISOString(),
              durationMinutes: Number(data.get("durationMinutes")),
              apply,
            }),
          },
        );
        if (!result.placements.length)
          throw new Error(
            "No conflict-free placements fit inside that window.",
          );
      },
      apply
        ? "Conflict-free suggestions applied."
        : "Conflict-free suggestions generated; choose Apply to persist them.",
    );
  }
  async function publish() {
    await act(
      () =>
        api(`/api/agenda/admin/events/${eventId}/publish`, {
          method: "POST",
          body: "{}",
        }),
      "Agenda published and the event is active. Public views now use this schedule; next, verify the five attendee widgets.",
    );
  }

  if (loading)
    return (
      <main className="loading-page">
        <LoaderCircle className="spin" /> Loading agenda…
      </main>
    );
  const scheduled = items.filter((item) => item.startsAt && !item.cancelledAt);
  const unscheduled = items.filter(
    (item) => !item.startsAt && !item.cancelledAt,
  );
  const availableSessions = sessions.filter(
    (session) => !items.some((item) => item.submissionId === session.id),
  );
  const days = event ? eventDays(event) : [];
  const activeDay = selectedDay || days[0]?.key || "";
  const dayItems = scheduled.filter(
    (item) => dayKey(item.startsAt!, event!.timezone) === activeDay,
  );
  const dayStarts = [...new Set(dayItems.map((item) => item.startsAt!))].sort();
  const agendaColumns: Room[] = dayItems.some((item) => !item.roomId)
    ? [...rooms, { id: "", name: "Room unassigned", capacity: null }]
    : rooms;
  return (
    <EventChrome event={event} eventId={eventId} user={user}>
      <main id="main-content" className="event-main agenda-main">
        <header className="event-heading">
          <div>
            <p className="kicker">Program schedule</p>
            <h1>Schedule sessions without conflicts.</h1>
            <p>
              Place approved sessions into rooms and times. ProgramLoom checks
              speaker and room collisions before you publish.
            </p>
          </div>
          <button
            className="button button-ghost"
            type="button"
            onClick={() =>
              document
                .getElementById("assisted-scheduling")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <Sparkles size={15} /> Build schedule automatically
          </button>
          <button
            className="button"
            onClick={publish}
            disabled={busy || !items.length}
          >
            Publish agenda
          </button>
          <a
            className="button button-ghost"
            href={`/app/events/${eventId}/calendar`}
          >
            Calendar lifecycle
          </a>
        </header>
        <EventPageGuide eventId={eventId} surface="agenda" />
        {feedback && (
          <div
            ref={feedbackRef}
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
            tabIndex={-1}
          >
            {feedback.message}
          </div>
        )}
        <div className="agenda-layout">
          <section className="agenda-canvas">
            <div className="agenda-summary">
              <span>
                <strong>{scheduled.length}</strong> scheduled
              </span>
              <span>
                <strong>{unscheduled.length}</strong> unscheduled
              </span>
              <span>
                <strong>{rooms.length}</strong> rooms
              </span>
            </div>
            <section className="organizer-agenda" aria-label="Agenda timeline">
              <div
                className="agenda-day-tabs"
                role="tablist"
                aria-label="Event days"
              >
                {days.map((day) => (
                  <button
                    key={day.key}
                    role="tab"
                    aria-selected={day.key === activeDay}
                    onClick={() => setSelectedDay(day.key)}
                  >
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: event!.timezone,
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    }).format(new Date(day.value))}
                  </button>
                ))}
              </div>
              <div className="agenda-grid-scroll">
                <table
                  className="agenda-grid organizer-agenda-grid"
                  aria-label="Organizer agenda grid"
                >
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      {agendaColumns.map((room) => (
                        <th scope="col" key={room.id}>
                          {room.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dayStarts.map((start) => (
                      <tr key={start}>
                        <th scope="row">
                          {new Intl.DateTimeFormat("en-US", {
                            timeZone: event!.timezone,
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(start))}
                        </th>
                        {agendaColumns.map((room) => {
                          const item = dayItems.find(
                            (candidate) =>
                              candidate.startsAt === start &&
                              (candidate.roomId ?? "") === room.id,
                          );
                          return (
                            <td key={room.id}>
                              {item ? (
                                <article
                                  id={`agenda-item-${item.id}`}
                                  tabIndex={-1}
                                >
                                  <strong>{item.title}</strong>
                                  <span>{item.trackName || item.itemType}</span>
                                  <a href={`#agenda-placement-${item.id}`}>
                                    Edit placement
                                  </a>
                                  <button
                                    className="button button-small button-ghost"
                                    onClick={() => clear(item)}
                                    aria-label={`Clear placement for ${item.title}`}
                                    disabled={busy}
                                  >
                                    Clear placement
                                  </button>
                                  {item.itemType === "session" ? (
                                    <button
                                      className="button button-small button-danger"
                                      onClick={() => cancel(item)}
                                      aria-label={`Cancel session: ${item.title}`}
                                      disabled={busy}
                                    >
                                      Cancel session
                                    </button>
                                  ) : (
                                    <button
                                      className="button button-small button-ghost"
                                      onClick={() => removeBlock(item)}
                                      disabled={busy}
                                    >
                                      Remove block
                                    </button>
                                  )}
                                </article>
                              ) : (
                                <span
                                  className="agenda-grid-empty"
                                  aria-hidden="true"
                                >
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!dayItems.length && (
                <div className="empty-panel">
                  <p>No sessions are scheduled for this day.</p>
                  <a href="#accepted-sessions">Add an accepted session</a>
                </div>
              )}
            </section>
            <h2>Place or move items</h2>
            {items.map((item) => (
              <form
                className="agenda-placement"
                id={`agenda-placement-${item.id}`}
                tabIndex={-1}
                onSubmit={(event) => place(item, event)}
                key={item.id}
              >
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.itemType} · v{item.version}
                    {item.cancelledAt ? " · cancelled" : ""}
                  </small>
                </div>
                <label>
                  Room
                  <select
                    name="roomId"
                    aria-label={`Room for ${item.title}`}
                    defaultValue={item.roomId ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    {rooms.map((room) => (
                      <option value={room.id} key={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                {item.submissionId &&
                  speakers.length > 0 &&
                  sessions.some(
                    (session) => session.id === item.submissionId,
                  ) && (
                    <label>
                      Speakers
                      <select
                        name="speakerIds"
                        multiple
                        defaultValue={
                          sessions.find(
                            (session) => session.id === item.submissionId,
                          )?.speakerIds ?? []
                        }
                        aria-label={`Speakers for ${item.title}`}
                        required
                      >
                        {speakers.map((speaker) => (
                          <option value={speaker.id} key={speaker.id}>
                            {speaker.firstName} {speaker.lastName}
                            {speaker.company ? ` · ${speaker.company}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                <label>
                  Track
                  <select
                    name="trackId"
                    aria-label={`Track for ${item.title}`}
                    defaultValue={item.trackId ?? ""}
                  >
                    <option value="">No track</option>
                    {tracks.map((track) => (
                      <option value={track.id} key={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Starts
                  <input
                    name="startsAt"
                    aria-label={`Start time for ${item.title}`}
                    type="datetime-local"
                    defaultValue={localInput(item.startsAt)}
                    required
                  />
                </label>
                <label>
                  Ends
                  <input
                    name="endsAt"
                    aria-label={`End time for ${item.title}`}
                    type="datetime-local"
                    defaultValue={localInput(item.endsAt)}
                    required
                  />
                </label>
                <button
                  className="button button-small"
                  aria-label={`${
                    item.cancelledAt ? "Reschedule" : "Schedule session"
                  }: ${item.title}`}
                  disabled={busy}
                >
                  {item.cancelledAt ? (
                    <>
                      <RotateCcw size={14} /> Reschedule
                    </>
                  ) : (
                    "Schedule session"
                  )}
                </button>
                {item.itemType !== "session" && !item.cancelledAt && (
                  <button
                    className="button button-small button-ghost"
                    type="button"
                    onClick={() => removeBlock(item)}
                    disabled={busy}
                  >
                    Remove block
                  </button>
                )}
              </form>
            ))}
          </section>
          <aside className="agenda-tools">
            <form className="operations-card" onSubmit={createRoom}>
              <MapPin size={20} />
              <h2>Rooms</h2>
              <label>
                Name
                <input name="name" placeholder="Main stage" required />
              </label>
              <label>
                Capacity
                <input name="capacity" type="number" min="0" />
              </label>
              <button className="button" disabled={busy}>
                <Plus size={14} /> Add room
              </button>
            </form>
            <form className="operations-card" onSubmit={createTrack}>
              <span className="track-swatch" />
              <h2>Tracks</h2>
              <label>
                Name
                <input name="name" placeholder="Engineering" required />
              </label>
              <label>
                Color
                <input name="color" type="color" defaultValue="#315c45" />
              </label>
              <button className="button" disabled={busy}>
                <Plus size={14} /> Add track
              </button>
            </form>
            <section
              className="operations-card"
              id="accepted-sessions"
              tabIndex={-1}
            >
              <FileInput size={20} />
              <h2>Accepted sessions</h2>
              {availableSessions.length > 1 && (
                <button
                  className="button button-small"
                  type="button"
                  onClick={addAllAcceptedSessions}
                  disabled={busy}
                >
                  <Plus size={14} /> Add all accepted sessions to agenda
                </button>
              )}
              {availableSessions.map((session) => (
                <button
                  className="session-add"
                  onClick={() => addSession(session)}
                  aria-label={`Add accepted session to agenda: ${session.title}`}
                  key={session.id}
                >
                  <span>
                    <strong>{session.title}</strong>
                    <small>{session.speakerNames.join(", ")}</small>
                  </span>
                  <span className="session-add-action">
                    <Plus size={14} /> Add to agenda
                  </span>
                </button>
              ))}
              {!availableSessions.length && (
                <small>Every accepted session is on the agenda.</small>
              )}
            </section>
            <form className="operations-card" onSubmit={addBlock}>
              <Clock3 size={20} />
              <h2>Add a block</h2>
              <label>
                Type
                <select name="itemType">
                  <option value="break">Break</option>
                  <option value="hold">Hold</option>
                </select>
              </label>
              <label>
                Title
                <input name="title" placeholder="Lunch" required />
              </label>
              <label>
                Description
                <textarea name="description" rows={2} />
              </label>
              <button className="button" disabled={busy}>
                <Plus size={14} /> Add block
              </button>
            </form>
            <form
              className="operations-card assist-card"
              id="assisted-scheduling"
              onSubmit={assist}
              tabIndex={-1}
            >
              <Sparkles size={20} />
              <h2>Assisted scheduling</h2>
              <p>
                A greedy scheduler fills rooms while avoiding room and
                shared-speaker collisions.
              </p>
              <label>
                Window starts
                <input
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={localInput(event?.startsAt ?? null)}
                  required
                />
              </label>
              <label>
                Window ends
                <input
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={localInput(event?.endsAt ?? null)}
                  required
                />
              </label>
              <label>
                Session minutes
                <input
                  name="durationMinutes"
                  type="number"
                  min="15"
                  max="240"
                  defaultValue="45"
                  required
                />
              </label>
              <div className="assist-actions">
                <button
                  className="button button-ghost"
                  name="apply"
                  value="false"
                  disabled={busy}
                >
                  Preview
                </button>
                <button
                  className="button"
                  name="apply"
                  value="true"
                  disabled={busy || !unscheduled.length}
                >
                  Apply
                </button>
              </div>
            </form>
          </aside>
        </div>
      </main>
    </EventChrome>
  );
}
