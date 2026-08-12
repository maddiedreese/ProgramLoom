import {
  CalendarPlus,
  Clock3,
  Download,
  LoaderCircle,
  MapPin,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { captureProductEvent } from "../lib/telemetry";

type WidgetConfig = {
  publicKey: string;
  name: string;
  widgetType: "sessions" | "speakers" | "agenda" | "itinerary" | "gallery";
  config: {
    theme: "light" | "dark";
    primaryColor: string;
    showSearch: boolean;
    showFilters: boolean;
    fields: string[];
  };
};
type Track = { id: string; name: string; color: string };
type Session = {
  id: string;
  title: string;
  abstract: string;
  format: string | null;
  durationMinutes: number | null;
  trackId: string | null;
  speakerIds: string[];
  speakerNames: string[];
};
type Speaker = {
  id: string;
  firstName: string;
  lastName: string;
  pronouns: string | null;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
  social: Record<string, string>;
};
type AgendaItem = {
  id: string;
  submissionId: string | null;
  trackId: string | null;
  itemType: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  roomName: string | null;
  trackName: string | null;
  trackColor: string | null;
};
type EventData = {
  id: string;
  name: string;
  organizationName: string;
  timezone: string;
  venueName: string | null;
  startsAt: string;
  endsAt: string;
};
type Payload = {
  widget: WidgetConfig;
  event: EventData;
  tracks: Track[];
  sessions: Session[];
  speakers: Speaker[];
  agenda: AgendaItem[];
};

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
function formatClock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
function dayKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}
function formatDay(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
function eventDayOptions(startsAt: string, endsAt: string, timeZone: string) {
  const options: Array<{ key: string; value: string }> = [];
  const end = new Date(endsAt).getTime();
  for (
    let cursor = new Date(startsAt).getTime();
    cursor <= end && options.length < 31;
    cursor += 86_400_000
  ) {
    const value = new Date(cursor).toISOString();
    const key = dayKey(value, timeZone);
    if (!options.some((option) => option.key === key))
      options.push({ key, value });
  }
  const endKey = dayKey(endsAt, timeZone);
  if (!options.some((option) => option.key === endKey))
    options.push({ key: endKey, value: endsAt });
  return options;
}
function icalStamp(value: string) {
  return new Date(value)
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
}
function icalText(value: string | null) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

export function PublicWidgetPage() {
  const { publicKey = "" } = useParams();
  const [data, setData] = useState<Payload>();
  const [search, setSearch] = useState("");
  const [track, setTrack] = useState("");
  const [format, setFormat] = useState("");
  const [location, setLocation] = useState("");
  const [expandedSession, setExpandedSession] = useState<string>();
  const [expandedSpeaker, setExpandedSpeaker] = useState<string>();
  const [showPersonalSchedule, setShowPersonalSchedule] = useState(false);
  const [exportFeedback, setExportFeedback] = useState("");
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`programloom-itinerary:${publicKey}`) ?? "[]",
      ) as string[];
    } catch {
      return [];
    }
  });
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch(`/api/widgets/public/${publicKey}`)
      .then(async (response) => {
        const result = (await response.json()) as Payload & {
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(result.error?.message ?? "Widget not found.");
        setData(result);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [publicKey]);
  useEffect(() => {
    localStorage.setItem(
      `programloom-itinerary:${publicKey}`,
      JSON.stringify(saved),
    );
  }, [publicKey, saved]);
  const filteredSessions = useMemo(
    () =>
      data?.sessions.filter((session) => {
        const placement = data.agenda.find(
          (item) => item.submissionId === session.id,
        );
        return (
          (!track || session.trackId === track) &&
          (!format || session.format === format) &&
          (!location || (placement?.roomName ?? "Location TBA") === location) &&
          `${session.title} ${session.abstract} ${session.speakerNames.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      }) ?? [],
    [data, format, location, search, track],
  );
  const filteredAgenda = useMemo(
    () =>
      data?.agenda.filter(
        (item) =>
          (!track || item.trackId === track) &&
          `${item.title} ${item.description ?? ""} ${item.roomName ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) ?? [],
    [data, search, track],
  );
  function toggle(itemId: string) {
    setSaved((current) => {
      const removing = current.includes(itemId);
      captureProductEvent(
        removing ? "itinerary_item_removed" : "itinerary_item_added",
        { widget_type: data?.widget.widgetType, event_id: data?.event.id },
      );
      return removing
        ? current.filter((id) => id !== itemId)
        : [...current, itemId];
    });
  }
  function downloadItinerary() {
    if (!data) return;
    captureProductEvent("itinerary_ics_exported", {
      event_id: data.event.id,
      item_count: saved.length,
    });
    const items = data.agenda.filter((item) => saved.includes(item.id));
    const events = items
      .map(
        (item) =>
          `BEGIN:VEVENT\r\nUID:${item.id}@programloom.com\r\nDTSTAMP:${icalStamp(new Date().toISOString())}\r\nDTSTART:${icalStamp(item.startsAt)}\r\nDTEND:${icalStamp(item.endsAt)}\r\nSUMMARY:${icalText(item.title)}\r\nLOCATION:${icalText(item.roomName)}\r\nDESCRIPTION:${icalText(item.description)}\r\nEND:VEVENT`,
      )
      .join("\r\n");
    const blob = new Blob(
      [
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ProgramLoom//Personal Itinerary//EN\r\n${events}\r\nEND:VCALENDAR\r\n`,
      ],
      { type: "text/calendar" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-itinerary.ics`;
    link.hidden = true;
    document.body.append(link);
    setExportFeedback(
      `ICS exported with ${items.length} ${items.length === 1 ? "session" : "sessions"}. Your saved itinerary is unchanged.`,
    );
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  if (error)
    return (
      <main className="widget-state">
        <strong>Widget unavailable</strong>
        <p>{error}</p>
      </main>
    );
  if (!data)
    return (
      <main className="widget-state">
        <LoaderCircle className="spin" /> Loading live program…
      </main>
    );
  const { widget, event } = data;
  const sessionFormats = [
    ...new Set(data.sessions.map((session) => session.format).filter(Boolean)),
  ] as string[];
  const sessionLocations = [
    ...new Set(
      data.sessions.map(
        (session) =>
          data.agenda.find((item) => item.submissionId === session.id)
            ?.roomName ?? "Location TBA",
      ),
    ),
  ].sort();
  const show = (field: string) => widget.config.fields.includes(field);
  const placementFor = (submissionId: string) =>
    data.agenda.find((item) => item.submissionId === submissionId);
  const filteredSpeakers = data.speakers
    .filter((speaker) =>
      `${speaker.firstName} ${speaker.lastName} ${speaker.jobTitle ?? ""} ${speaker.company ?? ""} ${speaker.bio ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort(
      (left, right) =>
        left.lastName.localeCompare(right.lastName) ||
        left.firstName.localeCompare(right.firstName),
    );
  return (
    <main
      className={`public-widget widget-${widget.widgetType} theme-${widget.config.theme}`}
      style={
        { "--widget-color": widget.config.primaryColor } as React.CSSProperties
      }
    >
      <header className="widget-header">
        <div>
          <small>{event.organizationName}</small>
          <h1>{widget.name}</h1>
          <p>
            {event.name}
            {event.venueName ? ` · ${event.venueName}` : ""}
          </p>
          <small className="widget-timezone">
            All program times use {event.timezone}.
          </small>
        </div>
        <a href="https://programloom.com" target="_blank" rel="noreferrer">
          Powered by ProgramLoom
        </a>
      </header>
      {(widget.config.showSearch || widget.config.showFilters) && (
        <div className="widget-controls">
          {widget.config.showSearch && (
            <label>
              <Search size={15} />
              <input
                aria-label="Search program"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search the program"
              />
            </label>
          )}
          {widget.config.showFilters && (
            <>
              <select
                aria-label="Filter by track"
                value={track}
                onChange={(event) => setTrack(event.target.value)}
              >
                <option value="">All tracks</option>
                {data.tracks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {widget.widgetType === "sessions" && (
                <>
                  <select
                    aria-label="Filter by format"
                    value={format}
                    onChange={(event) => setFormat(event.target.value)}
                  >
                    <option value="">All formats</option>
                    {sessionFormats.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  >
                    <option value="">All locations</option>
                    {sessionLocations.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </>
          )}
        </div>
      )}
      {widget.widgetType === "sessions" && (
        <section aria-label="Sessions">
          <p className="widget-result-count" aria-live="polite">
            {filteredSessions.length}{" "}
            {filteredSessions.length === 1 ? "session" : "sessions"}
          </p>
          <div className="widget-card-grid">
            {filteredSessions.map((session) => (
              <article className="widget-card" key={session.id}>
                <div className="widget-card-summary">
                  <span className="widget-icon">
                    <UsersRound size={18} />
                  </span>
                  <div>
                    <h2>{session.title}</h2>
                    <div className="widget-speaker-lines">
                      {data.speakers
                        .filter((speaker) =>
                          session.speakerIds.includes(speaker.id),
                        )
                        .map((speaker) => (
                          <p key={speaker.id}>
                            <strong>
                              {speaker.firstName} {speaker.lastName}
                            </strong>
                            {(speaker.jobTitle || speaker.company) && (
                              <span>
                                {speaker.jobTitle || "Speaker"}
                                {speaker.company ? ` · ${speaker.company}` : ""}
                              </span>
                            )}
                          </p>
                        ))}
                      {!session.speakerIds.length && (
                        <p>Speakers to be announced</p>
                      )}
                    </div>
                    {session.abstract && expandedSession !== session.id && (
                      <p className="widget-card-abstract">{session.abstract}</p>
                    )}
                    {(() => {
                      const placement = placementFor(session.id);
                      return (
                        <div className="widget-card-meta">
                          {placement?.startsAt && (
                            <span>
                              <Clock3 size={13} />{" "}
                              {formatTime(placement.startsAt, event.timezone)}–
                              {formatClock(placement.endsAt, event.timezone)}
                            </span>
                          )}
                          {placement && (
                            <span>
                              <MapPin size={13} />{" "}
                              {placement.roomName || "Location to be announced"}
                            </span>
                          )}
                          {session.format && <span>{session.format}</span>}
                          {session.trackId && (
                            <span>
                              {data.tracks.find(
                                (item) => item.id === session.trackId,
                              )?.name || "Track"}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      className="widget-detail-button"
                      aria-expanded={expandedSession === session.id}
                      onClick={() =>
                        setExpandedSession((current) =>
                          current === session.id ? undefined : session.id,
                        )
                      }
                    >
                      {expandedSession === session.id
                        ? "Close details"
                        : "View details"}
                    </button>
                  </div>
                </div>
                {expandedSession === session.id && (
                  <div className="widget-card-expanded">
                    <p>{session.abstract || "Details coming soon."}</p>
                    {session.trackId && (
                      <em>
                        {
                          data.tracks.find(
                            (item) => item.id === session.trackId,
                          )?.name
                        }
                      </em>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {!filteredSessions.length && (
            <WidgetEmpty label="No sessions match these filters." />
          )}
        </section>
      )}
      {widget.widgetType === "speakers" && (
        <section aria-label="Speakers">
          <p className="widget-result-count" aria-live="polite">
            {filteredSpeakers.length}{" "}
            {filteredSpeakers.length === 1 ? "speaker" : "speakers"}
          </p>
          <div className="speaker-widget-grid">
            {filteredSpeakers.map((speaker) => (
              <article key={speaker.id}>
                <div className="speaker-card-summary">
                  {speaker.headshotUrl ? (
                    <img
                      src={speaker.headshotUrl}
                      alt={`${speaker.firstName} ${speaker.lastName}`}
                    />
                  ) : (
                    <span>
                      <UserRound size={28} />
                    </span>
                  )}
                  <div>
                    <h2>
                      {speaker.firstName} {speaker.lastName}
                    </h2>
                    {show("company") && (
                      <p>
                        {speaker.jobTitle}
                        {speaker.company ? ` · ${speaker.company}` : ""}
                      </p>
                    )}
                    {show("bio") && speaker.bio && (
                      <p className="speaker-bio-preview">{speaker.bio}</p>
                    )}
                    <span className="speaker-session-count">
                      {
                        data.sessions.filter((session) =>
                          session.speakerIds.includes(speaker.id),
                        ).length
                      }{" "}
                      sessions
                    </span>
                    <button
                      type="button"
                      className="widget-detail-button"
                      aria-expanded={expandedSpeaker === speaker.id}
                      onClick={() =>
                        setExpandedSpeaker((current) =>
                          current === speaker.id ? undefined : speaker.id,
                        )
                      }
                    >
                      {expandedSpeaker === speaker.id
                        ? "Close profile"
                        : "View profile"}
                    </button>
                  </div>
                </div>
                {expandedSpeaker === speaker.id && (
                  <div className="speaker-profile-detail">
                    {show("bio") && (
                      <p className="speaker-bio">
                        {speaker.bio || "Biography coming soon."}
                      </p>
                    )}
                    <div className="speaker-session-links">
                      <strong>Sessions</strong>
                      {data.sessions
                        .filter((session) =>
                          session.speakerIds.includes(speaker.id),
                        )
                        .map((session) => {
                          const placement = placementFor(session.id);
                          return (
                            <span key={session.id}>
                              <strong>{session.title}</strong>
                              <small>
                                {placement
                                  ? `${formatTime(placement.startsAt, event.timezone)}–${formatClock(placement.endsAt, event.timezone)} · ${placement.roomName || "Location TBA"}`
                                  : "Schedule to be announced"}
                              </small>
                            </span>
                          );
                        })}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!filteredSpeakers.length && (
            <WidgetEmpty label="No speakers match this search." />
          )}
        </section>
      )}
      {widget.widgetType === "agenda" && (
        <AgendaGrid
          items={filteredAgenda}
          sessions={data.sessions}
          speakers={data.speakers}
          timezone={event.timezone}
          saved={saved}
          show={show}
          toggle={toggle}
          itinerary={false}
          eventStartsAt={event.startsAt}
          eventEndsAt={event.endsAt}
        />
      )}
      {widget.widgetType === "itinerary" && (
        <>
          <div className="itinerary-heading">
            <p>
              <strong>{saved.length}</strong>{" "}
              {saved.length === 1 ? "session" : "sessions"} in your personal
              schedule. Saved on this device.
            </p>
            <div>
              <button
                type="button"
                className={showPersonalSchedule ? "active" : ""}
                aria-pressed={showPersonalSchedule}
                onClick={() =>
                  setShowPersonalSchedule((current) => {
                    if (!current) {
                      setSearch("");
                      setTrack("");
                      setFormat("");
                      setLocation("");
                    }
                    return !current;
                  })
                }
                disabled={!saved.length}
              >
                {showPersonalSchedule
                  ? "Show full program"
                  : "Show my schedule only"}
              </button>
              <button onClick={downloadItinerary} disabled={!saved.length}>
                <Download size={14} /> Export my ICS
              </button>
            </div>
          </div>
          {exportFeedback && (
            <p className="widget-export-feedback" role="status">
              {exportFeedback}
            </p>
          )}
          <AgendaGrid
            items={
              showPersonalSchedule
                ? data.agenda.filter((item) => saved.includes(item.id))
                : filteredAgenda
            }
            sessions={data.sessions}
            speakers={data.speakers}
            timezone={event.timezone}
            saved={saved}
            show={show}
            toggle={toggle}
            itinerary
            eventStartsAt={event.startsAt}
            eventEndsAt={event.endsAt}
          />
        </>
      )}
      {widget.widgetType === "gallery" && (
        <section aria-label="Speaker gallery">
          <p className="widget-result-count" aria-live="polite">
            {filteredSpeakers.length} featured{" "}
            {filteredSpeakers.length === 1 ? "speaker" : "speakers"}
          </p>
          <div className="gallery-widget">
            {filteredSpeakers.map((speaker, index) => (
              <article
                key={speaker.id}
                className={`gallery-tile tile-${index % 3}`}
              >
                <div className="gallery-card-summary">
                  {speaker.headshotUrl ? (
                    <img
                      src={speaker.headshotUrl}
                      alt={`${speaker.firstName} ${speaker.lastName}`}
                    />
                  ) : (
                    <UserRound size={36} />
                  )}
                  <span>{speaker.jobTitle || "Speaker"}</span>
                  <h2>
                    {speaker.firstName} {speaker.lastName}
                  </h2>
                  <p>{speaker.company || "Independent"}</p>
                  <button
                    type="button"
                    className="gallery-profile-button"
                    aria-expanded={expandedSpeaker === speaker.id}
                    onClick={() =>
                      setExpandedSpeaker((current) =>
                        current === speaker.id ? undefined : speaker.id,
                      )
                    }
                  >
                    {expandedSpeaker === speaker.id
                      ? "Close profile"
                      : "View profile"}
                  </button>
                </div>
                {expandedSpeaker === speaker.id && (
                  <div className="gallery-profile-detail">
                    <p>{speaker.bio || "Biography coming soon."}</p>
                    <strong>Sessions</strong>
                    {data.sessions
                      .filter((session) =>
                        session.speakerIds.includes(speaker.id),
                      )
                      .map((session) => {
                        const placement = placementFor(session.id);
                        return (
                          <p key={session.id}>
                            <strong>{session.title}</strong>
                            {placement && (
                              <small>
                                {formatTime(placement.startsAt, event.timezone)}
                                –{formatClock(placement.endsAt, event.timezone)}{" "}
                                · {placement.roomName || "Location TBA"}
                              </small>
                            )}
                          </p>
                        );
                      })}
                  </div>
                )}
              </article>
            ))}
          </div>
          {!filteredSpeakers.length && (
            <WidgetEmpty label="No speakers match this search." />
          )}
        </section>
      )}
      {!(
        ["sessions", "speakers", "agenda", "itinerary", "gallery"] as string[]
      ).includes(widget.widgetType) && (
        <div className="widget-state">Unknown widget type.</div>
      )}
    </main>
  );
}

function WidgetEmpty({ label }: { label: string }) {
  return (
    <div className="widget-empty">
      <Search size={20} />
      <p>{label}</p>
    </div>
  );
}

function AgendaGrid({
  items,
  sessions,
  speakers,
  timezone,
  saved,
  show,
  toggle,
  itinerary,
  eventStartsAt,
  eventEndsAt,
}: {
  items: AgendaItem[];
  sessions: Session[];
  speakers: Speaker[];
  timezone: string;
  saved: string[];
  show: (field: string) => boolean;
  toggle: (id: string) => void;
  itinerary: boolean;
  eventStartsAt: string;
  eventEndsAt: string;
}) {
  const dayOptions = eventDayOptions(eventStartsAt, eventEndsAt, timezone);
  const days = dayOptions.map((day) => day.key);
  const [selectedDay, setSelectedDay] = useState(
    days.find((day) =>
      items.some((item) => dayKey(item.startsAt, timezone) === day),
    ) ??
      days[0] ??
      "",
  );
  useEffect(() => {
    if (!days.includes(selectedDay)) setSelectedDay(days[0] ?? "");
  }, [days, selectedDay]);
  const current = items.filter(
    (item) => dayKey(item.startsAt, timezone) === selectedDay,
  );
  const rooms = [
    ...new Set(current.map((item) => item.roomName || "Location TBA")),
  ];
  return (
    <section
      className="agenda-widget"
      aria-label={itinerary ? "Personal itinerary program" : "Program agenda"}
    >
      <p className="widget-result-count" aria-live="polite">
        {items.length} {items.length === 1 ? "agenda entry" : "agenda entries"}
      </p>
      <div className="agenda-day-tabs" role="tablist" aria-label="Event days">
        {days.map((day) => (
          <button
            key={day}
            role="tab"
            aria-selected={day === selectedDay}
            onClick={() => setSelectedDay(day)}
          >
            {formatDay(
              current.find((item) => dayKey(item.startsAt, timezone) === day)
                ?.startsAt ??
                dayOptions.find((option) => option.key === day)!.value,
              timezone,
            )}
          </button>
        ))}
      </div>
      {current.length ? (
        <div className="agenda-grid-scroll">
          <table className="agenda-grid">
            <thead>
              <tr>
                <th scope="col">Time</th>
                {rooms.map((room) => (
                  <th scope="col" key={room}>
                    {room}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...new Set(current.map((item) => item.startsAt))].map(
                (start) => (
                  <tr key={start}>
                    <th scope="row">{formatClock(start, timezone)}</th>
                    {rooms.map((room) => {
                      const item = current.find(
                        (candidate) =>
                          candidate.startsAt === start &&
                          (candidate.roomName || "Location TBA") === room,
                      );
                      return (
                        <td key={room}>
                          {item ? (
                            <AgendaCard
                              item={item}
                              session={sessions.find(
                                (session) => session.id === item.submissionId,
                              )}
                              speakers={speakers}
                              saved={saved}
                              show={show}
                              toggle={toggle}
                              itinerary={itinerary}
                              timezone={timezone}
                            />
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
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <WidgetEmpty
          label={
            items.length
              ? "No sessions match these filters on this day. Choose another day or clear the filters."
              : "No sessions are saved in your itinerary yet. Show the full program and add a session."
          }
        />
      )}
    </section>
  );
}

function AgendaCard({
  item,
  session,
  speakers,
  saved,
  show,
  toggle,
  itinerary,
  timezone,
}: {
  item: AgendaItem;
  session?: Session;
  speakers: Speaker[];
  saved: string[];
  show: (field: string) => boolean;
  toggle: (id: string) => void;
  itinerary: boolean;
  timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="agenda-card">
      <div className="agenda-card-summary">
        <span
          className="agenda-track-line"
          style={{ background: item.trackColor ?? "var(--widget-color)" }}
        />
        <div>
          <small>
            {formatClock(item.startsAt, timezone)}–
            {formatClock(item.endsAt, timezone)}
          </small>
          <h2>{item.title}</h2>
          {show("track") && item.trackName && <em>{item.trackName}</em>}
          <div className="agenda-card-facts">
            {show("room") && (
              <span>
                <MapPin size={13} />{" "}
                {item.roomName || "Location to be announced"}
              </span>
            )}
            {session?.format && <span>{session.format}</span>}
          </div>
          {session && show("speakers") && (
            <div className="agenda-card-speakers">
              {speakers
                .filter((speaker) => session.speakerIds.includes(speaker.id))
                .map((speaker) => (
                  <span key={speaker.id}>
                    <strong>
                      {speaker.firstName} {speaker.lastName}
                    </strong>{" "}
                    · {speaker.jobTitle || "Speaker"}
                    {speaker.company ? ` · ${speaker.company}` : ""}
                  </span>
                ))}
            </div>
          )}
          <button
            className="agenda-detail-trigger"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Close details" : "View details"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="agenda-card-detail">
          {item.description && <p>{item.description}</p>}
          {show("room") && (
            <p>
              <MapPin size={13} /> {item.roomName || "Location to be announced"}
            </p>
          )}
        </div>
      )}
      {item.itemType === "session" && (
        <button
          type="button"
          className={saved.includes(item.id) ? "saved" : ""}
          onClick={() => toggle(item.id)}
          aria-label={`${saved.includes(item.id) ? "Remove from" : "Add to"} itinerary`}
        >
          <CalendarPlus size={16} />{" "}
          {saved.includes(item.id)
            ? "Remove from itinerary"
            : "Add to itinerary"}
        </button>
      )}
    </article>
  );
}
