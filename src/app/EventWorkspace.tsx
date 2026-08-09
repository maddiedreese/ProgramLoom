import { ArrowLeft, CalendarClock, CheckCircle2, ChevronRight, FileInput, GitBranch, GripVertical, Layers3, LoaderCircle, Plus, Send, Settings2, Tag, Trash2, UsersRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type User = { id: string; email: string; name: string };
type EventRecord = { id: string; organizationName: string; name: string; slug: string; timezone: string; startsAt: string; endsAt: string; status: string; storageMode: string };
type CfpForm = { id: string; name: string; slug: string; description: string | null; opensAt: string | null; closesAt: string | null; editClosesAt: string | null; allowDrafts: number | boolean; submissionLimit: number | null; confirmationSubject: string | null; confirmationBody: string | null; publishedAt: string | null; fieldCount: number };
type Field = { id: string; section: string; fieldType: string; fieldKey: string; label: string; description?: string | null; placeholder?: string | null; required: boolean; options?: string[]; position: number };
type Condition = { id: string; sourceFieldId: string; operator: string; compareValue?: unknown; targetFieldId: string; action: string };
type Feedback = { kind: "error" | "success"; message: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "The request could not be completed.");
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
  const [event, setEvent] = useState<EventRecord>();
  const [role, setRole] = useState<string>();
  const [forms, setForms] = useState<CfpForm[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [fields, setFields] = useState<Field[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [panel, setPanel] = useState<"fields" | "settings" | "logic">("fields");
  const selected = forms.find((form) => form.id === selectedId);
  const canManage = role === "owner" || role === "admin";

  async function loadForms(preferredId?: string) {
    const result = await api<{ forms: CfpForm[] }>(`/api/events/${eventId}/forms`);
    setForms(result.forms);
    setSelectedId(preferredId ?? selectedId ?? result.forms[0]?.id);
  }

  useEffect(() => {
    Promise.all([
      api<{ event: EventRecord; role: string }>(`/api/events/${eventId}`),
      api<{ forms: CfpForm[] }>(`/api/events/${eventId}/forms`),
    ]).then(([eventResult, formResult]) => {
      setEvent(eventResult.event); setRole(eventResult.role); setForms(formResult.forms); setSelectedId(formResult.forms[0]?.id);
    }).catch((error: Error) => setFeedback({ kind: "error", message: error.message })).finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (!selectedId) { setFields([]); setConditions([]); return; }
    api<{ fields: Field[]; conditions: Condition[] }>(`/api/events/${eventId}/forms/${selectedId}`)
      .then((result) => { setFields(result.fields); setConditions(result.conditions); })
      .catch((error: Error) => setFeedback({ kind: "error", message: error.message }));
  }, [eventId, selectedId]);

  async function createForm(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setBusy(true); setFeedback(undefined);
    const data = new FormData(formEvent.currentTarget);
    try {
      const result = await api<{ form: CfpForm }>(`/api/events/${eventId}/forms`, { method: "POST", body: JSON.stringify({ name: data.get("name"), description: "Share your session idea with our program team.", allowDrafts: true }) });
      formEvent.currentTarget.reset(); await loadForms(result.form.id); setPanel("fields");
      setFeedback({ kind: "success", message: "CFP created. Add the questions submitters should answer." });
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not create the CFP." }); }
    finally { setBusy(false); }
  }

  async function addField(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); if (!selectedId) return; setBusy(true); setFeedback(undefined);
    const data = new FormData(formEvent.currentTarget);
    const fieldType = String(data.get("fieldType"));
    const options = String(data.get("options") ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
    try {
      const result = await api<{ field: Field }>(`/api/events/${eventId}/forms/${selectedId}/fields`, { method: "POST", body: JSON.stringify({ section: data.get("section"), fieldType, fieldKey: data.get("fieldKey") || data.get("label"), label: data.get("label"), description: data.get("description") || undefined, placeholder: data.get("placeholder") || undefined, required: data.get("required") === "on", options: ["select", "multiselect"].includes(fieldType) ? options : undefined }) });
      setFields((current) => [...current, result.field]);
      setForms((current) => current.map((item) => item.id === selectedId ? { ...item, fieldCount: Number(item.fieldCount) + 1 } : item));
      formEvent.currentTarget.reset(); setFeedback({ kind: "success", message: `${result.field.label} was added.` });
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not add the field." }); }
    finally { setBusy(false); }
  }

  async function removeField(field: Field) {
    if (!selectedId || !window.confirm(`Delete “${field.label}”? Any logic using it will also be removed.`)) return;
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/forms/${selectedId}/fields/${field.id}`, { method: "DELETE" });
      setFields((current) => current.filter((item) => item.id !== field.id));
      setConditions((current) => current.filter((item) => item.sourceFieldId !== field.id && item.targetFieldId !== field.id));
      setForms((current) => current.map((item) => item.id === selectedId ? { ...item, fieldCount: Math.max(0, Number(item.fieldCount) - 1) } : item));
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not delete the field." }); }
    finally { setBusy(false); }
  }

  async function saveSettings(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); if (!selectedId) return; setBusy(true); setFeedback(undefined);
    const data = new FormData(formEvent.currentTarget);
    const iso = (key: string) => data.get(key) ? new Date(String(data.get(key))).toISOString() : null;
    try {
      const result = await api<{ form: CfpForm }>(`/api/events/${eventId}/forms/${selectedId}`, { method: "PATCH", body: JSON.stringify({ name: data.get("name"), slug: data.get("slug"), description: data.get("description"), opensAt: iso("opensAt"), closesAt: iso("closesAt"), editClosesAt: iso("editClosesAt"), allowDrafts: data.get("allowDrafts") === "on", submissionLimit: data.get("submissionLimit") ? Number(data.get("submissionLimit")) : null, confirmationSubject: data.get("confirmationSubject"), confirmationBody: data.get("confirmationBody") }) });
      setForms((current) => current.map((item) => item.id === selectedId ? { ...item, ...result.form } : item));
      setFeedback({ kind: "success", message: "CFP settings saved." });
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not save settings." }); }
    finally { setBusy(false); }
  }

  async function togglePublished() {
    if (!selectedId || !selected) return; setBusy(true); setFeedback(undefined);
    try {
      const published = !selected.publishedAt;
      const result = await api<{ form: CfpForm }>(`/api/events/${eventId}/forms/${selectedId}`, { method: "PATCH", body: JSON.stringify({ published }) });
      setForms((current) => current.map((item) => item.id === selectedId ? { ...item, ...result.form } : item));
      setFeedback({ kind: "success", message: published ? "CFP published and ready for submissions." : "CFP unpublished. Existing drafts and submissions are preserved." });
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not change publishing status." }); }
    finally { setBusy(false); }
  }

  async function addCondition(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); if (!selectedId) return; setBusy(true);
    const data = new FormData(formEvent.currentTarget);
    let compareValue: unknown = data.get("compareValue");
    if (data.get("operator") === "is_checked") compareValue = true;
    try {
      const result = await api<{ condition: Condition }>(`/api/events/${eventId}/forms/${selectedId}/conditions`, { method: "POST", body: JSON.stringify({ sourceFieldId: data.get("sourceFieldId"), operator: data.get("operator"), compareValue, targetFieldId: data.get("targetFieldId"), action: data.get("action") }) });
      setConditions((current) => [...current, result.condition]); formEvent.currentTarget.reset();
      setFeedback({ kind: "success", message: "Conditional rule added." });
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not add the rule." }); }
    finally { setBusy(false); }
  }

  async function removeCondition(conditionId: string) {
    if (!selectedId) return;
    try { await api(`/api/events/${eventId}/forms/${selectedId}/conditions/${conditionId}`, { method: "DELETE" }); setConditions((current) => current.filter((item) => item.id !== conditionId)); }
    catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not remove the rule." }); }
  }

  if (loading) return <main className="loading-page" aria-busy="true"><LoaderCircle className="spin" /> Loading event workspace…</main>;
  return <div className="event-workspace">
    <aside className="event-sidebar">
      <a className="wordmark" href="/"><span aria-hidden="true" className="mark">PL</span>ProgramLoom</a>
      <a className="back-link" href="/app"><ArrowLeft size={15} /> All events</a>
      <div className="event-identity"><small>{event?.organizationName}</small><strong>{event?.name ?? "Event"}</strong><span>{event?.status}</span></div>
      <nav className="event-nav" aria-label="Event workspace">
        <a className="active" href="#cfp"><FileInput size={18} /> Call for proposals</a>
        <span><UsersRound size={18} /> Submissions</span><span><CheckCircle2 size={18} /> Reviews</span><span><UsersRound size={18} /> Speakers</span><span><CalendarClock size={18} /> Agenda</span>
      </nav>
      <div className="sidebar-user"><span>{user.name}</span><small>{user.email}</small></div>
    </aside>
    <main id="main-content" className="event-main">
      <header className="event-heading"><div><p className="kicker">Call for proposals</p><h1>Collect the right ideas.</h1><p>Create focused forms with deadlines, reusable questions, and conditional paths.</p></div>{selected && canManage && <button className={`button ${selected.publishedAt ? "button-ghost" : ""}`} disabled={busy} onClick={togglePublished}>{selected.publishedAt ? "Unpublish" : <><Send size={16} /> Publish CFP</>}</button>}</header>
      {feedback && <div className={`form-status form-status-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</div>}
      <div className="cfp-layout">
        <aside className="form-list-panel">
          <div className="panel-title"><div><h2>Forms</h2><span>{forms.length}</span></div></div>
          <div className="form-list">{forms.map((form) => <button className={form.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(form.id)} key={form.id}><span><strong>{form.name}</strong><small>{form.publishedAt ? "Published" : "Draft"} · {form.fieldCount} fields</small></span><ChevronRight size={16} /></button>)}</div>
          {canManage && <form className="quick-create" onSubmit={createForm}><label htmlFor="new-form-name">New form</label><div><input id="new-form-name" name="name" placeholder="Main call for proposals" required /><button className="icon-button" title="Create form" disabled={busy}><Plus size={18} /></button></div></form>}
        </aside>
        <section className="builder-panel">
          {!selected ? <div className="builder-empty"><FileInput size={35} /><h2>Create your first CFP</h2><p>Give it a name, then assemble the questions your program team needs.</p></div> : <>
            <div className="builder-toolbar"><div><span className={`status-dot ${selected.publishedAt ? "live" : ""}`} />{selected.publishedAt ? "Published" : "Draft"}<strong>{selected.name}</strong></div><div className="builder-tabs"><button className={panel === "fields" ? "active" : ""} onClick={() => setPanel("fields")}><Layers3 size={15} /> Fields</button><button className={panel === "logic" ? "active" : ""} onClick={() => setPanel("logic")}><GitBranch size={15} /> Logic</button><button className={panel === "settings" ? "active" : ""} onClick={() => setPanel("settings")}><Settings2 size={15} /> Settings</button></div></div>
            {panel === "fields" && <div className="builder-content"><div className="field-stack">{fields.length ? fields.map((field) => <article className="field-row" key={field.id}><GripVertical size={17} /><div><small>{field.section} · {field.fieldType}</small><strong>{field.label}{field.required && <em>Required</em>}</strong>{field.description && <span>{field.description}</span>}{field.options && <span>{field.options.join(" · ")}</span>}</div>{canManage && <button className="plain-icon" title={`Delete ${field.label}`} onClick={() => removeField(field)} disabled={busy}><Trash2 size={16} /></button>}</article>) : <div className="inline-empty"><Layers3 size={26} /><strong>No fields yet</strong><span>Add a question using the panel below.</span></div>}</div>{canManage && <form className="field-editor" onSubmit={addField}><div className="editor-heading"><Tag size={18} /><div><h3>Add a field</h3><p>Each answer is stored as structured data.</p></div></div><div className="editor-grid"><label>Label<input name="label" placeholder="Session title" required /></label><label>Field key<input name="fieldKey" placeholder="session_title" /></label><label>Section<select name="section" defaultValue="session"><option value="welcome">Welcome</option><option value="session">Session</option><option value="speaker">Speaker</option><option value="custom">Custom</option></select></label><label>Type<select name="fieldType" defaultValue="text"><option value="text">Short text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="email">Email</option><option value="url">URL</option><option value="select">Single select</option><option value="multiselect">Multi-select</option><option value="checkbox">Checkbox</option><option value="date">Date</option><option value="file">File upload</option></select></label><label className="wide">Help text<input name="description" placeholder="Explain what a strong answer includes" /></label><label className="wide">Options <small>One per line; required for select fields</small><textarea name="options" rows={3} placeholder={'Workshop\nPanel\nLightning talk'} /></label><label className="check-row wide"><input type="checkbox" name="required" /><span><strong>Required answer</strong><small>Submitters cannot finish without it.</small></span></label><button className="button wide" disabled={busy}><Plus size={16} /> Add field</button></div></form>}</div>}
            {panel === "logic" && <div className="builder-content"><div className="logic-intro"><GitBranch size={24} /><div><h2>Conditional logic</h2><p>Show, hide, or require a field based on an earlier answer.</p></div></div>{conditions.map((condition) => <div className="condition-row" key={condition.id}><span>When <strong>{fields.find((field) => field.id === condition.sourceFieldId)?.label}</strong> {condition.operator.replaceAll("_", " ")} <strong>{String(condition.compareValue ?? "")}</strong>, {condition.action} <strong>{fields.find((field) => field.id === condition.targetFieldId)?.label}</strong>.</span>{canManage && <button className="plain-icon" onClick={() => removeCondition(condition.id)}><Trash2 size={15} /></button>}</div>)}{canManage && fields.length > 1 ? <form className="condition-form" onSubmit={addCondition}><label>When field<select name="sourceFieldId" required>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label><label>Operator<select name="operator" defaultValue="equals"><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option><option value="greater_than">Greater than</option><option value="less_than">Less than</option><option value="is_checked">Is checked</option></select></label><label>Value<input name="compareValue" /></label><label>Then<select name="action"><option value="show">Show</option><option value="hide">Hide</option><option value="require">Require</option></select></label><label>Target field<select name="targetFieldId" required>{fields.map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label><button className="button">Add rule</button></form> : <div className="inline-empty"><span>Add at least two fields to create a rule.</span></div>}</div>}
            {panel === "settings" && <form className="settings-form" key={selected.id} onSubmit={saveSettings}><div className="settings-section"><h2>Identity</h2><label>Form name<input name="name" defaultValue={selected.name} required /></label><label>Public URL slug<input name="slug" defaultValue={selected.slug} required /></label><label>Description<textarea name="description" rows={4} defaultValue={selected.description ?? ""} /></label></div><div className="settings-section"><h2>Availability</h2><div className="editor-grid"><label>Opens<input type="datetime-local" name="opensAt" defaultValue={toLocalInput(selected.opensAt)} /></label><label>Submission deadline<input type="datetime-local" name="closesAt" defaultValue={toLocalInput(selected.closesAt)} /></label><label>Edit deadline<input type="datetime-local" name="editClosesAt" defaultValue={toLocalInput(selected.editClosesAt)} /></label><label>Submissions per person<input type="number" min="1" max="100" name="submissionLimit" defaultValue={selected.submissionLimit ?? ""} /></label><label className="check-row wide"><input type="checkbox" name="allowDrafts" defaultChecked={Boolean(selected.allowDrafts)} /><span><strong>Allow drafts</strong><small>Submitters can save work before the deadline.</small></span></label></div></div><div className="settings-section"><h2>Confirmation email</h2><label>Subject<input name="confirmationSubject" defaultValue={selected.confirmationSubject ?? "We received your proposal"} /></label><label>Message<textarea name="confirmationBody" rows={5} defaultValue={selected.confirmationBody ?? "Thanks for sharing your idea. We’ll be in touch after the review period."} /></label></div>{canManage && <button className="button button-large" disabled={busy}>Save settings</button>}</form>}
          </>}
        </section>
      </div>
    </main>
  </div>;
}
