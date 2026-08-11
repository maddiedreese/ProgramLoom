import {
  CalendarClock,
  CheckCircle2,
  FileInput,
  Files,
  Gauge,
  Inbox,
  Mail,
  PanelsTopLeft,
  UsersRound,
} from "lucide-react";

export type EventLifecycleSurface =
  | "control-room"
  | "cfp"
  | "submissions"
  | "reviews"
  | "speakers"
  | "content"
  | "agenda"
  | "widgets"
  | "communications"
  | "calendar";

const organizerItems: Array<{
  id: EventLifecycleSurface;
  label: string;
  path: string;
  icon: typeof Gauge;
  stage: string;
}> = [
  {
    id: "control-room",
    label: "Control Room",
    path: "/control-room",
    icon: Gauge,
    stage: "Overview",
  },
  {
    id: "cfp",
    label: "Call for proposals",
    path: "",
    icon: FileInput,
    stage: "1 · Collect proposals",
  },
  {
    id: "submissions",
    label: "Submissions",
    path: "/submissions",
    icon: Inbox,
    stage: "1 · Collect proposals",
  },
  {
    id: "reviews",
    label: "Reviews",
    path: "/reviews",
    icon: CheckCircle2,
    stage: "2 · Evaluate proposals",
  },
  {
    id: "communications",
    label: "Communications Center",
    path: "/communications",
    icon: Mail,
    stage: "3 · Decide & communicate",
  },
  {
    id: "speakers",
    label: "Speakers",
    path: "/speakers",
    icon: UsersRound,
    stage: "4 · Prepare speakers",
  },
  {
    id: "content",
    label: "Content & files",
    path: "/content",
    icon: Files,
    stage: "4 · Prepare speakers",
  },
  {
    id: "agenda",
    label: "Agenda",
    path: "/agenda",
    icon: CalendarClock,
    stage: "5 · Schedule",
  },
  {
    id: "calendar",
    label: "Calendar invitations",
    path: "/calendar",
    icon: CalendarClock,
    stage: "5 · Schedule",
  },
  {
    id: "widgets",
    label: "Public widgets",
    path: "/widgets",
    icon: PanelsTopLeft,
    stage: "6 · Publish",
  },
];

export function EventLifecycleNav({
  eventId,
  active,
  role,
}: {
  eventId: string;
  active: EventLifecycleSurface;
  role?: string;
}) {
  const items =
    role === "reviewer"
      ? organizerItems.filter((item) => item.id === "reviews")
      : role === "speaker"
        ? organizerItems.filter((item) => item.id === "speakers")
        : organizerItems;
  return (
    <>
      <label className="control-mobile-nav">
        <span>Event lifecycle</span>
        <select
          aria-label="Event lifecycle"
          value={active}
          onChange={(event) => {
            const destination = organizerItems.find(
              (item) => item.id === event.target.value,
            );
            if (destination)
              window.location.href = `/app/events/${eventId}${destination.path}`;
          }}
        >
          {items.map((item) => (
            <option value={item.id} key={item.id}>
              {item.stage} — {item.label}
            </option>
          ))}
        </select>
      </label>
      <nav className="event-nav" aria-label="Event lifecycle">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <div className="event-nav-item" key={item.id}>
              {(index === 0 || item.stage !== items[index - 1]?.stage) && (
                <span className="event-nav-stage">{item.stage}</span>
              )}
              <a
                className={item.id === active ? "active" : undefined}
                href={`/app/events/${eventId}${item.path}`}
                aria-current={item.id === active ? "page" : undefined}
              >
                <Icon size={18} /> {item.label}
              </a>
            </div>
          );
        })}
      </nav>
    </>
  );
}
