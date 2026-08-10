import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileArchive,
  FileInput,
  Files,
  History,
  Inbox,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  name: string;
  organizationName: string;
  status: string;
};
type Session = {
  id: string;
  title: string;
  abstract: string;
  contentStatus: "draft" | "in_review" | "approved";
  fileCount: number;
};
type Speaker = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  hasHeadshot: boolean;
  headshotUrl: string | null;
};
type Assignment = {
  taskId: string;
  speakerId: string;
  speakerName: string;
  email: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: string;
  fileCount: number;
};
type ContentFile = {
  id: string;
  taskId: string | null;
  submissionId: string | null;
  sessionTitle: string | null;
  speakerId: string;
  speakerName: string;
  purpose: string;
  status: string;
  filename: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  versionCount: number;
};
type Revision = {
  id: string;
  versionNumber: number;
  title: string;
  abstract: string;
  createdAt: string;
  editorName: string;
  restoredFromId: string | null;
};
type FileDetail = {
  versions: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    versionNumber: number;
    createdAt: string;
    uploadedByName: string;
    isCurrent: boolean;
  }>;
  comments: Array<{
    id: string;
    body: string;
    authorName: string;
    createdAt: string;
  }>;
};
type ExportRecord = {
  id: string;
  status: string;
  grouping: string;
  sizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? ((await response.json()) as T & { error?: { message?: string } })
    : undefined;
  if (!response.ok)
    throw new Error(
      result?.error?.message ?? "The request could not be completed.",
    );
  return result as T;
}

