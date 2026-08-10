import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Code2,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { captureProductEvent } from "../lib/telemetry";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";

type User = { id: string; email: string; name: string };
type Template = {
  id: string;
  category: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  mergeFields: string[];
  enabled: boolean;
  version: number;
};
type Recipient = {
  key: string;
  email: string;
  name: string;
  entityType: string;
  entityId: string;
  context: string;
};
type Message = {
  id: string;
  category: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  status: string;
  providerId: string | null;
  attempts: number;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
};
type Overview = {
  event: { id: string; name: string };
  scope: { speakerId: string } | null;
  supportedMergeFields: string[];
  templates: Template[];
  stats: Record<string, number>;
  messages: Message[];
  pagination: { page: number; pageSize: number; total: number };
};

const categoryLabels: Record<string, string> = {
  submission_confirmation: "CFP confirmations",
  draft_reminder: "Draft reminders",
  deadline_reminder: "Deadline reminders",
  reviewer_invitation: "Reviewer invitations",
  reviewer_reminder: "Reviewer reminders",
  change_request: "Change requests",
  decision_acceptance: "Acceptance decisions",
  decision_waitlist: "Waitlist decisions",
  decision_rejection: "Rejection decisions",
  speaker_invitation: "Speaker invitations",
  onboarding_reminder: "Onboarding reminders",
  content_reminder: "Content reminders",
  scheduling_notice: "Scheduling notices",
  calendar_invitation: "Calendar invitations",
  calendar_update: "Calendar updates",
  calendar_cancellation: "Calendar cancellations",
  speaker_message: "Speaker messages",
  crm_outreach: "CRM outreach",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
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

export function EventCommunications({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const initialQuery = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const requestedMessageId = initialQuery.get("message") ?? "";
  const submissionBulk = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("submissionBulk") ?? "",
    [],
  );
  const [overview, setOverview] = useState<Overview>();
  const [tab, setTab] = useState<"outbox" | "compose" | "templates">(
    initialQuery.get("compose") === "1" ? "compose" : "outbox",
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    subject: string;
    bodyHtml: string;
    bodyText: string;
  }>();
  const [filters, setFilters] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return {
      category: query.get("category") ?? "",
      status: query.get("status") ?? "",
      search: query.get("search") ?? "",
      speaker: query.get("speaker") ?? "",
    };
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  }>();

  const selectedTemplate = overview?.templates.find(
    (item) => item.id === selectedTemplateId,
  );

  async function load(silent = false) {
    if (!silent) setBusy(true);
    try {
      const query = new URLSearchParams();
      if (filters.category) query.set("category", filters.category);
      if (filters.status) query.set("status", filters.status);
      if (filters.search) query.set("search", filters.search);
      if (filters.speaker) query.set("speaker", filters.speaker);
      const result = await api<Overview>(
        `/api/communications/events/${eventId}?${query}`,
      );
      setOverview(result);
      setSelectedTemplateId(
        (current) =>
          current ||
          result.templates.find(
            (template) => template.category === filters.category,
          )?.id ||
          result.templates[0]?.id ||
          "",
      );
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Communications could not be loaded.",
      });
    } finally {
      if (!silent) setBusy(false);
    }
  }

  useEffect(() => {
    const initial = window.setTimeout(
      () => void load(),
      filters.search ? 250 : 0,
    );
    const interval = window.setInterval(() => void load(true), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [
    eventId,
    filters.category,
    filters.status,
    filters.search,
    filters.speaker,
  ]);

  useEffect(() => {
    if (!requestedMessageId || !overview?.messages.length) return;
    const target = document.getElementById(`message-${requestedMessageId}`);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [overview?.messages, requestedMessageId]);

  useEffect(() => {
    if (!selectedTemplate) return;
    let cancelled = false;
    setSelectedRecipients([]);
    setPreview(undefined);
    api<{ recipients: Recipient[] }>(
      `/api/communications/events/${eventId}/recipients?category=${selectedTemplate.category}`,
    )
      .then(async (result) => {
        if (!submissionBulk) {
          if (!cancelled) setRecipients(result.recipients);
          return;
        }
        const handoff = await api<{
          submissionIds: string[];
          count: number;
          category: string;
        }>(
          `/api/submission-workspace/events/${eventId}/bulk/${submissionBulk}/submission-ids`,
        );
        if (handoff.category !== selectedTemplate.category) return;
        const permitted = new Set(handoff.submissionIds);
        const eligible = result.recipients.filter(
          (recipient) =>
            recipient.entityType === "submission" &&
            permitted.has(recipient.entityId),
        );
        if (!cancelled) {
          setRecipients(eligible);
          setSelectedRecipients(eligible.map((recipient) => recipient.key));
          setTab("compose");
          setFeedback({
            kind: "success",
            message: `${eligible.length} eligible ${eligible.length === 1 ? "recipient" : "recipients"} selected from ${handoff.count} proposals. Review the recipient list before sending.`,
          });
        }
      })
      .catch(
        (error) =>
          !cancelled &&
          setFeedback({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Recipients could not be loaded.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [eventId, selectedTemplate?.category, submissionBulk]);

  const selectedRecipient = recipients.find((recipient) =>
    selectedRecipients.includes(recipient.key),
  );
  const outboxStats = useMemo(
    () => [
      {
        label: "Queued",
        value:
          (overview?.stats.queued ?? 0) + (overview?.stats.processing ?? 0),
        icon: Clock3,
      },
      { label: "Sent", value: overview?.stats.sent ?? 0, icon: Send },
      {
        label: "Delivered",
        value: overview?.stats.delivered ?? 0,
        icon: CheckCircle2,
      },
      {
        label: "Needs attention",
        value: (overview?.stats.failed ?? 0) + (overview?.stats.bounced ?? 0),
        icon: XCircle,
      },
    ],
    [overview],
  );

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setFeedback(undefined);
    try {
      await api(`/api/communications/events/${eventId}/templates`, {
        method: "PUT",
        body: JSON.stringify({
          id: selectedTemplate.id,
          category: selectedTemplate.category,
          name: data.get("name"),
          subject: data.get("subject"),
          bodyHtml: data.get("bodyHtml"),
          bodyText: data.get("bodyText"),
          enabled: data.get("enabled") === "on",
        }),
      });
      setFeedback({
        kind: "success",
        message: "Template saved with a new audited version.",
      });
      captureProductEvent("communication_template_saved", {
        category: selectedTemplate.category,
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Template could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function previewMessage(organizerMessage?: string) {
    if (!selectedTemplate || !selectedRecipient) return;
    setBusy(true);
    try {
      const result = await api<{ preview: typeof preview }>(
        `/api/communications/events/${eventId}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            templateId: selectedTemplate.id,
            category: selectedTemplate.category,
            recipientKey: selectedRecipient.key,
            organizerMessage,
          }),
        },
      );
      setPreview(result.preview);
      captureProductEvent("communication_previewed", {
        category: selectedTemplate.category,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Preview could not be generated.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function compose(form: HTMLFormElement, testOnly = false) {
    const data = new FormData(form);
    if (!selectedTemplate || !selectedRecipients.length) return;
    const organizerMessage = String(data.get("organizerMessage") ?? "");
    if (testOnly) {
      setBusy(true);
      try {
        await api(`/api/communications/events/${eventId}/test-send`, {
          method: "POST",
          body: JSON.stringify({
            templateId: selectedTemplate.id,
            category: selectedTemplate.category,
            recipientKey: selectedRecipients[0],
            organizerMessage,
          }),
        });
        setFeedback({
          kind: "success",
          message: `Test queued to ${user.email}.`,
        });
      } catch (error) {
        setFeedback({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Test could not be queued.",
        });
      } finally {
        setBusy(false);
      }
      return;
    }
    const sendNow = data.get("delivery") === "now";
    const scheduledValue = String(data.get("scheduledFor") ?? "");
    const action = sendNow
      ? "queue these messages now"
      : scheduledValue
        ? "schedule these messages"
        : "prepare these messages without sending";
    if (
      !window.confirm(
        `Confirm ${selectedRecipients.length} recipient${selectedRecipients.length === 1 ? "" : "s"} and ${action}?`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api<{ count: number; status: string }>(
        `/api/communications/events/${eventId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            templateId: selectedTemplate.id,
            recipientKeys: selectedRecipients,
            confirmedRecipientCount: selectedRecipients.length,
            organizerMessage,
            scheduledFor:
              !sendNow && scheduledValue
                ? new Date(scheduledValue).toISOString()
                : null,
            sendNow,
            operationKey: crypto.randomUUID(),
          }),
        },
      );
      setFeedback({
        kind: "success",
        message: `${result.count} communication${result.count === 1 ? "" : "s"} ${result.status}. The durable state is visible in Outbox; open the recipient timeline or retry any failed delivery there.`,
      });
      setSelectedRecipients([]);
      setTab("outbox");
      captureProductEvent("communications_prepared", {
        category: selectedTemplate.category,
        delivery: result.status,
        recipient_count: result.count,
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Communications could not be prepared.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function messageAction(message: Message, action: "retry" | "cancel") {
    if (
      !window.confirm(
        `${action === "retry" ? "Retry" : "Cancel"} this communication?`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        `/api/communications/events/${eventId}/messages/${message.id}/${action}`,
        { method: "POST" },
      );
      setFeedback({
        kind: "success",
        message:
          action === "retry" ? "Retry queued." : "Communication cancelled.",
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Message could not be updated.",
      });
    } finally {
      setBusy(false);
    }
  }

  function clearSpeakerScope() {
    const url = new URL(window.location.href);
    url.searchParams.delete("speaker");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setFilters((current) => ({ ...current, speaker: "" }));
  }

  if (!overview && busy)
    return (
      <main className="loading-page" aria-busy="true">
        <LoaderCircle className="spin" /> Loading communications…
      </main>
    );

  return (
    <div className="event-workspace communications-shell">
      <aside className="event-sidebar">
        <a className="back-link" href={`/app/events/${eventId}`}>
          <ArrowLeft size={16} /> Event setup
        </a>
        <div className="event-identity">
          <span>DF</span>
          <div>
            <small>Event workspace</small>
            <strong>{overview?.event.name ?? "Communications"}</strong>
          </div>
        </div>
        <EventLifecycleNav eventId={eventId} active="communications" />
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="event-main communications-main">
        <header className="event-heading communications-heading">
          <div>
            <p className="kicker">Unified communications</p>
            <h1>Every message, one accountable outbox.</h1>
            <p>
              Configure, preview, schedule, deliver, and audit program
              communications.
            </p>
          </div>
          <button
            className="button button-ghost"
            onClick={() => load()}
            disabled={busy}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </header>
        {feedback && (
          <div
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        <section
          className="communications-stats"
          aria-label="Communication status"
        >
          {outboxStats.map(({ label, value, icon: Icon }) => (
            <article key={label}>
              <Icon size={18} />
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
        <div
          className="communications-tabs"
          role="tablist"
          aria-label="Communications center"
        >
          <button
            role="tab"
            aria-selected={tab === "outbox"}
            onClick={() => setTab("outbox")}
          >
            <Inbox size={16} /> Outbox
          </button>
          <button
            role="tab"
            aria-selected={tab === "compose"}
            onClick={() => setTab("compose")}
          >
            <Send size={16} /> Compose
          </button>
          <button
            role="tab"
            aria-selected={tab === "templates"}
            onClick={() => setTab("templates")}
          >
            <Settings2 size={16} /> Templates
          </button>
        </div>

        {tab === "outbox" && (
          <section className="communications-panel">
            {overview?.scope?.speakerId && (
              <div className="communications-scope">
                <span>Showing this speaker’s communication timeline</span>
                <button type="button" onClick={clearSpeakerScope}>
                  Clear speaker filter
                </button>
              </div>
            )}
            <div className="communications-filters">
              <label>
                Search
                <span className="search-input">
                  <Search size={15} />
                  <input
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        search: event.target.value,
                      }))
                    }
                    placeholder="Recipient or subject"
                  />
                </span>
              </label>
              <label>
                Category
                <select
                  value={filters.category}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                >
                  <option value="">All categories</option>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="">All statuses</option>
                  {[
                    "prepared",
                    "queued",
                    "processing",
                    "sent",
                    "delivered",
                    "bounced",
                    "failed",
                    "cancelled",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="outbox-table"
              role="table"
              aria-label="Event communication outbox"
            >
              <div className="outbox-row outbox-header" role="row">
                <span>Recipient</span>
                <span>Communication</span>
                <span>Status</span>
                <span>Date</span>
                <span>Actions</span>
              </div>
              {overview?.messages.map((message) => (
                <div
                  className="outbox-row"
                  role="row"
                  id={`message-${message.id}`}
                  tabIndex={-1}
                  key={message.id}
                >
                  <span>
                    <strong>
                      {message.recipientName || message.recipientEmail}
                    </strong>
                    <small>{message.recipientEmail}</small>
                  </span>
                  <span>
                    <strong>{message.subject}</strong>
                    <small>
                      {categoryLabels[message.category] ?? message.category}
                    </small>
                  </span>
                  <span>
                    <i
                      className={`message-status message-status-${message.status}`}
                    >
                      {message.status}
                    </i>
                    {message.lastError && <small>{message.lastError}</small>}
                  </span>
                  <span>
                    <time dateTime={message.sentAt ?? message.createdAt}>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(message.sentAt ?? message.createdAt))}
                    </time>
                    <small>
                      {message.attempts} attempt
                      {message.attempts === 1 ? "" : "s"}
                    </small>
                  </span>
                  <span className="outbox-actions">
                    {message.status === "failed" && (
                      <button
                        className="text-button"
                        onClick={() => messageAction(message, "retry")}
                      >
                        <RotateCcw size={15} /> Retry delivery
                      </button>
                    )}
                    {["prepared", "queued", "failed"].includes(
                      message.status,
                    ) && (
                      <button
                        className="text-button"
                        onClick={() => messageAction(message, "cancel")}
                      >
                        <XCircle size={15} /> Cancel communication
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {!overview?.messages.length && (
                <div className="communications-empty">
                  <Inbox size={26} />
                  <strong>No communications match this view.</strong>
                  <span>
                    Prepared messages will appear here with queued, processing,
                    sent, delivered, bounced, failed, or cancelled evidence as
                    it becomes available.
                  </span>
                  <button
                    className="button button-small"
                    type="button"
                    onClick={() => setTab("compose")}
                  >
                    Compose a communication
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "templates" && selectedTemplate && (
          <section className="communications-panel template-workspace">
            <aside>
              <h2>Template catalog</h2>
              {overview?.templates.map((template) => (
                <button
                  className={
                    template.id === selectedTemplate.id ? "active" : ""
                  }
                  onClick={() => setSelectedTemplateId(template.id)}
                  key={template.id}
                >
                  <span>{template.name}</span>
                  <small>{categoryLabels[template.category]}</small>
                </button>
              ))}
            </aside>
            <form
              key={`${selectedTemplate.id}-${selectedTemplate.version}`}
              onSubmit={saveTemplate}
            >
              <div className="editor-heading">
                <Mail size={18} />
                <div>
                  <p className="kicker">
                    {categoryLabels[selectedTemplate.category]}
                  </p>
                  <h2>Edit template</h2>
                  <p>
                    Version {selectedTemplate.version}. Every save is audited.
                  </p>
                </div>
              </div>
              <label>
                Template name
                <input
                  name="name"
                  defaultValue={selectedTemplate.name}
                  required
                />
              </label>
              <label>
                Subject
                <input
                  name="subject"
                  defaultValue={selectedTemplate.subject}
                  required
                />
              </label>
              <label>
                Rich HTML body
                <textarea
                  name="bodyHtml"
                  rows={10}
                  defaultValue={selectedTemplate.bodyHtml}
                  required
                />
                <small>
                  Allowed formatting: headings, paragraphs, emphasis, lists,
                  links, quotes, and code.
                </small>
              </label>
              <label>
                Plain-text body
                <textarea
                  name="bodyText"
                  rows={8}
                  defaultValue={selectedTemplate.bodyText}
                  required
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={selectedTemplate.enabled}
                />{" "}
                Available for sending
              </label>
              <details className="merge-field-browser">
                <summary>Merge-field browser</summary>
                <div>
                  {overview?.supportedMergeFields.map((field) => (
                    <code key={field}>{`{{${field}}}`}</code>
                  ))}
                </div>
              </details>
              <button className="button" disabled={busy}>
                <Settings2 size={16} /> Save audited version
              </button>
            </form>
          </section>
        )}

        {tab === "compose" && selectedTemplate && (
          <section className="communications-panel compose-workspace">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void compose(event.currentTarget);
              }}
            >
              <div className="editor-heading">
                <Send size={18} />
                <div>
                  <h2>Prepare a communication</h2>
                  <p>
                    Recipients are resolved from current event data immediately
                    before preparation.
                  </p>
                </div>
              </div>
              <label>
                Template
                <select
                  value={selectedTemplateId}
                  onChange={(event) =>
                    setSelectedTemplateId(event.target.value)
                  }
                >
                  {overview?.templates
                    .filter((template) => template.enabled)
                    .map((template) => (
                      <option value={template.id} key={template.id}>
                        {categoryLabels[template.category]} · {template.name}
                      </option>
                    ))}
                </select>
              </label>
              {["speaker_message", "crm_outreach"].includes(
                selectedTemplate.category,
              ) && (
                <label>
                  Organizer message
                  <textarea
                    name="organizerMessage"
                    rows={5}
                    required
                    placeholder="Write the personal message that will replace {{organizer.message}}."
                  />
                </label>
              )}
              <fieldset className="recipient-picker">
                <legend>
                  Recipients ({selectedRecipients.length} selected)
                </legend>
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    setSelectedRecipients(
                      selectedRecipients.length === recipients.length
                        ? []
                        : recipients.map((recipient) => recipient.key),
                    )
                  }
                >
                  {selectedRecipients.length === recipients.length
                    ? "Clear selection"
                    : "Select all eligible"}
                </button>
                {recipients.map((recipient) => (
                  <label key={recipient.key}>
                    <input
                      type="checkbox"
                      checked={selectedRecipients.includes(recipient.key)}
                      onChange={(event) =>
                        setSelectedRecipients((current) =>
                          event.target.checked
                            ? [...current, recipient.key]
                            : current.filter((key) => key !== recipient.key),
                        )
                      }
                    />
                    <span>
                      <strong>{recipient.name}</strong>
                      <small>
                        {recipient.email} · {recipient.context}
                      </small>
                    </span>
                  </label>
                ))}
                {!recipients.length && (
                  <div className="communications-empty">
                    <UsersRound size={24} />
                    <strong>No eligible recipients.</strong>
                    <span>This category is clear for the current event.</span>
                  </div>
                )}
              </fieldset>
              <fieldset key={`delivery-${selectedTemplate.id}`}>
                <legend>Delivery</legend>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="delivery"
                    value="prepared"
                    defaultChecked={selectedTemplate.category !== "decision"}
                  />{" "}
                  Prepare only
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="delivery"
                    value="now"
                    defaultChecked={selectedTemplate.category === "decision"}
                  />{" "}
                  Queue now
                </label>
                <label>
                  Or schedule for
                  <input name="scheduledFor" type="datetime-local" />
                </label>
              </fieldset>
              <div className="compose-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={!selectedRecipient || busy}
                  onClick={(event) =>
                    previewMessage(
                      String(
                        new FormData(event.currentTarget.form!).get(
                          "organizerMessage",
                        ) ?? "",
                      ),
                    )
                  }
                >
                  Preview recipients
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={!selectedRecipient || busy}
                  onClick={(event) =>
                    void compose(event.currentTarget.form!, true)
                  }
                >
                  Send test to me
                </button>
                <button
                  className="button"
                  disabled={!selectedRecipients.length || busy}
                >
                  <Send size={16} />{" "}
                  {selectedTemplate.category === "decision"
                    ? "Send decision"
                    : "Review and confirm delivery"}
                </button>
              </div>
            </form>
            <aside className="communication-preview">
              <p className="kicker">Real-recipient preview</p>
              {preview ? (
                <>
                  <h2>{preview.subject}</h2>
                  <div dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} />
                  <details>
                    <summary>Plain text</summary>
                    <pre>{preview.bodyText}</pre>
                  </details>
                </>
              ) : (
                <div className="communications-empty">
                  <Mail size={26} />
                  <strong>Select one recipient and preview.</strong>
                  <span>Unresolved merge fields block preparation.</span>
                </div>
              )}
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}
