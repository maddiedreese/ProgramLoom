import {
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  Save,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { zonedLocalToIso } from "../lib/zonedTime";
import { captureProductEvent } from "../lib/telemetry";

type EventRecord = {
  id: string;
  name: string;
  slug: string;
  eventType: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  status: string;
};
type Template = {
  id: string;
  name: string;
  description: string | null;
  domains: string[];
};
type Starter = { id: string; name: string; description: string };
type Preview = {
  sourceName: string;
  totalRecords: number;
  domains: Array<{ id: string; count: number }>;
  translatedDeadlines: Array<{ label: string; from: string; to: string }>;
  warnings: string[];
  excluded: string[];
};
const domains = [
  "cfp",
  "review",
  "onboarding",
  "resources",
  "communications",
  "roomsTracksLocations",
  "contentWorkflow",
  "widgets",
  "crm",
];
const labels: Record<string, string> = {
  cfp: "CFP forms and fields",
  review: "Review rounds and scorecards",
  onboarding: "Onboarding tasks and file requests",
  resources: "Resource and wiki pages",
  communications: "Communication templates and reminder rules",
  roomsTracksLocations: "Rooms, tracks, formats, and locations",
  contentWorkflow: "Content workflow settings",
  widgets: "Widget configurations and themes",
  crm: "CRM handoff and routing defaults",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export function EventTemplateStudio({
  organizationId,
  events,
  onCreated,
}: {
  organizationId: string;
  events: EventRecord[];
  onCreated: (event: EventRecord) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [source, setSource] = useState("starter_template:conference");
  const [selectedDomains, setSelectedDomains] = useState(domains);
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [previewSignature, setPreviewSignature] = useState("");
  useEffect(() => {
    const load = () =>
      request<{ templates: Template[]; starters: Starter[] }>(
        `/api/event-templates/organizations/${organizationId}`,
      )
        .then((data) => {
          setTemplates(data.templates);
          setStarters(data.starters);
        })
        .catch((reason: Error) => setError(reason.message));
    void load();
    window.addEventListener("programloom-template-changed", load);
    return () =>
      window.removeEventListener("programloom-template-changed", load);
  }, [organizationId]);
  const choices = useMemo(
    () => [
      ...starters.map((item) => ({
        value: `starter_template:${item.id}`,
        label: `Starter · ${item.name}`,
        description: item.description,
      })),
      ...templates.map((item) => ({
        value: `organization_template:${item.id}`,
        label: `Template · ${item.name}`,
        description: item.description ?? "Organization template",
      })),
      ...events.map((item) => ({
        value: `event:${item.id}`,
        label: `Duplicate · ${item.name}`,
        description: "Copy configuration from this event",
      })),
    ],
    [events, starters, templates],
  );
  const sourceDescription = choices.find(
    (item) => item.value === source,
  )?.description;
  function payload(form: HTMLFormElement) {
    const values = new FormData(form);
    const [kind, id] = source.split(":");
    const timezone = String(values.get("timezone"));
    return {
      source: { kind, id },
      domains: selectedDomains,
      target: {
        name: values.get("name"),
        slug: values.get("slug") || undefined,
        timezone,
        startsAt: zonedLocalToIso(String(values.get("startsAt")), timezone),
        endsAt: zonedLocalToIso(String(values.get("endsAt")), timezone),
        venueName: values.get("venueName") || null,
        websiteUrl: values.get("websiteUrl") || null,
      },
    };
  }
  function signature(value: unknown) {
    return JSON.stringify(value);
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError(undefined);
    try {
      const body = payload(formElement);
      const currentSignature = signature(body);
      if (!preview || previewSignature !== currentSignature) {
        const result = await request<{ preview: Preview }>(
          `/api/event-templates/organizations/${organizationId}/preview`,
          { method: "POST", body: JSON.stringify(body) },
        );
        setPreview(result.preview);
        setPreviewSignature(currentSignature);
        captureProductEvent("event_copy_previewed", {
          source_kind: body.source.kind,
          selected_domain_count: selectedDomains.length,
          configuration_record_count: result.preview.totalRecords,
          warning_count: result.preview.warnings.length,
        });
        return;
      }
      const result = await request<{ event: EventRecord }>(
        `/api/event-templates/organizations/${organizationId}/events`,
        {
          method: "POST",
          body: JSON.stringify({ ...body, confirmPreview: true }),
        },
      );
      formElement.reset();
      setPreview(undefined);
      setPreviewSignature("");
      onCreated(result.event);
      captureProductEvent("event_created_from_configuration", {
        source_kind: body.source.kind,
        selected_domain_count: selectedDomains.length,
        warning_count: preview.warnings.length,
      });
      window.setTimeout(
        () => document.getElementById(`event-${result.event.id}`)?.focus(),
        50,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The event could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="event-template-studio"
      onSubmit={handleSubmit}
      onChange={() => {
        setPreview(undefined);
        setPreviewSignature("");
      }}
    >
      <div className="event-template-source wide">
        <label>
          Start from
          <select
            value={source}
            onChange={(event) => {
              const value = event.target.value;
              setSource(value);
              const [kind, id] = value.split(":");
              setSelectedDomains(
                kind === "organization_template"
                  ? (templates.find((item) => item.id === id)?.domains ??
                      domains)
                  : domains,
              );
            }}
          >
            {choices.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {sourceDescription && <small>{sourceDescription}</small>}
      </div>
      <label className="wide">
        Event name
        <input
          name="name"
          placeholder="DevFlow Conf 2027"
          required
          minLength={2}
        />
      </label>
      <label>
        URL slug <span className="muted">optional</span>
        <input name="slug" placeholder="devflow-2027" />
      </label>
      <label>
        Timezone
        <input
          name="timezone"
          defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
          required
        />
      </label>
      <label>
        Starts
        <input type="datetime-local" name="startsAt" required />
      </label>
      <label>
        Ends
        <input type="datetime-local" name="endsAt" required />
      </label>
      <label>
        Venue
        <input name="venueName" placeholder="Moscone West" />
      </label>
      <label>
        Website
        <input type="url" name="websiteUrl" placeholder="https://example.com" />
      </label>
      <fieldset className="template-domains wide">
        <legend>Configuration to copy</legend>
        <div>
          {domains.map((domain) => (
            <label className="check-row" key={domain}>
              <input
                type="checkbox"
                checked={selectedDomains.includes(domain)}
                onChange={(event) =>
                  setSelectedDomains((current) =>
                    event.target.checked
                      ? [...current, domain]
                      : current.filter((item) => item !== domain),
                  )
                }
              />
              <span>{labels[domain]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <div className="inline-notice error wide" role="alert">
          <TriangleAlert size={18} />
          {error}
        </div>
      )}
      {preview && (
        <section
          className="duplication-preview wide"
          aria-labelledby="duplication-preview-title"
        >
          <h3 id="duplication-preview-title">
            <Check size={18} /> Review before creating
          </h3>
          <p>
            <strong>{preview.totalRecords}</strong> configuration records will
            be copied from {preview.sourceName}.
          </p>
          <ul className="preview-counts">
            {preview.domains.map((item) => (
              <li key={item.id}>
                <span>{labels[item.id]}</span>
                <strong>{item.count}</strong>
              </li>
            ))}
          </ul>
          {preview.translatedDeadlines.length > 0 && (
            <details>
              <summary>
                {preview.translatedDeadlines.length} deadlines will move
                relative to the new event
              </summary>
              <ul>
                {preview.translatedDeadlines.map((item) => (
                  <li key={`${item.label}-${item.from}`}>
                    {item.label}:{" "}
                    <time>{new Date(item.from).toLocaleDateString()}</time> →{" "}
                    <time>{new Date(item.to).toLocaleDateString()}</time>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.warnings.length > 0 && (
            <div className="inline-notice warning">
              <TriangleAlert size={18} />
              <div>
                <strong>Needs attention</strong>
                {preview.warnings.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>
          )}
          <details>
            <summary>
              Private and historical data that will not be copied
            </summary>
            <ul>
              {preview.excluded.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <button
        className="button button-large wide"
        disabled={busy || selectedDomains.length === 0}
      >
        {busy ? (
          <>
            <LoaderCircle className="spin" />
            Working…
          </>
        ) : preview ? (
          <>
            <Copy size={18} />
            Confirm and create draft
          </>
        ) : (
          <>
            Preview event copy
            <ArrowRight size={18} />
          </>
        )}
      </button>
    </form>
  );
}

export function SaveEventTemplateButton({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [saveDomains, setSaveDomains] = useState(domains);
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLElement>(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab" && modal.current) {
        const focusable = Array.from(
          modal.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]",
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/event-templates/events/${eventId}`, {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description"),
          domains: saveDomains,
        }),
      });
      setMessage("Template saved.");
      captureProductEvent("event_template_saved", {
        selected_domain_count: saveDomains.length,
      });
      window.dispatchEvent(new Event("programloom-template-changed"));
      close();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Could not save template.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="save-template-control">
      <button
        ref={trigger}
        type="button"
        className="text-button"
        onClick={() => {
          setSaveDomains(domains);
          setOpen(true);
        }}
      >
        <Save size={14} />
        Save as template
      </button>
      {message && <small role="status">{message}</small>}
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={modal}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`save-template-${eventId}`}
          >
            <h2 id={`save-template-${eventId}`}>Save reusable template</h2>
            <p>
              Configuration is copied; proposals, people, files, delivery
              history, calendar records, secrets, and external IDs are excluded.
            </p>
            <form onSubmit={save}>
              <label>
                Template name
                <input
                  name="name"
                  defaultValue={`${eventName} template`}
                  required
                  autoFocus
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  placeholder="When should organizers use this template?"
                />
              </label>
              <fieldset className="template-domains compact">
                <legend>Configuration to include</legend>
                <div>
                  {domains.map((domain) => (
                    <label className="check-row" key={domain}>
                      <input
                        type="checkbox"
                        checked={saveDomains.includes(domain)}
                        onChange={(event) =>
                          setSaveDomains((current) =>
                            event.target.checked
                              ? [...current, domain]
                              : current.filter((item) => item !== domain),
                          )
                        }
                      />
                      <span>{labels[domain]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  className="button"
                  disabled={busy || saveDomains.length === 0}
                >
                  {busy ? "Saving…" : "Save template"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