export function EventContent({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const requestedFileId = new URLSearchParams(window.location.search).get(
    "file",
  );
  const requestedSpeakerId = new URLSearchParams(window.location.search).get(
    "speaker",
  );
  const [event, setEvent] = useState<EventRecord>();
  const [role, setRole] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [files, setFiles] = useState<ContentFile[]>([]);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [fileUploadsEnabled, setFileUploadsEnabled] = useState(true);
  const [tab, setTab] = useState<
    "deliverables" | "sessions" | "speakers" | "files"
  >(
    requestedFileId
      ? "files"
      : requestedSpeakerId
        ? "speakers"
        : "deliverables",
  );
  const [filter, setFilter] = useState("all");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [editingSession, setEditingSession] = useState<Session>();
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker>();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<{
    title: string;
    abstract: string;
    rationale: string;
  }>();
  const [selectedFile, setSelectedFile] = useState<ContentFile>();
  const [fileDetail, setFileDetail] = useState<FileDetail>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();

  async function load() {
    const access = await api<{ event: EventRecord; role: string }>(
      `/api/events/${eventId}`,
    );
    setEvent(access.event);
    setRole(access.role);
    if (access.role === "speaker") return;
    const data = await api<{
      event: { fileUploadsEnabled: boolean };
      sessions: Session[];
      speakers: Speaker[];
      assignments: Assignment[];
      files: ContentFile[];
      exports: ExportRecord[];
    }>(`/api/content/admin/events/${eventId}`);
    setFileUploadsEnabled(data.event.fileUploadsEnabled);
    setSessions(data.sessions);
    setSpeakers(data.speakers);
    setAssignments(data.assignments);
    setFiles(data.files);
    setExports(data.exports);
  }
  useEffect(() => {
    load()
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [eventId]);

  const visibleAssignments = useMemo(
    () =>
      assignments.filter((item) => {
        if (filter === "incomplete")
          return !["submitted", "complete"].includes(item.status);
        if (filter === "overdue")
          return Boolean(
            item.dueAt &&
            new Date(item.dueAt) < new Date() &&
            !["submitted", "complete"].includes(item.status),
          );
        if (filter.startsWith("task:")) return item.taskId === filter.slice(5);
        return true;
      }),
    [assignments, filter],
  );
  const taskOptions = [
    ...new Map(assignments.map((item) => [item.taskId, item.title])).entries(),
  ];

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      await load();
      setFeedback({ kind: "success", message: success });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Action failed.",
      });
    } finally {
      setBusy(false);
    }
  }
  function removeDetailQuery(name: "file" | "speaker") {
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }
  function closeSpeakerEditor() {
    removeDetailQuery("speaker");
    setEditingSpeaker(undefined);
  }
  function openSpeakerEditor(speaker: Speaker) {
    const url = new URL(window.location.href);
    url.searchParams.set("speaker", speaker.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setTab("speakers");
    setEditingSpeaker(speaker);
  }
  function closeFileDetails() {
    removeDetailQuery("file");
    setSelectedFile(undefined);
    setFileDetail(undefined);
  }
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await api(`/api/speakers/admin/events/${eventId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          taskType: "file_request",
          dueAt: form.get("dueAt")
            ? new Date(String(form.get("dueAt"))).toISOString()
            : null,
          assignAll: true,
        }),
      });
      formElement.reset();
    }, "File request assigned to all accepted speakers.");
  }
  async function sendReminders() {
    await run(async () => {
      const result = await api<{
        queued: number;
        prepared: number;
        attempted: number;
      }>(`/api/content/admin/events/${eventId}/reminders`, { method: "POST" });
      setFeedback({
        kind: "success",
        message: `${result.queued} of ${result.attempted} reminders queued${result.prepared ? `; ${result.prepared} remain prepared for retry in Communications` : ""}.`,
      });
    }, "Reminders processed.");
  }
  async function openSession(session: Session) {
    setEditingSession(session);
    setAiSuggestion(undefined);
    const result = await api<{ revisions: Revision[] }>(
      `/api/content/admin/events/${eventId}/sessions/${session.id}/history`,
    );
    setRevisions(result.revisions);
  }
  async function suggestContent() {
    if (!editingSession) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await api<{
        suggestion: { title: string; abstract: string; rationale: string };
      }>(
        `/api/content/admin/events/${eventId}/sessions/${editingSession.id}/remix`,
        { method: "POST", body: JSON.stringify({ objective: "clarity" }) },
      );
      setAiSuggestion(result.suggestion);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Suggestion failed.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSession) return;
    await run(
      async () => {
        await api(
          `/api/content/admin/events/${eventId}/sessions/${editingSession.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              title: editingSession.title,
              abstract: editingSession.abstract,
              contentStatus: editingSession.contentStatus,
            }),
          },
        );
        setEditingSession(undefined);
      },
      editingSession.contentStatus === "approved"
        ? "Content approved for public output. Next, schedule the session in Agenda."
        : "Session content saved and versioned. Move it to Approved for public output when review is complete.",
    );
  }
  async function approveContent() {
    if (!editingSession) return;
    await run(async () => {
      await api(
        `/api/content/admin/events/${eventId}/sessions/${editingSession.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: editingSession.title,
            abstract: editingSession.abstract,
            contentStatus: "approved",
          }),
        },
      );
      setEditingSession(undefined);
    }, "Content approved for public output. Next, schedule the session in Agenda.");
  }
  async function restore(revision: Revision) {
    if (!editingSession) return;
    await run(async () => {
      await api(
        `/api/content/admin/events/${eventId}/sessions/${editingSession.id}/history/${revision.id}/restore`,
        { method: "POST" },
      );
      const refreshed = await api<{ revisions: Revision[] }>(
        `/api/content/admin/events/${eventId}/sessions/${editingSession.id}/history`,
      );
      setRevisions(refreshed.revisions);
    }, `Restored version ${revision.versionNumber}.`);
  }
  async function saveSpeaker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSpeaker) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(
        `/api/content/admin/events/${eventId}/speakers/${editingSpeaker.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            firstName: form.get("firstName"),
            lastName: form.get("lastName"),
            jobTitle: form.get("jobTitle") || null,
            company: form.get("company") || null,
            bio: form.get("bio") || null,
          }),
        },
      );
      const headshot = form.get("headshot");
      if (headshot instanceof File && headshot.size) {
        const upload = new FormData();
        upload.set("file", headshot);
        await api(
          `/api/content/admin/events/${eventId}/speakers/${editingSpeaker.id}/headshot`,
          { method: "POST", body: upload },
        );
      }
      closeSpeakerEditor();
    }, "Speaker profile and headshot saved.");
  }
  async function openFile(file: ContentFile) {
    const url = new URL(window.location.href);
    url.searchParams.set("file", file.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setTab("files");
    setSelectedFile(file);
    const detail = await api<FileDetail>(
      `/api/speakers/admin/events/${eventId}/files/${file.id}`,
    );
    setFileDetail(detail);
  }
  useEffect(() => {
    if (!requestedFileId || selectedFile) return;
    const target = files.find((file) => file.id === requestedFileId);
    if (target)
      openFile(target).catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
  }, [files, requestedFileId, selectedFile]);
  useEffect(() => {
    if (!requestedSpeakerId || editingSpeaker) return;
    const target = speakers.find(
      (speaker) => speaker.id === requestedSpeakerId,
    );
    if (target) openSpeakerEditor(target);
  }, [speakers, requestedSpeakerId, editingSpeaker]);
  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      await api(
        `/api/speakers/admin/events/${eventId}/files/${selectedFile.id}/comments`,
        { method: "POST", body: JSON.stringify({ body: form.get("body") }) },
      );
      setFileDetail(
        await api<FileDetail>(
          `/api/speakers/admin/events/${eventId}/files/${selectedFile.id}`,
        ),
      );
      formElement.reset();
    }, "Reply added to the file thread.");
  }
  async function share(file: ContentFile) {
    await run(async () => {
      const result = await api<{ shareUrl: string; expiresAt: string }>(
        `/api/content/admin/events/${eventId}/files/${file.id}/share`,
        { method: "POST" },
      );
      await navigator.clipboard?.writeText(result.shareUrl);
      setFeedback({
        kind: "success",
        message: `Secure link copied. It expires ${new Date(result.expiresAt).toLocaleDateString()}.`,
      });
    }, "Share link created.");
  }
  async function generateExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const grouping = new FormData(event.currentTarget).get("grouping");
    await run(async () => {
      const result = await api<{ export: { downloadUrl: string } }>(
        `/api/content/admin/events/${eventId}/exports`,
        {
          method: "POST",
          body: JSON.stringify({ fileIds: selectedFiles, grouping }),
        },
      );
      window.location.assign(result.export.downloadUrl);
    }, "ZIP export is ready.");
  }

  if (loading)
    return (
      <main className="loading-page">
        <LoaderCircle className="spin" /> Loading content workspace…
      </main>
    );
  if (role === "speaker")
    return <Navigate to={`/app/events/${eventId}/speaker`} replace />;
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
          <strong>{event?.name}</strong>
          <span>{event?.status}</span>
        </div>
        <EventLifecycleNav eventId={eventId} active="content" role={role} />
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="event-main content-main">
        <header className="event-heading">
          <div>
            <p className="kicker">Content management</p>
            <h1>Deliverables & publishing</h1>
            <p>
              Collect, review, version, approve, and distribute every final
              asset.
            </p>
          </div>
          <label className="upload-setting">
            <input
              type="checkbox"
              checked={fileUploadsEnabled}
              onChange={(change) =>
                run(
                  () =>
                    api(`/api/content/admin/events/${eventId}/settings`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        fileUploadsEnabled: change.target.checked,
                      }),
                    }).then(() => undefined),
                  change.target.checked
                    ? "Speaker uploads enabled."
                    : "Speaker uploads paused.",
                )
              }
            />{" "}
            <span>
              <strong>Speaker uploads</strong>
              <small>{fileUploadsEnabled ? "Enabled" : "Paused"}</small>
            </span>
          </label>
        </header>
        {feedback && (
          <div
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        <nav className="content-tabs" aria-label="Content workspace">
          <button
            className={tab === "deliverables" ? "active" : ""}
            onClick={() => setTab("deliverables")}
          >
            Deliverables
          </button>
          <button
            className={tab === "sessions" ? "active" : ""}
            onClick={() => setTab("sessions")}
          >
            Session content
          </button>
          <button
            className={tab === "speakers" ? "active" : ""}
            onClick={() => setTab("speakers")}
          >
            Speaker content
          </button>
          <button
            className={tab === "files" ? "active" : ""}
            onClick={() => setTab("files")}
          >
            Files library
          </button>
        </nav>
        {tab === "deliverables" && (
          <>
            <div className="content-toolbar">
              <label>
                Filter
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="all">All tasks</option>
                  <option value="incomplete">Incomplete</option>
                  <option value="overdue">Overdue</option>
                  {taskOptions.map(([id, title]) => (
                    <option key={id} value={`task:${id}`}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button-ghost"
                onClick={sendReminders}
                disabled={
                  busy ||
                  !visibleAssignments.some(
                    (item) => !["submitted", "complete"].includes(item.status),
                  )
                }
              >
                <Send size={15} /> Remind outstanding speakers
              </button>
            </div>
            <div className="deliverables-layout">
              <form className="content-request-card" onSubmit={createTask}>
                <FileInput size={22} />
                <h2>Create file request</h2>
                <label>
                  Task name
                  <input
                    name="title"
                    required
                    placeholder="Upload Session Presentation"
                  />
                </label>
                <label>
                  Instructions
                  <textarea
                    name="description"
                    rows={4}
                    placeholder="Final slide deck as a PDF, 16:9 aspect ratio."
                    required
                  />
                </label>
                <label>
                  Due date
                  <input name="dueAt" type="datetime-local" required />
                </label>
                <button className="button" disabled={busy || !speakers.length}>
                  Assign to all speakers
                </button>
                <small>
                  Creates one private upload slot per accepted session and
                  speaker.
                </small>
              </form>
              <section className="deliverables-table">
                <header>
                  <strong>
                    {visibleAssignments.length} speaker-task assignments
                  </strong>
                  <span>
                    {
                      visibleAssignments.filter((item) =>
                        ["submitted", "complete"].includes(item.status),
                      ).length
                    }{" "}
                    submitted
                  </span>
                </header>
                {visibleAssignments.map((item) => (
                  <article key={`${item.taskId}:${item.speakerId}`}>
                    <div>
                      <strong>{item.speakerName}</strong>
                      <small>{item.title}</small>
                    </div>
                    <span>
                      {item.dueAt
                        ? new Intl.DateTimeFormat("en-US", {
                            dateStyle: "medium",
                          }).format(new Date(item.dueAt))
                        : "No deadline"}
                    </span>
                    <em className={`submission-status status-${item.status}`}>
                      {item.status.replaceAll("_", " ")}
                    </em>
                  </article>
                ))}
              </section>
            </div>
          </>
        )}
        {tab === "sessions" && (
          <section className="content-card-grid">
            {sessions.map((session) => (
              <button
                className="content-record-card"
                key={session.id}
                onClick={() => openSession(session)}
              >
                <span
                  className={`submission-status status-${session.contentStatus}`}
                >
                  {session.contentStatus.replaceAll("_", " ")}
                </span>
                <h2>{session.title}</h2>
                <p>{session.abstract}</p>
                <small>
                  {session.fileCount} requested files · Edit & history
                </small>
              </button>
            ))}
          </section>
        )}
        {tab === "speakers" && (
          <section className="content-card-grid">
            {speakers.map((speaker) => (
              <button
                className="content-record-card speaker-content-card"
                key={speaker.id}
                onClick={() => openSpeakerEditor(speaker)}
              >
                {speaker.headshotUrl ? (
                  <img src={speaker.headshotUrl} alt="" />
                ) : (
                  <span className="speaker-avatar">
                    {speaker.firstName[0]}
                    {speaker.lastName[0]}
                  </span>
                )}
                <h2>
                  {speaker.firstName} {speaker.lastName}
                </h2>
                <p>{speaker.bio || "Biography not provided."}</p>
                <small>
                  <UserRound size={14} /> Edit biography & headshot
                </small>
              </button>
            ))}
          </section>
        )}
        {tab === "files" && (
          <>
            <form
              className="content-toolbar export-toolbar"
              onSubmit={generateExport}
            >
              <strong>
                {files.filter((file) => file.filename).length} uploaded files
              </strong>
              <label>
                Group ZIP by
                <select name="grouping" defaultValue="session">
                  <option value="session">Session</option>
                  <option value="speaker">Speaker</option>
                  <option value="flat">No folders</option>
                </select>
              </label>
              <button
                className="button"
                disabled={busy || !selectedFiles.length}
              >
                <FileArchive size={15} /> Generate ZIP ({selectedFiles.length})
              </button>
            </form>
            <section className="files-library">
              {files
                .filter((file) => file.filename)
                .map((file) => (
                  <article key={file.id}>
                    <input
                      aria-label={`Select ${file.filename}`}
                      type="checkbox"
                      checked={selectedFiles.includes(file.id)}
                      onChange={(event) =>
                        setSelectedFiles((current) =>
                          event.target.checked
                            ? [...current, file.id]
                            : current.filter((id) => id !== file.id),
                        )
                      }
                    />
                    <FileArchive size={22} />
                    <button
                      className="file-main"
                      onClick={() => openFile(file)}
                    >
                      <strong>{file.filename}</strong>
                      <span>
                        {file.sessionTitle || "General event file"} ·{" "}
                        {file.speakerName}
                      </span>
                      <small>
                        {file.uploadedAt
                          ? new Intl.DateTimeFormat("en-US", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(file.uploadedAt))
                          : "Not uploaded"}{" "}
                        · {file.versionCount}{" "}
                        {file.versionCount === 1 ? "version" : "versions"}
                      </small>
                    </button>
                    <button
                      className="button button-small button-ghost"
                      aria-label="Create share link"
                      onClick={() => share(file)}
                    >
                      <Share2 size={17} /> Create share link
                    </button>
                  </article>
                ))}
            </section>
            {exports.length > 0 && (
              <section className="export-history">
                <h2>Recent exports</h2>
                {exports.map((item) => (
                  <a
                    key={item.id}
                    href={
                      item.status === "ready"
                        ? `/api/content/admin/events/${eventId}/exports/${item.id}/download`
                        : undefined
                    }
                  >
                    <Archive size={16} />
                    <span>
                      {item.grouping} grouping · {item.status}
                    </span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                    {item.status === "ready" && <Download size={15} />}
                  </a>
                ))}
              </section>
            )}
          </>
        )}
      </main>
      {editingSession && (
        <div className="detail-backdrop">
          <aside
            className="content-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Edit session content"
          >
            <header>
              <div>
                <small>Session content</small>
                <h2>Edit & approve</h2>
              </div>
              <button
                className="button button-small button-ghost"
                data-dismiss
                onClick={() => setEditingSession(undefined)}
              >
                <X size={16} /> Close session editor
              </button>
            </header>
            <form onSubmit={saveSession}>
              <label>
                Title
                <input
                  name="title"
                  value={editingSession.title}
                  onChange={(event) =>
                    setEditingSession({
                      ...editingSession,
                      title: event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label>
                Abstract
                <textarea
                  name="abstract"
                  rows={9}
                  value={editingSession.abstract}
                  onChange={(event) =>
                    setEditingSession({
                      ...editingSession,
                      abstract: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Content status
                <select
                  name="contentStatus"
                  value={editingSession.contentStatus}
                  onChange={(event) =>
                    setEditingSession({
                      ...editingSession,
                      contentStatus: event.target
                        .value as Session["contentStatus"],
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="in_review">In review</option>
                  <option value="approved">Approved for public output</option>
                </select>
              </label>
              <button className="button" disabled={busy}>
                Save session content
              </button>
              {editingSession.contentStatus !== "approved" && (
                <button
                  className="button"
                  type="button"
                  onClick={() => void approveContent()}
                  disabled={busy}
                >
                  Approve content
                </button>
              )}
              <button
                className="button button-ghost"
                type="button"
                onClick={suggestContent}
                disabled={busy}
              >
                <Sparkles size={15} /> Suggest clearer content
              </button>
            </form>
            {aiSuggestion && (
              <section className="ai-suggestion">
                <small>Workers AI suggestion · review before applying</small>
                <h3>{aiSuggestion.title}</h3>
                <p>{aiSuggestion.abstract}</p>
                <em>{aiSuggestion.rationale}</em>
                <div>
                  <button
                    className="button button-small"
                    onClick={() => {
                      setEditingSession({
                        ...editingSession,
                        title: aiSuggestion.title,
                        abstract: aiSuggestion.abstract,
                      });
                      setAiSuggestion(undefined);
                    }}
                  >
                    Apply to editor
                  </button>
                  <button
                    className="button button-ghost button-small"
                    onClick={() => setAiSuggestion(undefined)}
                  >
                    Dismiss
                  </button>
                </div>
              </section>
            )}
            <section className="revision-list">
              <h3>
                <History size={17} /> Version history
              </h3>
              {revisions.map((revision) => (
                <article key={revision.id}>
                  <div>
                    <strong>Version {revision.versionNumber}</strong>
                    <span>{revision.editorName}</span>
                    <small>
                      {new Date(revision.createdAt).toLocaleString()}
                    </small>
                  </div>
                  <button onClick={() => restore(revision)} disabled={busy}>
                    <RefreshCw size={14} /> Restore
                  </button>
                </article>
              ))}
            </section>
          </aside>
        </div>
      )}
      {editingSpeaker && (
        <div className="detail-backdrop">
          <aside
            className="content-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Edit speaker profile"
          >
            <header>
              <div>
                <small>Speaker content</small>
                <h2>Edit profile</h2>
              </div>
              <button
                className="button button-small button-ghost"
                data-dismiss
                onClick={closeSpeakerEditor}
              >
                <X size={16} /> Close speaker editor
              </button>
            </header>
            <form onSubmit={saveSpeaker}>
              <div className="field-pair">
                <label>
                  First name
                  <input
                    name="firstName"
                    defaultValue={editingSpeaker.firstName}
                    required
                  />
                </label>
                <label>
                  Last name
                  <input
                    name="lastName"
                    defaultValue={editingSpeaker.lastName}
                    required
                  />
                </label>
              </div>
              <label>
                Job title
                <input
                  name="jobTitle"
                  defaultValue={editingSpeaker.jobTitle ?? ""}
                />
              </label>
              <label>
                Company
                <input
                  name="company"
                  defaultValue={editingSpeaker.company ?? ""}
                />
              </label>
              <label>
                Biography
                <textarea
                  name="bio"
                  rows={8}
                  defaultValue={editingSpeaker.bio ?? ""}
                />
              </label>
              <label>
                Replace headshot
                <input
                  name="headshot"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                />
                <small>PNG, JPEG, or WebP · 5 MB max</small>
              </label>
              <button className="button" disabled={busy}>
                <Upload size={15} /> Save profile
              </button>
            </form>
          </aside>
        </div>
      )}
      {selectedFile && fileDetail && (
        <div className="detail-backdrop">
          <aside
            className="content-detail file-detail"
            role="dialog"
            aria-modal="true"
            aria-label="File details"
          >
            <header>
              <div>
                <small>
                  {selectedFile.sessionTitle} · {selectedFile.speakerName}
                </small>
                <h2>{selectedFile.filename}</h2>
              </div>
              <button
                className="button button-small button-ghost"
                data-dismiss
                onClick={closeFileDetails}
              >
                <X size={16} /> Close file details
              </button>
            </header>
            <section className="revision-list">
              <h3>
                <History size={17} /> File versions
              </h3>
              {fileDetail.versions.map((version) => (
                <article key={version.id}>
                  <div>
                    <strong>
                      Version {version.versionNumber}{" "}
                      {version.isCurrent && <em>Latest</em>}
                    </strong>
                    <span>
                      {version.uploadedByName} · {version.filename}
                    </span>
                    <small>
                      {new Date(version.createdAt).toLocaleString()} ·{" "}
                      {(version.sizeBytes / 1024).toFixed(1)} KB
                    </small>
                  </div>
                  <a
                    href={`/api/speakers/admin/events/${eventId}/files/${selectedFile.id}/versions/${version.id}/download`}
                  >
                    <Download size={15} /> Download
                  </a>
                </article>
              ))}
            </section>
            <section className="comment-thread">
              <h3>
                <MessageSquare size={17} /> Comments
              </h3>
              {fileDetail.comments.map((comment) => (
                <article key={comment.id}>
                  <strong>{comment.authorName}</strong>
                  <small>{new Date(comment.createdAt).toLocaleString()}</small>
                  <p>{comment.body}</p>
                </article>
              ))}
              <form onSubmit={addComment}>
                <label>
                  Reply
                  <textarea
                    name="body"
                    rows={3}
                    required
                    placeholder="Thanks — please confirm the final version by Tuesday."
                  />
                </label>
                <button className="button button-small" disabled={busy}>
                  Add reply
                </button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
