import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileInput,
  Files,
  GitBranch,
  Gauge,
  GripVertical,
  Layers3,
  LoaderCircle,
  Mail,
  Plus,
  Send,
  Settings2,
  Tag,
  Trash2,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";
import { EventPageGuide } from "./EventPageGuide";
import { useParams } from "react-router-dom";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  organizationName: string;
  organizationSlug: string;
  name: string;
  slug: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  status: string;
  storageMode: string;
};
type CfpForm = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  opensAt: string | null;
  closesAt: string | null;
  editClosesAt: string | null;
  allowDrafts: number | boolean;
  submissionLimit: number | null;
  confirmationSubject: string | null;
  confirmationBody: string | null;
  publishedAt: string | null;
  fieldCount: number;
};
type Field = {
  id: string;
  section: string;
  fieldType: string;
  fieldKey: string;
  label: string;
  description?: string | null;
  placeholder?: string | null;
  required: boolean;
  searchable: boolean;
  options?: string[];
  position: number;
};
type Condition = {
  id: string;
  sourceFieldId: string;
  operator: string;
  compareValue?: unknown;
  targetFieldId: string;
  action: string;
};
type Track = {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  position: number;
};
type Feedback = { kind: "error" | "success"; message: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "The request could not be completed.",
    );
  return result;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function EventWorkspace({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const requestedFormId = new URLSearchParams(window.location.search).get(
    "form",
  );
  const [event, setEvent] = useState<EventRecord>();
  const [role, setRole] = useState<string>();
  const [forms, setForms] = useState<CfpForm[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [fields, setFields] = useState<Field[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [panel, setPanel] = useState<"fields" | "settings" | "logic">("fields");
  const selected = forms.find((form) => form.id === selectedId);
  const canManage = role === "owner" || role === "admin";

  async function loadForms(preferredId?: string) {
    const result = await api<{ forms: CfpForm[] }>(
      `/api/events/${eventId}/forms`,
    );
    setForms(result.forms);
    setSelectedId(preferredId ?? selectedId ?? result.forms[0]?.id);
  }

  useEffect(() => {
    api<{ event: EventRecord; role: string }>(`/api/events/${eventId}`)
      .then(async (eventResult) => {
        if (eventResult.role === "speaker") {
          window.location.replace(`/app/events/${eventId}/speaker`);
          return;
        }
        if (eventResult.role === "reviewer") {
          window.location.replace(`/app/events/${eventId}/reviews`);
          return;
        }
        setEvent(eventResult.event);
        setRole(eventResult.role);
        const [formResult, trackResult] = await Promise.all([
          api<{ forms: CfpForm[] }>(`/api/events/${eventId}/forms`),
          api<{ tracks: Track[] }>(`/api/events/${eventId}/tracks`),
        ]);
        setForms(formResult.forms);
        setSelectedId(
          formResult.forms.some((form) => form.id === requestedFormId)
            ? (requestedFormId ?? formResult.forms[0]?.id)
            : formResult.forms[0]?.id,
        );
        setTracks(trackResult.tracks);
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (!selectedId) {
      setFields([]);
      setConditions([]);
      return;
    }
    api<{ fields: Field[]; conditions: Condition[] }>(
      `/api/events/${eventId}/forms/${selectedId}`,
    )
      .then((result) => {
        setFields(result.fields);
        setConditions(result.conditions);
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
  }, [eventId, selectedId]);

  async function createForm(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formElement = formEvent.currentTarget;
    setBusy(true);
    setFeedback(undefined);
    const data = new FormData(formElement);
    try {
      const result = await api<{ form: CfpForm }>(
        `/api/events/${eventId}/forms`,
        {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            description: "Share your session idea with our program team.",
            allowDrafts: true,
          }),
        },
      );
      formElement.reset();
      await loadForms(result.form.id);
      setPanel("fields");
      setFeedback({
        kind: "success",
        message: "CFP created. Add the questions submitters should answer.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not create the CFP.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addField(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedId) return;
    const formElement = formEvent.currentTarget;
    setBusy(true);
    setFeedback(undefined);
    const data = new FormData(formElement);
    const fieldType = String(data.get("fieldType"));
    const options = String(data.get("options") ?? "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      const result = await api<{ field: Field }>(
        `/api/events/${eventId}/forms/${selectedId}/fields`,
        {
          method: "POST",
          body: JSON.stringify({
            section: data.get("section"),
            fieldType,
            fieldKey: data.get("fieldKey") || data.get("label"),
            label: data.get("label"),
            description: data.get("description") || undefined,
            placeholder: data.get("placeholder") || undefined,
            required: data.get("required") === "on",
            searchable: data.get("searchable") === "on",
            options: ["select", "multiselect"].includes(fieldType)
              ? options
              : undefined,
          }),
        },
      );
      setFields((current) => [...current, result.field]);
      setForms((current) =>
        current.map((item) =>
          item.id === selectedId
            ? { ...item, fieldCount: Number(item.fieldCount) + 1 }
            : item,
        ),
      );
      formElement.reset();
      setFeedback({
        kind: "success",
        message: `${result.field.label} was added.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not add the field.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addTrack(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formElement = formEvent.currentTarget;
    const data = new FormData(formElement);
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await api<{ track: Track }>(
        `/api/events/${eventId}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            color: data.get("color"),
          }),
        },
      );
      setTracks((current) => [...current, result.track]);
      formElement.reset();
      setFeedback({
        kind: "success",
        message: `${result.track.name} is ready for forms and scheduling.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not add the track.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeField(field: Field) {
    if (
      !selectedId ||
      !window.confirm(
        `Delete “${field.label}”? Any logic using it will also be removed.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        `/api/events/${eventId}/forms/${selectedId}/fields/${field.id}`,
        { method: "DELETE" },
      );
      setFields((current) => current.filter((item) => item.id !== field.id));
      setConditions((current) =>
        current.filter(
          (item) =>
            item.sourceFieldId !== field.id && item.targetFieldId !== field.id,
        ),
      );
      setForms((current) =>
        current.map((item) =>
          item.id === selectedId
            ? { ...item, fieldCount: Math.max(0, Number(item.fieldCount) - 1) }
            : item,
        ),
      );
      setFeedback({
        kind: "success",
        message: `“${field.label}” and any rules that used it were deleted. Next, review the remaining form fields before publishing.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not delete the field.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setFeedback(undefined);
    const data = new FormData(formEvent.currentTarget);
    const iso = (key: string) =>
      data.get(key) ? new Date(String(data.get(key))).toISOString() : null;
    const closesAt = iso("closesAt");
    const editClosesAt = iso("editClosesAt");
    try {
      const result = await api<{ form: CfpForm }>(
        `/api/events/${eventId}/forms/${selectedId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: data.get("name"),
            slug: data.get("slug"),
            description: data.get("description"),
            opensAt: iso("opensAt"),
            closesAt,
            editClosesAt,
            allowDrafts: data.get("allowDrafts") === "on",
            submissionLimit: data.get("submissionLimit")
              ? Number(data.get("submissionLimit"))
              : null,
            confirmationSubject: data.get("confirmationSubject"),
            confirmationBody: data.get("confirmationBody"),
          }),
        },
      );
      setForms((current) =>
        current.map((item) =>
          item.id === selectedId ? { ...item, ...result.form } : item,
        ),
      );
      setFeedback({
        kind: "success",
        message:
          closesAt && closesAt <= new Date().toISOString()
            ? "CFP settings saved. Submissions are now closed, and proposal editing is locked. Next, verify the anonymous public portal."
            : "CFP settings saved. The public portal now uses these durable availability and editing deadlines.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not save settings.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function togglePublished() {
    if (!selectedId || !selected) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const published = !selected.publishedAt;
      const result = await api<{ form: CfpForm }>(
        `/api/events/${eventId}/forms/${selectedId}`,
        { method: "PATCH", body: JSON.stringify({ published }) },
      );
      setForms((current) =>
        current.map((item) =>
          item.id === selectedId ? { ...item, ...result.form } : item,
        ),
      );
      setFeedback({
        kind: "success",
        message: published
          ? "CFP published and ready for submissions."
          : "CFP unpublished. Existing drafts and submissions are preserved.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not change publishing status.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addCondition(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedId) return;
    const formElement = formEvent.currentTarget;
    setBusy(true);
    const data = new FormData(formElement);
    let compareValue: unknown = data.get("compareValue");
    if (data.get("operator") === "is_checked") compareValue = true;
    try {
      const result = await api<{ condition: Condition }>(
        `/api/events/${eventId}/forms/${selectedId}/conditions`,
        {
          method: "POST",
          body: JSON.stringify({
            sourceFieldId: data.get("sourceFieldId"),
            operator: data.get("operator"),
            compareValue,
            targetFieldId: data.get("targetFieldId"),
            action: data.get("action"),
          }),
        },
      );
      setConditions((current) => [...current, result.condition]);
      formElement.reset();
      setFeedback({ kind: "success", message: "Conditional rule added." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not add the rule.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeCondition(conditionId: string) {
    if (
      !selectedId ||
      !window.confirm(
        "Remove this conditional rule? The affected field will return to its default visibility.",
      )
    )
      return;
    try {
      await api(
        `/api/events/${eventId}/forms/${selectedId}/conditions/${conditionId}`,
        { method: "DELETE" },
      );
      setConditions((current) =>
        current.filter((item) => item.id !== conditionId),
      );
      setFeedback({
        kind: "success",
        message:
          "Conditional rule removed. Next, preview the CFP to verify the field’s default visibility.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not remove the rule.",
      });
    }
  }

  if (loading)
    return (
      <main className="loading-page" aria-busy="true">
        <LoaderCircle className="spin" /> Loading event workspace…
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
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> All events
        </a>
        <div className="event-identity">
          <small>{event?.organizationName}</small>
          <strong>{event?.name ?? "Event"}</strong>
          <span>{event?.status}</span>
        </div>
        <EventLifecycleNav eventId={eventId} active="cfp" role={role} />
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="event-main">
        <header className="event-heading">
          <div>
            <p className="kicker">Call for proposals</p>
            <h1>Build and publish your proposal form.</h1>
            <p>
              Ask for the information reviewers need, set a deadline, and open
              the call when it is ready for submitters.
            </p>
          </div>
          {selected && canManage && (
            <button
              className={`button ${selected.publishedAt ? "button-ghost" : ""}`}
              disabled={busy}
              onClick={togglePublished}
            >
              {selected.publishedAt ? (
                "Unpublish"
              ) : (
                <>
                  <Send size={16} /> Publish CFP
                </>
              )}
            </button>
          )}
        </header>
        <EventPageGuide eventId={eventId} surface="cfp" />
        {feedback && (
          <div
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        <div className="cfp-layout">
          <aside className="form-list-panel">
            <div className="panel-title">
              <div>
                <h2>Forms</h2>
                <span>{forms.length}</span>
              </div>
            </div>
            <div className="form-list">
              {forms.map((form) => (
                <button
                  className={form.id === selectedId ? "selected" : ""}
                  onClick={() => setSelectedId(form.id)}
                  key={form.id}
                >
                  <span>
                    <strong>{form.name}</strong>
                    <small>
                      {form.publishedAt ? "Published" : "Draft"} ·{" "}
                      {form.fieldCount} fields
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
            {canManage && (
              <form className="quick-create" onSubmit={createForm}>
                <label htmlFor="new-form-name">New form</label>
                <div>
                  <input
                    id="new-form-name"
                    name="name"
                    placeholder="Main call for proposals"
                    required
                  />
                  <button className="button button-small" disabled={busy}>
                    <Plus size={16} /> Create form
                  </button>
                </div>
              </form>
            )}
          </aside>
          <section className="builder-panel">
            {!selected ? (
              <div className="builder-empty">
                <FileInput size={35} />
                <h2>Create your first CFP</h2>
                <p>
                  Give it a name, then assemble the questions your program team
                  needs.
                </p>
              </div>
            ) : (
              <>
                <div className="builder-toolbar">
                  <div>
                    <span
                      className={`status-dot ${selected.publishedAt ? "live" : ""}`}
                    />
                    {selected.publishedAt ? "Published" : "Draft"}
                    <strong>{selected.name}</strong>
                    {selected.publishedAt && event && (
                      <a
                        className="public-form-link"
                        href={`/c/${event.organizationSlug}/${event.slug}/${selected.slug}`}
                      >
                        Open public form <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  <div className="builder-tabs">
                    <button
                      className={panel === "fields" ? "active" : ""}
                      onClick={() => setPanel("fields")}
                    >
                      <Layers3 size={15} /> Questions
                    </button>
                    <button
                      className={panel === "logic" ? "active" : ""}
                      onClick={() => setPanel("logic")}
                    >
                      <GitBranch size={15} /> Conditional logic
                    </button>
                    <button
                      className={panel === "settings" ? "active" : ""}
                      onClick={() => setPanel("settings")}
                    >
                      <Settings2 size={15} /> Form settings
                    </button>
                  </div>
                </div>
                {panel === "fields" && (
                  <div className="builder-content">
                    {canManage && (
                      <section className="taxonomy-card">
                        <div>
                          <p className="kicker">Event taxonomy</p>
                          <h2>Tracks</h2>
                          <p>
                            Tracks help attendees and reviewers group related
                            proposals. Create the choices here, then add a
                            single-choice question named “Track” using the same
                            choices. Add formats such as “Talk (30 min)” in the
                            same way with a question named “Format.”
                          </p>
                        </div>
                        <div
                          className="track-chip-list"
                          aria-label="Event tracks"
                        >
                          {tracks.length ? (
                            tracks.map((track) => (
                              <span key={track.id}>
                                <i style={{ background: track.color }} />
                                {track.name}
                              </span>
                            ))
                          ) : (
                            <span>No tracks configured yet</span>
                          )}
                        </div>
                        <form onSubmit={addTrack}>
                          <label>
                            Track name
                            <input
                              name="name"
                              placeholder="AI Engineering"
                              required
                            />
                          </label>
                          <label>
                            Color
                            <input
                              name="color"
                              type="color"
                              defaultValue="#315c45"
                            />
                          </label>
                          <button
                            className="button button-small"
                            disabled={busy}
                          >
                            <Plus size={15} /> Add track
                          </button>
                        </form>
                      </section>
                    )}
                    <div className="field-stack">
                      {fields.length ? (
                        fields.map((field) => (
                          <article className="field-row" key={field.id}>
                            <GripVertical size={17} />
                            <div>
                              <small>
                                {field.section} · {field.fieldType}
                              </small>
                              <strong>
                                {field.label}
                                {field.required && <em>Required</em>}
                                {field.searchable && <em>Searchable</em>}
                              </strong>
                              {field.description && (
                                <span>{field.description}</span>
                              )}
                              {field.options && (
                                <span>{field.options.join(" · ")}</span>
                              )}
                            </div>
                            {canManage && (
                              <button
                                className="button button-small button-ghost"
                                aria-label={`Delete field: ${field.label}`}
                                onClick={() => removeField(field)}
                                disabled={busy}
                              >
                                <Trash2 size={16} /> Delete field
                              </button>
                            )}
                          </article>
                        ))
                      ) : (
                        <div className="inline-empty">
                          <Layers3 size={26} />
                          <strong>No fields yet</strong>
                          <span>Add a question using the panel below.</span>
                        </div>
                      )}
                    </div>
                    {canManage && (
                      <form className="field-editor" onSubmit={addField}>
                        <div className="editor-heading">
                          <Tag size={18} />
                          <div>
                            <h3>Add a field</h3>
                            <p>Each answer is stored as structured data.</p>
                          </div>
                        </div>
                        <div className="editor-grid">
                          <label>
                            Label
                            <input
                              name="label"
                              placeholder="Session title"
                              required
                            />
                          </label>
                          <label>
                            Field key
                            <input
                              name="fieldKey"
                              placeholder="session_title"
                            />
                            <small>
                              A stable internal name used for exports and saved
                              views. Leave blank to generate it from the label.
                            </small>
                          </label>
                          <label>
                            Section
                            <select name="section" defaultValue="session">
                              <option value="welcome">Welcome</option>
                              <option value="session">Session</option>
                              <option value="speaker">Speaker</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          <label>
                            Type
                            <select name="fieldType" defaultValue="text">
                              <option value="text">Short text</option>
                              <option value="textarea">Long text</option>
                              <option value="number">Number</option>
                              <option value="email">Email</option>
                              <option value="url">URL</option>
                              <option value="select">Single select</option>
                              <option value="multiselect">Multi-select</option>
                              <option value="checkbox">Checkbox</option>
                              <option value="date">Date</option>
                              <option value="file">File upload</option>
                            </select>
                          </label>
                          <label className="wide">
                            Help text
                            <input
                              name="description"
                              placeholder="Explain what a strong answer includes"
                            />
                          </label>
                          <label className="wide">
                            Options{" "}
                            <small>
                              One per line; required for select fields
                            </small>
                            <textarea
                              name="options"
                              rows={3}
                              placeholder={"Workshop\nPanel\nLightning talk"}
                            />
                          </label>
                          <label className="check-row wide">
                            <input type="checkbox" name="required" />
                            <span>
                              <strong>Required answer</strong>
                              <small>
                                Submitters cannot finish without it.
                              </small>
                            </span>
                          </label>
                          <label className="check-row wide">
                            <input type="checkbox" name="searchable" />
                            <span>
                              <strong>Include in organizer search</strong>
                              <small>
                                The Submission Workspace can search this answer.
                                Private values should remain excluded.
                              </small>
                            </span>
                          </label>
                          <button className="button wide" disabled={busy}>
                            <Plus size={16} /> Add field
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
                {panel === "logic" && (
                  <div className="builder-content">
                    <div className="logic-intro">
                      <GitBranch size={24} />
                      <div>
                        <h2>Conditional logic</h2>
                        <p>
                          Show, hide, or require a field based on an earlier
                          answer.
                        </p>
                      </div>
                    </div>
                    {conditions.map((condition) => (
                      <div className="condition-row" key={condition.id}>
                        <span>
                          When{" "}
                          <strong>
                            {
                              fields.find(
                                (field) => field.id === condition.sourceFieldId,
                              )?.label
                            }
                          </strong>{" "}
                          {condition.operator.replaceAll("_", " ")}{" "}
                          <strong>
                            {String(condition.compareValue ?? "")}
                          </strong>
                          , {condition.action}{" "}
                          <strong>
                            {
                              fields.find(
                                (field) => field.id === condition.targetFieldId,
                              )?.label
                            }
                          </strong>
                          .
                        </span>
                        {canManage && (
                          <button
                            className="button button-small button-ghost"
                            aria-label="Remove conditional rule"
                            onClick={() => removeCondition(condition.id)}
                          >
                            <Trash2 size={15} /> Remove rule
                          </button>
                        )}
                      </div>
                    ))}
                    {canManage && fields.length > 1 ? (
                      <form className="condition-form" onSubmit={addCondition}>
                        <label>
                          When field
                          <select name="sourceFieldId" required>
                            {fields.map((field) => (
                              <option value={field.id} key={field.id}>
                                {field.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Operator
                          <select name="operator" defaultValue="equals">
                            <option value="equals">Equals</option>
                            <option value="not_equals">Does not equal</option>
                            <option value="contains">Contains</option>
                            <option value="greater_than">Greater than</option>
                            <option value="less_than">Less than</option>
                            <option value="is_checked">Is checked</option>
                          </select>
                        </label>
                        <label>
                          Value
                          <input name="compareValue" />
                        </label>
                        <label>
                          Then
                          <select name="action">
                            <option value="show">Show</option>
                            <option value="hide">Hide</option>
                            <option value="require">Require</option>
                          </select>
                        </label>
                        <label>
                          Target field
                          <select name="targetFieldId" required>
                            {fields.map((field) => (
                              <option value={field.id} key={field.id}>
                                {field.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="button">Add rule</button>
                      </form>
                    ) : (
                      <div className="inline-empty">
                        <span>Add at least two fields to create a rule.</span>
                      </div>
                    )}
                  </div>
                )}
                {panel === "settings" && (
                  <form
                    className="settings-form"
                    key={selected.id}
                    onSubmit={saveSettings}
                  >
                    <div className="settings-section">
                      <h2>Identity</h2>
                      <label>
                        Form name
                        <input
                          name="name"
                          defaultValue={selected.name}
                          required
                        />
                      </label>
                      <label>
                        Public URL slug
                        <input
                          name="slug"
                          defaultValue={selected.slug}
                          required
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          name="description"
                          rows={4}
                          defaultValue={selected.description ?? ""}
                        />
                      </label>
                    </div>
                    <div className="settings-section">
                      <h2>Availability</h2>
                      <div className="editor-grid">
                        <label>
                          Opens
                          <input
                            type="datetime-local"
                            name="opensAt"
                            defaultValue={toLocalInput(selected.opensAt)}
                          />
                        </label>
                        <label>
                          Submission deadline
                          <input
                            type="datetime-local"
                            name="closesAt"
                            defaultValue={toLocalInput(selected.closesAt)}
                          />
                        </label>
                        <label>
                          Edit deadline
                          <input
                            type="datetime-local"
                            name="editClosesAt"
                            defaultValue={toLocalInput(selected.editClosesAt)}
                          />
                        </label>
                        <label>
                          Submissions per person
                          <input
                            type="number"
                            min="1"
                            max="100"
                            name="submissionLimit"
                            defaultValue={selected.submissionLimit ?? ""}
                          />
                        </label>
                        <label className="check-row wide">
                          <input
                            type="checkbox"
                            name="allowDrafts"
                            defaultChecked={Boolean(selected.allowDrafts)}
                          />
                          <span>
                            <strong>Allow drafts</strong>
                            <small>
                              Submitters can save work before the deadline.
                            </small>
                          </span>
                        </label>
                      </div>
                    </div>
                    <div className="settings-section">
                      <h2>Confirmation email</h2>
                      <label>
                        Subject
                        <input
                          name="confirmationSubject"
                          defaultValue={
                            selected.confirmationSubject ??
                            "We received your proposal"
                          }
                        />
                      </label>
                      <label>
                        Message
                        <textarea
                          name="confirmationBody"
                          rows={5}
                          defaultValue={
                            selected.confirmationBody ??
                            "Thanks for sharing your idea. We’ll be in touch after the review period."
                          }
                        />
                      </label>
                    </div>
                    {canManage && (
                      <button className="button button-large" disabled={busy}>
                        Save settings
                      </button>
                    )}
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
