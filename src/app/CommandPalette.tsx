import {
  CalendarDays,
  FileText,
  FolderSearch2,
  LoaderCircle,
  Mail,
  Search,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { captureProductEvent } from "../lib/telemetry";

type ResultType =
  | "event"
  | "cfp_form"
  | "submission"
  | "session"
  | "speaker"
  | "crm_contact"
  | "reviewer"
  | "task"
  | "file"
  | "resource"
  | "saved_view"
  | "communication";
type Result = {
  type: ResultType;
  id: string;
  label: string;
  context: string;
  path: string;
  organizationId: string;
  eventId: string | null;
  rank?: number;
};
type Action = { id: string; label: string; context: string; path: string };
type Response = {
  results: Result[];
  recent: Result[];
  actions: Action[];
  scope: {
    events: Array<{
      id: string;
      name: string;
      organizationName: string;
      role: string;
    }>;
  };
};

const typeLabels: Record<ResultType, string> = {
  event: "Events",
  cfp_form: "CFP forms",
  submission: "Submissions",
  session: "Sessions",
  speaker: "Speakers",
  crm_contact: "CRM contacts",
  reviewer: "Reviewers",
  task: "Tasks",
  file: "Files",
  resource: "Resources",
  saved_view: "Saved views",
  communication: "Communications",
};

function iconFor(type: ResultType) {
  if (["speaker", "crm_contact"].includes(type)) return UserRound;
  if (type === "reviewer") return UsersRound;
  if (type === "event" || type === "session") return CalendarDays;
  if (type === "communication") return Mail;
  if (["file", "resource"].includes(type)) return FileText;
  return FolderSearch2;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Response>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const eventId =
    window.location.pathname.match(/\/app\/events\/([^/]+)/)?.[1] ?? null;
  const organizationId =
    new URLSearchParams(window.location.search).get("organization") ?? null;

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      } else if (event.key === "Tab" && open && dialog.current) {
        const focusable = Array.from(
          dialog.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),a[href]",
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
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    priorFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    captureProductEvent("command_palette_opened", {
      has_event_scope: Boolean(eventId),
    });
    requestAnimationFrame(() => input.current?.focus());
  }, [open, eventId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(undefined);
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        setError(undefined);
        const params = new URLSearchParams({ q: query, limit: "40" });
        if (eventId) params.set("eventId", eventId);
        else if (organizationId) params.set("organizationId", organizationId);
        try {
          const response = await fetch(`/api/search?${params}`, {
            credentials: "same-origin",
            signal: controller.signal,
          });
          const result = (await response.json()) as Response & {
            error?: { message?: string };
          };
          if (!response.ok)
            throw new Error(result.error?.message ?? "Search is unavailable.");
          setData(result);
          setActive(0);
        } catch (reason) {
          if ((reason as Error).name !== "AbortError")
            setError(
              reason instanceof Error
                ? reason.message
                : "Search is unavailable.",
            );
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query ? 180 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [eventId, open, organizationId, query, retry]);

  const displayedResults = query ? (data?.results ?? []) : (data?.recent ?? []);
  const grouped = useMemo(
    () =>
      Object.entries(
        displayedResults.reduce<Record<string, Result[]>>((current, item) => {
          (current[item.type] ??= []).push(item);
          return current;
        }, {}),
      ) as Array<[ResultType, Result[]]>,
    [displayedResults],
  );
  const items = useMemo(
    () => [
      ...grouped
        .flatMap(([, results]) => results)
        .map((item) => ({ kind: "result" as const, item })),
      ...(query
        ? []
        : (data?.actions ?? []).map((item) => ({
            kind: "action" as const,
            item,
          }))),
    ],
    [data?.actions, grouped, query],
  );

  function close() {
    setOpen(false);
    window.setTimeout(
      () => (priorFocus.current ?? trigger.current)?.focus(),
      0,
    );
  }

  function chooseResult(item: Result) {
    void fetch("/api/search/recent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityType: item.type,
        entityId: item.id,
        eventId: item.eventId,
        organizationId: item.organizationId,
      }),
    });
    captureProductEvent("command_palette_result_selected", {
      entity_type: item.type,
      rank_bucket: item.rank === undefined ? "recent" : Math.floor(item.rank),
      has_event_scope: Boolean(eventId),
    });
    close();
    navigate(item.path);
  }

  function chooseAction(item: Action) {
    captureProductEvent("command_palette_action_selected", {
      action_id: item.id,
      has_event_scope: Boolean(eventId),
    });
    close();
    navigate(item.path);
  }

  function keyboard(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(items.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, items.length - 1));
    } else if (event.key === "Enter" && items[active]) {
      event.preventDefault();
      const selected = items[active];
      if (selected.kind === "result") chooseResult(selected.item as Result);
      else chooseAction(selected.item as Action);
    }
  }

  let itemIndex = 0;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="command-palette-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search and commands (Command K)"
      >
        <Search size={17} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div
          className="command-palette-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={dialog}
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
          >
            <h2 id="command-palette-title" className="sr-only">
              Search ProgramLoom and open commands
            </h2>
            <div className="command-search-row">
              <Search size={20} aria-hidden="true" />
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={keyboard}
                placeholder="Search events, proposals, people, files…"
                aria-label="Search ProgramLoom"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-results"
                aria-activedescendant={
                  items[active] ? `command-item-${active}` : undefined
                }
                autoComplete="off"
              />
              {loading && (
                <LoaderCircle className="spin" aria-label="Searching" />
              )}
              <button
                type="button"
                data-dismiss
                aria-label="Close search"
                onClick={close}
              >
                <X size={18} /> Close
              </button>
            </div>
            <div
              id="command-results"
              className="command-results"
              role="listbox"
              aria-label="Search results and commands"
            >
              <p className="sr-only" role="status" aria-live="polite">
                {loading
                  ? "Searching"
                  : error
                    ? "Search failed"
                    : `${displayedResults.length} permitted results`}
              </p>
              {error && (
                <div className="command-state error" role="alert">
                  <span>{error} Retry or close search to keep working.</span>
                  <button
                    type="button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Retry search
                  </button>
                </div>
              )}
              {!error && !loading && query && !displayedResults.length && (
                <div className="command-state">
                  <FolderSearch2 size={28} />
                  <strong>No permitted results found</strong>
                  <span>
                    Try a title, person, organization, or record type.
                  </span>
                  <button type="button" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                </div>
              )}
              {!query && grouped.length > 0 && (
                <p className="command-section-title">Recent</p>
              )}
              {grouped.map(([type, results]) => (
                <section key={type} aria-labelledby={`command-group-${type}`}>
                  <h3 id={`command-group-${type}`}>
                    {query ? typeLabels[type] : typeLabels[type]}
                  </h3>
                  {results.map((item) => {
                    const index = itemIndex++;
                    const Icon = iconFor(item.type);
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={active === index}
                        id={`command-item-${index}`}
                        className={active === index ? "active" : ""}
                        key={`${item.type}:${item.id}`}
                        onMouseMove={() => setActive(index)}
                        onClick={() => chooseResult(item)}
                      >
                        <Icon size={18} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.context}</small>
                        </span>
                        <em>{typeLabels[item.type].replace(/s$/, "")}</em>
                      </button>
                    );
                  })}
                </section>
              ))}
              {!query && (data?.actions.length ?? 0) > 0 && (
                <section aria-labelledby="command-actions-title">
                  <h3 id="command-actions-title">Quick actions</h3>
                  {data?.actions.map((item) => {
                    const index = itemIndex++;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={active === index}
                        id={`command-item-${index}`}
                        className={active === index ? "active" : ""}
                        key={item.id}
                        onMouseMove={() => setActive(index)}
                        onClick={() => chooseAction(item)}
                      >
                        <Sparkles size={18} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.context}</small>
                        </span>
                        <em>Action</em>
                      </button>
                    );
                  })}
                </section>
              )}
              {!query &&
                !loading &&
                !grouped.length &&
                !data?.actions.length && (
                  <div className="command-state">
                    <Search size={28} />
                    <strong>Search your ProgramLoom workspace</strong>
                    <span>
                      Results always respect your role and event access.
                    </span>
                  </div>
                )}
            </div>
            <footer>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> Navigate
              </span>
              <span>
                <kbd>↵</kbd> Open
              </span>
              <span>
                <kbd>esc</kbd> Close
              </span>
            </footer>
            <div className="sr-only" aria-live="polite">
              {loading
                ? "Searching"
                : `${displayedResults.length} permitted results available`}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
