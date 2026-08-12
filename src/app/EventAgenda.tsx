import {
  ArrowLeft,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  Clock3,
  Code2,
  FileInput,
  Files,
  GripVertical,
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
import { MutationResultPanel } from "./MutationResultPanel";

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
  format: string | null;
  trackId: string | null;
  speakerIds: string[];
  speakerNames: string[];
};
type AgendaView = "list" | "day" | "week" | "track" | "room";
type DragSource = { kind: "item" | "session"; id: string; title: string };
type MoveTarget = {
  source: DragSource;
  roomId: string;
  startsAt: string;
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
type ScheduleConflict = {
  id: string;
  agendaItemId: string;
  conflictingItemId: string;
  conflictType: "room" | "speaker";
  summary: string;
  status: "open";
  attemptedRoomId: string | null;
  attemptedStartsAt: string;
  attemptedEndsAt: string;
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

function eventSlots(event: EventRecord, day: string) {
  const slots: string[] = [];
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  for (
    let cursor = start;
    cursor <= end && slots.length < 48;
    cursor += 30 * 60_000
  ) {
    const value = new Date(cursor).toISOString();
    if (dayKey(value, event.timezone) === day) slots.push(value);
  }
  return slots;
}

function updateAgendaUrl(input: {
  view: AgendaView;
  day: string;
  track: string;
  room: string;
}) {
  const query = new URLSearchParams(window.location.search);
  query.set("view", input.view);
  input.day ? query.set("date", input.day) : query.delete("date");
  input.track ? query.set("track", input.track) : query.delete("track");
  input.room ? query.set("room", input.room) : query.delete("room");
  window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
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
  const initialQuery = useRef(new URLSearchParams(window.location.search));
  const [event, setEvent] = useState<EventRecord>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const initialView = initialQuery.current.get("view");
  const [view, setView] = useState<AgendaView>(
    ["list", "day", "week", "track", "room"].includes(initialView ?? "")
      ? (initialView as AgendaView)
      : "day",
  );
  const [selectedDay, setSelectedDay] = useState(
    initialQuery.current.get("date") ?? "",
  );
  const [trackFilter, setTrackFilter] = useState(
    initialQuery.current.get("track") ?? "",
  );
  const [roomFilter, setRoomFilter] = useState(
    initialQuery.current.get("room") ?? "",
  );
  const [dragged, setDragged] = useState<DragSource>();
  const [movePreview, setMovePreview] = useState<MoveTarget>();
  const [liveMessage, setLiveMessage] = useState("");
  const [assistPreviewCount, setAssistPreviewCount] = useState<number>();
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
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
      conflicts: ScheduleConflict[];
    }>(`/api/agenda/admin/events/${eventId}`);
    setEvent(result.event);
    setTracks(result.tracks);
    setRooms(result.rooms);
    setSessions(result.sessions);
    setSpeakers(result.speakers ?? []);
    setItems(result.items);
    setConflicts(result.conflicts ?? []);
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
  useEffect(() => {
    updateAgendaUrl({
      view,
      day: selectedDay,
      track: trackFilter,
      room: roomFilter,
    });
  }, [view, selectedDay, trackFilter, roomFilter]);

  async function act<T>(
    operation: () => Promise<T>,
    message: string | ((result: T) => string),
  ) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await operation();
      await load();
      setFeedback({
        kind: "success",
        message: typeof message === "function" ? message(result) : message,
      });
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
        setAssistPreviewCount(apply ? undefined : result.placements.length);
      },
      apply
        ? "Conflict-free suggestions applied."
        : "Conflict-free suggestions generated; choose Apply to persist them.",
    );
  }
  function sourceItem(source: DragSource) {
    return source.kind === "item"
      ? items.find((item) => item.id === source.id)
      : undefined;
  }
  async function commitMove(target: MoveTarget) {
    const item = sourceItem(target.source);
    const session =
      target.source.kind === "session"
        ? sessions.find((candidate) => candidate.id === target.source.id)
        : item?.submissionId
          ? sessions.find((candidate) => candidate.id === item.submissionId)
          : undefined;
    const duration =
      item?.startsAt && item.endsAt
        ? Math.max(
            15 * 60_000,
            new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime(),
          )
        : 45 * 60_000;
    const endsAt = new Date(
      new Date(target.startsAt).getTime() + duration,
    ).toISOString();
    await act(
      () =>
        target.source.kind === "session"
          ? api(`/api/agenda/admin/events/${eventId}/placements`, {
              method: "POST",
              body: JSON.stringify({
                submissionId: target.source.id,
                roomId: target.roomId || null,
                trackId: session?.trackId ?? null,
                startsAt: target.startsAt,
                endsAt,
              }),
            })
          : api(
              `/api/agenda/admin/events/${eventId}/items/${target.source.id}`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  roomId: target.roomId || null,
                  trackId: item?.trackId ?? null,
                  startsAt: target.startsAt,
                  endsAt,
                  reschedule: false,
                }),
              },
            ),
      `${target.source.title} moved. Its agenda draft and calendar state are updated; review conflicts, then publish the agenda.`,
    );
    setMovePreview(undefined);
    setDragged(undefined);
    setLiveMessage(`${target.source.title} moved successfully.`);
  }
  function requestMove(roomId: string, startsAt: string, source = dragged) {
    if (!source) return;
    const item = sourceItem(source);
    const target = { source, roomId, startsAt };
    if (item?.startsAt) setMovePreview(target);
    else void commitMove(target);
  }
  function beginDrag(source: DragSource, event?: React.DragEvent) {
    setDragged(source);
    event?.dataTransfer.setData("text/plain", `${source.kind}:${source.id}`);
    if (event?.dataTransfer) event.dataTransfer.effectAllowed = "move";
    setLiveMessage(
      `${source.title} selected. Drop it into a room and time, or use its scheduling form for keyboard placement.`,
    );
  }
  function finishPointerDrag(event: React.PointerEvent, source: DragSource) {
    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-drop-room][data-drop-start]");
    if (element)
      requestMove(
        element.dataset.dropRoom ?? "",
        element.dataset.dropStart ?? "",
        source,
      );
    else
      setLiveMessage(
        `${source.title} was not moved. Drop it over a room and time cell.`,
      );
  }
  async function publish() {
    await act(
      () =>
        api<{ published: number; excluded: number; calendarFailures: number }>(
          `/api/agenda/admin/events/${eventId}/publish`,
          {
            method: "POST",
            body: "{}",
          },
        ),
      (result) => {
        const excluded = result.excluded
          ? ` ${result.excluded} unapproved ${result.excluded === 1 ? "item remains" : "items remain"} private and in draft.`
          : "";
        const calendar = result.calendarFailures
          ? ` ${result.calendarFailures} calendar ${result.calendarFailures === 1 ? "update needs" : "updates need"} attention.`
          : "";
        return `${result.published} approved ${result.published === 1 ? "item is" : "items are"} now public.${excluded}${calendar} Next, verify the five attendee widgets.`;
      },
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
  const activeDay =
    days.some((day) => day.key === selectedDay) && selectedDay
      ? selectedDay
      : days[0]?.key || "";
  const visibleScheduled = scheduled.filter(
    (item) =>
      (!trackFilter || item.trackId === trackFilter) &&
      (!roomFilter || item.roomId === roomFilter),
  );
  const dayItems = visibleScheduled.filter(
    (item) => dayKey(item.startsAt!, event!.timezone) === activeDay,
  );
  const dayStarts = event
    ? [
        ...new Set([
          ...eventSlots(event, activeDay),
          ...dayItems.map((item) => item.startsAt!),
        ]),
      ].sort()
    : [];
  const agendaColumns: Room[] = dayItems.some((item) => !item.roomId)
    ? [...rooms, { id: "", name: "Room unassigned", capacity: null }]
    : rooms.filter((room) => !roomFilter || room.id === roomFilter);
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: event!.timezone,
      weekday: view === "week" || view === "list" ? "short" : undefined,
      month: view === "list" ? "short" : undefined,
      day: view === "list" ? "numeric" : undefined,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const trackColor = (trackId: string | null) =>
    tracks.find((track) => track.id === trackId)?.color ?? "#64748b";
  const itemContext = (item: AgendaItem) => {
    const session = item.submissionId
      ? sessions.find((candidate) => candidate.id === item.submissionId)
      : undefined;
    return [
      item.roomName || "Room unassigned",
      item.trackName || "No track",
      session?.format || item.itemType,
      session?.speakerNames.join(", ") || "No speaker assigned",
    ].join(" · ");
  };
  const dragCard = (item: AgendaItem) => {
    const source: DragSource = {
      kind: "item",
      id: item.id,
      title: item.title,
    };
    return (
      <article
        id={`agenda-item-${item.id}`}
        className="agenda-move-card"
        style={{ borderInlineStartColor: trackColor(item.trackId) }}
        tabIndex={-1}
        draggable
        onDragStart={(event) => beginDrag(source, event)}
        onDragEnd={() => setDragged(undefined)}
      >
        <button
          type="button"
          className="agenda-drag-handle"
          aria-label={`Drag ${item.title} to another room or time`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            beginDrag(source);
          }}
          onPointerUp={(event) => finishPointerDrag(event, source)}
        >
          <GripVertical size={15} aria-hidden="true" /> Move
        </button>
        <strong>{item.title}</strong>
        <span>{itemContext(item)}</span>
        {item.startsAt && <time>{formatTime(item.startsAt)}</time>}
        <a href={`#agenda-placement-${item.id}`}>Schedule with form</a>
      </article>
    );
  };
  const groupedItems =
    view === "track"
      ? tracks.map((track) => ({
          id: track.id,
          label: track.name,
          items: visibleScheduled.filter((item) => item.trackId === track.id),
        }))
      : view === "room"
        ? rooms.map((room) => ({
            id: room.id,
            label: room.name,
            items: visibleScheduled.filter((item) => item.roomId === room.id),
          }))
        : days.map((day) => ({
            id: day.key,
            label: new Intl.DateTimeFormat("en-US", {
              timeZone: event!.timezone,
              weekday: "long",
              month: "short",
              day: "numeric",
            }).format(new Date(day.value)),
            items: visibleScheduled.filter(
              (item) => dayKey(item.startsAt!, event!.timezone) === day.key,
            ),
          }));
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
            onClick={() => {
              setFeedback(undefined);
              const target = document.getElementById("assisted-scheduling");
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
              target?.focus({ preventScroll: true });
            }}
          >
            <Sparkles size={15} /> Open assisted scheduling options
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
          <MutationResultPanel
            feedback={feedback}
            focusRef={feedbackRef}
            nextAction={{
              label: "Review calendar invitations",
              href: `/app/events/${eventId}/calendar`,
            }}
          />
        )}
        {conflicts.length > 0 && (
          <section className="agenda-conflict-panel" aria-labelledby="agenda-conflicts-title">
            <div>
              <p className="kicker">Scheduling blockers</p>
              <h2 id="agenda-conflicts-title">Resolve open conflicts</h2>
            </div>
            <ul>
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  <div>
                    <strong>{conflict.conflictType} conflict</strong>
                    <span>{conflict.summary}</span>
                  </div>
                  <a
                    className="button button-small"
                    href={`#agenda-placement-${conflict.agendaItemId}`}
                  >
                    Resolve conflict
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="sr-only" aria-live="polite">
          {liveMessage}
        </p>
        {movePreview && (
          <div className="modal-backdrop" role="presentation">
            <section
              className="confirmation-modal agenda-move-preview"
              role="dialog"
              aria-modal="true"
              aria-labelledby="agenda-move-title"
            >
              <button
                type="button"
                className="modal-close"
                aria-label="Close move preview"
                onClick={() => setMovePreview(undefined)}
              >
                Close
              </button>
              <h2 id="agenda-move-title">Preview schedule move</h2>
              <p>
                Move <strong>{movePreview.source.title}</strong> to{" "}
                {rooms.find((room) => room.id === movePreview.roomId)?.name ??
                  "Room unassigned"}
                {" at "}
                {formatTime(movePreview.startsAt)}?
              </p>
              <div className="consequence-note">
                <strong>What changes</strong>
                <p>
                  The agenda item returns to draft. Existing participant
                  calendar invitations keep the same UID, increase their
                  sequence, and receive the new room and time. Publish agenda
                  when the revised schedule is ready for attendees.
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setMovePreview(undefined)}
                >
                  Keep current placement
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void commitMove(movePreview)}
                >
                  Confirm move and update calendar
                </button>
              </div>
            </section>
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
              <div className="agenda-view-toolbar">
                <div role="group" aria-label="Agenda view">
                  {(["list", "day", "week", "track", "room"] as const).map(
                    (choice) => (
                      <button
                        type="button"
                        key={choice}
                        className={view === choice ? "active" : ""}
                        aria-pressed={view === choice}
                        onClick={() => setView(choice)}
                      >
                        {choice[0].toUpperCase() + choice.slice(1)}
                      </button>
                    ),
                  )}
                </div>
                <label>
                  Track
                  <select
                    value={trackFilter}
                    onChange={(input) => setTrackFilter(input.target.value)}
                  >
                    <option value="">All tracks</option>
                    {tracks.map((track) => (
                      <option value={track.id} key={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Room
                  <select
                    value={roomFilter}
                    onChange={(input) => setRoomFilter(input.target.value)}
                  >
                    <option value="">All rooms</option>
                    {rooms.map((room) => (
                      <option value={room.id} key={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
              <div className="agenda-unscheduled-strip">
                <div>
                  <strong>Unscheduled sessions</strong>
                  <span>
                    Drag one into the Day grid, or use Schedule with form.
                  </span>
                </div>
                {[
                  ...unscheduled.map((item) => ({
                    kind: "item" as const,
                    id: item.id,
                    title: item.title,
                  })),
                  ...availableSessions.map((session) => ({
                    kind: "session" as const,
                    id: session.id,
                    title: session.title,
                  })),
                ].map((source) => (
                  <article
                    key={`${source.kind}-${source.id}`}
                    draggable
                    onDragStart={(input) => beginDrag(source, input)}
                    onDragEnd={() => setDragged(undefined)}
                  >
                    <button
                      type="button"
                      className="agenda-drag-handle"
                      aria-label={`Drag ${source.title} into the agenda`}
                      onPointerDown={(input) => {
                        input.currentTarget.setPointerCapture(input.pointerId);
                        beginDrag(source);
                      }}
                      onPointerUp={(input) => finishPointerDrag(input, source)}
                    >
                      <GripVertical size={15} aria-hidden="true" /> Move
                    </button>
                    <strong>{source.title}</strong>
                    {source.kind === "item" ? (
                      <a href={`#agenda-placement-${source.id}`}>
                        Schedule with form
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          addSession(
                            sessions.find((item) => item.id === source.id)!,
                          )
                        }
                      >
                        Add, then schedule with form
                      </button>
                    )}
                  </article>
                ))}
                {!unscheduled.length && !availableSessions.length && (
                  <p>Every accepted session has a placement.</p>
                )}
              </div>
              {view === "day" ? (
                <div className="agenda-grid-scroll">
                  <table
                    className="agenda-grid organizer-agenda-grid"
                    aria-label="Organizer agenda day grid"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        {agendaColumns.map((room) => (
                          <th scope="col" key={room.id || "unassigned"}>
                            {room.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dayStarts.map((start) => (
                        <tr key={start}>
                          <th scope="row">{formatTime(start)}</th>
                          {agendaColumns.map((room) => {
                            const cellItems = dayItems.filter(
                              (candidate) =>
                                candidate.startsAt === start &&
                                (candidate.roomId ?? "") === room.id,
                            );
                            return (
                              <td
                                key={room.id || "unassigned"}
                                className={dragged ? "agenda-drop-ready" : ""}
                                data-drop-room={room.id}
                                data-drop-start={start}
                                onDragOver={(input) => {
                                  input.preventDefault();
                                  input.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(input) => {
                                  input.preventDefault();
                                  requestMove(room.id, start);
                                }}
                              >
                                {cellItems.map((item) => (
                                  <div key={item.id}>{dragCard(item)}</div>
                                ))}
                                {!cellItems.length && (
                                  <span className="agenda-grid-empty">
                                    Drop here
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
              ) : view === "list" ? (
                <div className="agenda-view-list">
                  {visibleScheduled.map((item) => (
                    <div key={item.id}>{dragCard(item)}</div>
                  ))}
                </div>
              ) : (
                <div className={`agenda-group-view agenda-group-${view}`}>
                  {groupedItems.map((group) => (
                    <section key={group.id}>
                      <h3>{group.label}</h3>
                      {group.items.map((item) => (
                        <div key={item.id}>{dragCard(item)}</div>
                      ))}
                      {!group.items.length && <p>No matching sessions.</p>}
                    </section>
                  ))}
                </div>
              )}
              {!visibleScheduled.length && (
                <div className="empty-panel">
                  <p>No scheduled sessions match this view.</p>
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
                {item.startsAt && !item.cancelledAt && (
                  <button
                    className="button button-small button-ghost"
                    type="button"
                    onClick={() => clear(item)}
                    disabled={busy}
                    aria-label={`Clear placement for ${item.title}`}
                  >
                    Clear placement
                  </button>
                )}
                {item.itemType === "session" && !item.cancelledAt && (
                  <button
                    className="button button-small button-danger"
                    type="button"
                    onClick={() => cancel(item)}
                    disabled={busy}
                    aria-label={`Cancel session: ${item.title}`}
                  >
                    Cancel session
                  </button>
                )}
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
                  type="submit"
                  className="button button-ghost"
                  name="apply"
                  value="false"
                  disabled={busy}
                >
                  Preview conflict-free schedule
                </button>
                <button
                  type="submit"
                  className="button"
                  name="apply"
                  value="true"
                  disabled={busy || !unscheduled.length}
                  aria-label={`Build schedule automatically for ${unscheduled.length} unscheduled ${unscheduled.length === 1 ? "session" : "sessions"}`}
                >
                  Build schedule automatically
                </button>
              </div>
              {assistPreviewCount !== undefined && (
                <p className="field-hint" role="status">
                  {assistPreviewCount} conflict-free placement
                  {assistPreviewCount === 1 ? "" : "s"} ready. Choose Build
                  schedule automatically to persist{" "}
                  {assistPreviewCount === 1 ? "it" : "them"}.
                </p>
              )}
            </form>
          </aside>
        </div>
      </main>
    </EventChrome>
  );
}
