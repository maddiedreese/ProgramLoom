import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { captureProductEvent } from "../lib/telemetry";

type Category =
  | "submission"
  | "review"
  | "decision"
  | "speaker"
  | "task"
  | "file"
  | "content"
  | "agenda"
  | "delivery"
  | "queue"
  | "airtable"
  | "integration";
type Severity = "info" | "warning" | "blocking";
type Notification = {
  id: string;
  organizationId: string;
  eventId: string | null;
  eventName: string | null;
  category: Category;
  notificationType: string;
  severity: Severity;
  title: string;
  body: string;
  actionUrl: string;
  entityType: string | null;
  entityId: string | null;
  occurrenceCount: number;
  lastOccurredAt: string;
  readAt: string | null;
};
type Preference = {
  category: Category;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  inherited?: boolean;
};
type Data = {
  notifications: Notification[];
  events: Array<{ id: string; name: string; organizationId: string }>;
  organizations: Array<{ id: string; name: string }>;
  page: number;
  pageSize: number;
  total: number;
  unread: number;
  globalUnread: number;
  hasMore: boolean;
};

const categories: Array<[Category, string]> = [
  ["submission", "Submissions"],
  ["review", "Reviews"],
  ["decision", "Decisions"],
  ["speaker", "Speakers"],
  ["task", "Tasks"],
  ["file", "Files"],
  ["content", "Content"],
  ["agenda", "Agenda"],
  ["delivery", "Delivery"],
  ["queue", "Queue"],
  ["airtable", "Airtable"],
  ["integration", "Integrations"],
];

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(result.error?.message ?? "Notifications are unavailable.");
  return result;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [data, setData] = useState<Data>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    eventId: "",
    category: "",
    severity: "",
    read: "",
  });
  const [scope, setScope] = useState("");
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [saving, setSaving] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  function closeCenter() {
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }

  const query = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), pageSize: "25" });
    Object.entries(filters).forEach(
      ([key, item]) => item && value.set(key, item),
    );
    return value;
  }, [filters, page]);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api<Data>(`/api/notifications?${query}`);
      setData(result);
      setError(undefined);
      if (!scope) {
        const event = result.events[0];
        const organization = result.organizations[0];
        setScope(
          event
            ? `event:${event.id}:${event.organizationId}`
            : organization
              ? `organization:${organization.id}`
              : "",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Notifications are unavailable.",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(true), 20_000);
    return () => window.clearInterval(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load();
    requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLElement>("button")?.focus(),
    );
    captureProductEvent("notification_center_opened", {
      unread_bucket: Math.min(data?.globalUnread ?? 0, 10),
    });
  }, [open]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        closeCenter();
      } else if (event.key === "Tab" && open && panel.current) {
        const focusable = Array.from(
          panel.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]),a[href],select:not([disabled]),input:not([disabled])",
          ),
        );
        if (!focusable.length) return;
        if (event.shiftKey && document.activeElement === focusable[0]) {
          event.preventDefault();
          focusable.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === focusable.at(-1)
        ) {
          event.preventDefault();
          focusable[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    if (!settings || !scope) return;
    const [kind, id, organizationId] = scope.split(":");
    const params = new URLSearchParams({
      organizationId: kind === "event" ? organizationId : id,
    });
    if (kind === "event") params.set("eventId", id);
    api<{ preferences: Preference[] }>(
      `/api/notifications/preferences?${params}`,
    )
      .then((result) => setPreferences(result.preferences))
      .catch((reason: Error) => setError(reason.message));
  }, [scope, settings]);

  function changeFilter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function setRead(item: Notification, read: boolean) {
    await api(`/api/notifications/${item.id}`, {
      method: "PATCH",
      keepalive: true,
      body: JSON.stringify({ read }),
    });
    await load(true);
  }

  async function markAllRead() {
    await api("/api/notifications/read-all", {
      method: "POST",
      body: JSON.stringify({
        eventId: filters.eventId || undefined,
        category: filters.category || undefined,
        severity: filters.severity || undefined,
      }),
    });
    captureProductEvent("notifications_marked_all_read", {
      has_event_filter: Boolean(filters.eventId),
    });
    await load(true);
  }

  async function updatePreference(
    item: Preference,
    channel: "inAppEnabled" | "emailEnabled",
  ) {
    if (!scope) return;
    const [kind, id, eventOrganizationId] = scope.split(":");
    const next = { ...item, [channel]: !item[channel], inherited: false };
    setSaving(`${item.category}:${channel}`);
    try {
      await api("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          organizationId: kind === "event" ? eventOrganizationId : id,
          eventId: kind === "event" ? id : undefined,
          category: next.category,
          inAppEnabled: next.inAppEnabled,
          emailEnabled: next.emailEnabled,
        }),
      });
      setPreferences((current) =>
        current.map((value) =>
          value.category === item.category ? next : value,
        ),
      );
      if (channel === "inAppEnabled") await load(true);
      captureProductEvent("notification_preference_changed", {
        category: item.category,
        channel: channel === "emailEnabled" ? "email" : "in_app",
        enabled: next[channel],
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Preference could not be saved.",
      );
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="notification-trigger"
        aria-label={`Notifications${data?.globalUnread ? `, ${data.globalUnread} unread` : ""}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={19} />
        {(data?.globalUnread ?? 0) > 0 && (
          <span aria-hidden="true">
            {Math.min(data?.globalUnread ?? 0, 99)}
          </span>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {data?.globalUnread
          ? `${data.globalUnread} unread notifications`
          : "No unread notifications"}
      </span>
      {open && (
        <div
          className="notification-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeCenter()
          }
        >
          <aside
            ref={panel}
            className="notification-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-title"
            tabIndex={-1}
          >
            <header>
              <div>
                <p className="kicker">Operational updates</p>
                <h2 id="notification-title">
                  {settings ? "Notification preferences" : "Notifications"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSettings((current) => !current)}
                aria-label={
                  settings ? "Show notifications" : "Notification preferences"
                }
              >
                {settings ? (
                  <>
                    <Bell size={18} /> Notifications
                  </>
                ) : (
                  <>
                    <Settings2 size={18} /> Preferences
                  </>
                )}
              </button>
              <button
                type="button"
                data-dismiss
                aria-label="Close notifications"
                onClick={() => {
                  closeCenter();
                }}
              >
                <X size={18} /> Close
              </button>
            </header>
            {error && (
              <div className="notification-error" role="alert">
                <CircleAlert size={17} /> {error}
              </div>
            )}
            {settings ? (
              <div className="notification-settings">
                <label>
                  Preference scope
                  <select
                    value={scope}
                    onChange={(event) => setScope(event.target.value)}
                  >
                    {data?.organizations.map((item) => (
                      <option
                        value={`organization:${item.id}`}
                        key={`org:${item.id}`}
                      >
                        {item.name} · all events
                      </option>
                    ))}
                    {data?.events.map((item) => (
                      <option
                        value={`event:${item.id}:${item.organizationId}`}
                        key={`event:${item.id}`}
                      >
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="preference-table"
                  role="table"
                  aria-label="Notification preferences"
                >
                  <div role="row" className="preference-row preference-heading">
                    <span>Category</span>
                    <span>In app</span>
                    <span>Email</span>
                  </div>
                  {preferences.map((item) => (
                    <div
                      role="row"
                      className="preference-row"
                      key={item.category}
                    >
                      <strong>
                        {categories.find(([id]) => id === item.category)?.[1]}
                        {item.inherited && <small>Inherited</small>}
                      </strong>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.inAppEnabled}
                          disabled={Boolean(saving)}
                          onChange={() =>
                            updatePreference(item, "inAppEnabled")
                          }
                        />
                        <span className="sr-only">
                          In-app {item.category} notifications
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.emailEnabled}
                          disabled={Boolean(saving)}
                          onChange={() =>
                            updatePreference(item, "emailEnabled")
                          }
                        />
                        <span className="sr-only">
                          Email {item.category} notifications
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
                <p className="notification-policy">
                  In-app updates are retained for 180 days, then archived and
                  removed after 30 more days. Email is sent only when explicitly
                  enabled.
                </p>
              </div>
            ) : (
              <>
                <div className="notification-filters">
                  <label>
                    Event
                    <select
                      value={filters.eventId}
                      onChange={(event) =>
                        changeFilter("eventId", event.target.value)
                      }
                    >
                      <option value="">All events</option>
                      {data?.events.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select
                      value={filters.category}
                      onChange={(event) =>
                        changeFilter("category", event.target.value)
                      }
                    >
                      <option value="">All categories</option>
                      {categories.map(([id, label]) => (
                        <option value={id} key={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Severity
                    <select
                      value={filters.severity}
                      onChange={(event) =>
                        changeFilter("severity", event.target.value)
                      }
                    >
                      <option value="">All severities</option>
                      <option value="blocking">Blocking</option>
                      <option value="warning">Warning</option>
                      <option value="info">Informational</option>
                    </select>
                  </label>
                  <label>
                    State
                    <select
                      value={filters.read}
                      onChange={(event) =>
                        changeFilter("read", event.target.value)
                      }
                    >
                      <option value="">Read and unread</option>
                      <option value="unread">Unread</option>
                      <option value="read">Read</option>
                    </select>
                  </label>
                </div>
                <div className="notification-actions">
                  <span>
                    {data?.total ?? 0} updates · {data?.unread ?? 0} unread
                  </span>
                  <button
                    type="button"
                    onClick={markAllRead}
                    disabled={!data?.unread}
                  >
                    <CheckCheck size={15} /> Mark all read
                  </button>
                </div>
                <div className="notification-list" aria-busy={loading}>
                  {loading && !data && (
                    <div className="notification-state">
                      <LoaderCircle className="spin" /> Loading updates…
                    </div>
                  )}
                  {!loading && !data?.notifications.length && (
                    <div className="notification-state">
                      <CheckCheck size={28} />
                      <strong>You’re all caught up</strong>
                      <span>No updates match these filters.</span>
                    </div>
                  )}
                  {data?.notifications.map((item) => (
                    <article
                      className={`notification-item severity-${item.severity} ${item.readAt ? "is-read" : ""}`}
                      key={item.id}
                    >
                      <i aria-label={`${item.severity} severity`} />
                      <div>
                        <span>
                          {item.eventName ?? "Workspace"} ·{" "}
                          {categories.find(([id]) => id === item.category)?.[1]}
                        </span>
                        <a
                          href={item.actionUrl}
                          onClick={() => {
                            void setRead(item, true);
                            captureProductEvent("notification_opened", {
                              category: item.category,
                              severity: item.severity,
                            });
                          }}
                        >
                          {item.title}
                        </a>
                        <p>{item.body}</p>
                        <small>
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(item.lastOccurredAt))}
                          {item.occurrenceCount > 1
                            ? ` · ${item.occurrenceCount} updates`
                            : ""}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void setRead(item, !Boolean(item.readAt))
                        }
                        aria-label={
                          item.readAt
                            ? `Mark ${item.title} unread`
                            : `Mark ${item.title} read`
                        }
                      >
                        <span />
                      </button>
                    </article>
                  ))}
                </div>
                <footer>
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <ChevronLeft size={15} /> Newer
                  </button>
                  <span>Page {page}</span>
                  <button
                    type="button"
                    disabled={!data?.hasMore}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Older <ChevronRight size={15} />
                  </button>
                </footer>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
