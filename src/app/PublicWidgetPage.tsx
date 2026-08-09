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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
      data?.sessions.filter(
        (session) =>
          (!track || session.trackId === track) &&
          `${session.title} ${session.abstract} ${session.speakerNames.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) ?? [],
    [data, search, track],
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
    link.click();
    URL.revokeObjectURL(url);
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
  const show = (field: string) => widget.config.fields.includes(field);
  return (
    <main
      className={`public-widget theme-${widget.config.theme}`}
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
          )}
        </div>
      )}
      {widget.widgetType === "sessions" && (
        <section className="widget-card-grid">
          {filteredSessions.map((session) => (
            <details className="widget-card" key={session.id}>
              <summary>
                <span className="widget-icon">
                  <UsersRound size={18} />
                </span>
                <div>
                  <h2>{session.title}</h2>
                  {show("speakers") && (
                    <p>
                      {session.speakerNames.join(", ") ||
                        "Speakers to be announced"}
                    </p>
                  )}
                </div>
              </summary>
              {show("abstract") && (
                <p>{session.abstract || "Details coming soon."}</p>
              )}
              {show("track") && session.trackId && (
                <em>
                  {
                    data.tracks.find((item) => item.id === session.trackId)
                      ?.name
                  }
                </em>
              )}
            </details>
          ))}
        </section>
      )}
      {widget.widgetType === "speakers" && (
        <section className="speaker-widget-grid">
          {data.speakers
            .filter((speaker) =>
              `${speaker.firstName} ${speaker.lastName} ${speaker.company ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((speaker) => (
              <article key={speaker.id}>
                {speaker.headshotUrl ? (
                  <img src={speaker.headshotUrl} alt="" />
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
                  {show("bio") && <small>{speaker.bio}</small>}
                </div>
              </article>
            ))}
        </section>
      )}
      {widget.widgetType === "agenda" && (
        <AgendaList
          items={filteredAgenda}
          saved={saved}
          show={show}
          toggle={toggle}
          itinerary={false}
        />
      )}
      {widget.widgetType === "itinerary" && (
        <>
          <div className="itinerary-heading">
            <p>
              <strong>{saved.length}</strong> sessions in your personal
              schedule. Saved on this device.
            </p>
            <button onClick={downloadItinerary} disabled={!saved.length}>
              <Download size={14} /> Export my ICS
            </button>
          </div>
          <AgendaList
            items={filteredAgenda}
            saved={saved}
            show={show}
            toggle={toggle}
            itinerary
          />
        </>
      )}
      {widget.widgetType === "gallery" && (
        <section className="gallery-widget">
          {filteredSessions.map((session, index) => (
            <article
              key={session.id}
              className={`gallery-tile tile-${index % 3}`}
            >
              <span>
                {data.tracks.find((item) => item.id === session.trackId)
                  ?.name || "Program"}
              </span>
              <h2>{session.title}</h2>
              <p>{session.speakerNames.join(", ")}</p>
            </article>
          ))}
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

function AgendaList({
  items,
  saved,
  show,
  toggle,
  itinerary,
}: {
  items: AgendaItem[];
  saved: string[];
  show: (field: string) => boolean;
  toggle: (id: string) => void;
  itinerary: boolean;
}) {
  return (
    <section className="agenda-widget-list">
      {items.map((item) => (
        <article key={item.id}>
          <time>{formatTime(item.startsAt)}</time>
          <span
            className="agenda-track-line"
            style={{ background: item.trackColor ?? "var(--widget-color)" }}
          />
          <div>
            <h2>{item.title}</h2>
            {show("room") && (
              <p>
                <MapPin size={13} />
                {item.roomName || "Location to be announced"}
              </p>
            )}
            {show("track") && item.trackName && <em>{item.trackName}</em>}
          </div>
          {item.itemType === "session" && (
            <button
              className={saved.includes(item.id) ? "saved" : ""}
              onClick={() => toggle(item.id)}
              aria-label={`${saved.includes(item.id) ? "Remove from" : "Add to"} itinerary`}
            >
              <CalendarPlus size={16} />
              {itinerary ? (saved.includes(item.id) ? "Saved" : "Add") : ""}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
