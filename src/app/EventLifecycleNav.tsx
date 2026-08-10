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
}> = [
  {
    id: "control-room",
    label: "Control Room",
    path: "/control-room",
    icon: Gauge,
  },
  { id: "cfp", label: "Call for proposals", path: "", icon: FileInput },
  {
    id: "submissions",
    label: "Submissions",
    path: "/submissions",
    icon: Inbox,
  },
  {
    id: "reviews",
    label: "Reviews",
    path: "/reviews",
    icon: CheckCircle2,
  },
  {
    id: "speakers",
    label: "Speakers",
    path: "/speakers",
    icon: UsersRound,
  },
  { id: "content", label: "Content", path: "/content", icon: Files },
  {
    id: "agenda",
    label: "Agenda",
    path: "/agenda",
    icon: CalendarClock,
  },
  {
    id: "widgets",
    label: "Public widgets",
    path: "/widgets",
    icon: PanelsTopLeft,
  },
  {
    id: "communications",
    label: "Communications",
    path: "/communications",
    icon: Mail,
  },
  {
    id: "calendar",
    label: "Calendar lifecycle",
    path: "/calendar",
    icon: CalendarClock,
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
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <nav className="event-nav" aria-label="Event lifecycle">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <a
              className={item.id === active ? "active" : undefined}
              href={`/app/events/${eventId}${item.path}`}
              aria-current={item.id === active ? "page" : undefined}
              key={item.id}
            >
              <Icon size={18} /> {item.label}
            </a>
          );
        })}
      </nav>
    </>
  );
}
