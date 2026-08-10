import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  FileInput,
  Files,
  Inbox,
  LoaderCircle,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";
import { sanitizeResourceHtml } from "../lib/sanitizeResource";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  organizationName: string;
  name: string;
  status: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
};
type Profile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pronouns: string | null;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  headshotKey: string | null;
  social: Record<string, string>;
  logistics: Record<string, string | boolean | number | null>;
  portalStatus: string;
};
type Speaker = Profile & {
  eventStatus: "proposed" | "invited" | "confirmed" | "withdrawn";
  sessionCount: number;
  taskCount: number;
  completedTaskCount: number;
  fileRequestCount: number;
  approvedFileCount: number;
};
type Task = {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  dueAt: string | null;
  status?: string;
  response?: Record<string, unknown>;
};
type Resource = {
  id: string;
  title: string;
  bodyHtml: string;
  publishedAt: string | null;
};
type SpeakerFile = {
  id: string;
  taskId?: string | null;
  submissionId?: string | null;
  sessionTitle?: string | null;
  speakerId?: string;
  speakerName?: string;
  purpose: string;
  status: string;
  filename: string | null;
  sizeBytes: number | null;
  versionNumber: number | null;
  versionCount?: number;
};
type SpeakerFileDetail = {
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
type TaskAssignment = {
  taskId: string;
  speakerId: string;
  speakerName: string;
  title: string;
  status: string;
  response: Record<string, unknown>;
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
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "The request could not be completed.",
    );
  return result;
}

function SanitizedResource({ html }: { html: string }) {
  const safe = useMemo(() => sanitizeResourceHtml(html), [html]);
  return (
    <div className="resource-body" dangerouslySetInnerHTML={{ __html: safe }} />
  );
}

function EventChrome({
  event,
  user,
  eventId,
  role,
  children,
}: {
  event?: EventRecord;
  user: User;
  eventId: string;
  role?: string;
  children: React.ReactNode;
}) {
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
        <EventLifecycleNav eventId={eventId} active="speakers" role={role} />
        <SidebarUser user={user} />
      </aside>
      {children}
    </div>
  );
}

export function EventSpeakers({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventRecord>();
  const [role, setRole] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  useEffect(() => {
    api<{ event: EventRecord; role: string }>(`/api/events/${eventId}`)
      .then((result) => {
        setEvent(result.event);
        setRole(result.role);
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [eventId]);
  if (loading)
    return (
      <main className="loading-page">
        <LoaderCircle className="spin" /> Loading speaker workspace…
      </main>
    );
  return (
    <EventChrome event={event} user={user} eventId={eventId} role={role}>
      <main id="main-content" className="event-main speaker-main">
        {feedback && (
          <div className={`form-status form-status-${feedback.kind}`}>
            {feedback.message}
          </div>
        )}
        {role === "speaker" ? (
          <SpeakerPortal eventId={eventId} event={event} />
        ) : (
          <OrganizerSpeakers eventId={eventId} />
        )}
      </main>
    </EventChrome>
  );
}

function SpeakerPortal({
  eventId,
  event,
}: {
  eventId: string;
  event?: EventRecord;
}) {
  const [profile, setProfile] = useState<Profile>();
  const [sessions, setSessions] = useState<
    { id: string; title: string; abstract: string }[]
  >([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [files, setFiles] = useState<SpeakerFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SpeakerFile>();
  const [fileDetail, setFileDetail] = useState<SpeakerFileDetail>();
  const [tab, setTab] = useState<"home" | "profile" | "resources" | "files">(
    "home",
  );
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [busy, setBusy] = useState(false);
  async function load() {
    const result = await api<{
      profile: Profile;
      sessions: { id: string; title: string; abstract: string }[];
      tasks: Task[];
      resources: Resource[];
      files: SpeakerFile[];
    }>(`/api/speakers/events/${eventId}`);
    setProfile(result.profile);
    setSessions(result.sessions);
    setTasks(result.tasks);
    setResources(result.resources);
    setFiles(result.files);
  }
  useEffect(() => {
    load().catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [eventId]);
  useEffect(() => {
    if (
      (!profile && !tasks.length && !resources.length && !files.length) ||
      !window.location.hash
    )
      return;
    const target = document.getElementById(window.location.hash.slice(1));
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [files, profile, resources, tasks]);
  async function saveProfile(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!profile) return;
    setBusy(true);
    const data = new FormData(formEvent.currentTarget);
    try {
      await api(`/api/speakers/events/${eventId}/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          pronouns: data.get("pronouns") || null,
          jobTitle: data.get("jobTitle") || null,
          company: data.get("company") || null,
          bio: data.get("bio") || null,
          social: {
            linkedin: data.get("linkedin") || "",
            website: data.get("website") || "",
            x: data.get("x") || "",
          },
          logistics: {
            dietary: data.get("dietary") || "",
            accessibility: data.get("accessibility") || "",
            travelNotes: data.get("travelNotes") || "",
          },
        }),
      });
      await load();
      setFeedback({
        kind: "success",
        message: "Profile and private logistics saved.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not save profile.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function submitTask(task: Task) {
    setBusy(true);
    try {
      await api(`/api/speakers/events/${eventId}/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "submitted",
          response: { acknowledged: true },
        }),
      });
      await load();
      setFeedback({ kind: "success", message: `${task.title} submitted.` });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not update task.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function uploadFile(fileRequest: SpeakerFile, file: File) {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    try {
      await api(
        `/api/speakers/events/${eventId}/files/${fileRequest.id}/upload`,
        { method: "POST", body: form },
      );
      await load();
      setFeedback({
        kind: "success",
        message: `${file.name} uploaded as a new version.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not upload file.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function uploadHeadshot(file: File) {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    try {
      await api(`/api/speakers/events/${eventId}/headshot`, {
        method: "POST",
        body: form,
      });
      await load();
      setFeedback({ kind: "success", message: "Headshot uploaded." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not upload headshot.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function openFile(file: SpeakerFile) {
    setSelectedFile(file);
    setFileDetail(
      await api<SpeakerFileDetail>(
        `/api/speakers/events/${eventId}/files/${file.id}`,
      ),
    );
  }
  async function addFileComment(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selectedFile) return;
    const formElement = formEvent.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api(
        `/api/speakers/events/${eventId}/files/${selectedFile.id}/comments`,
        { method: "POST", body: JSON.stringify({ body: form.get("body") }) },
      );
      setFileDetail(
        await api<SpeakerFileDetail>(
          `/api/speakers/events/${eventId}/files/${selectedFile.id}`,
        ),
      );
      formElement.reset();
      setFeedback({ kind: "success", message: "Comment added." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not comment.",
      });
    } finally {
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <div className="workspace-loading">
        <LoaderCircle className="spin" /> Loading your portal…
      </div>
    );
  return (
    <>
      <header className="speaker-welcome">
        <div>
          <p className="kicker">Speaker portal</p>
          <h1>Welcome, {profile.firstName}.</h1>
          <p>
            {event?.name} · {event?.venueName || "Venue to be confirmed"}
          </p>
        </div>
        <div className="portal-progress">
          <strong>
            {
              tasks.filter((task) =>
                ["submitted", "complete"].includes(task.status ?? ""),
              ).length
            }
            /{tasks.length}
          </strong>
          <span>Tasks submitted</span>
        </div>
      </header>
      {feedback && (
        <div className={`form-status form-status-${feedback.kind}`}>
          {feedback.message}
        </div>
      )}
      <nav className="portal-tabs">
        <button
          className={tab === "home" ? "active" : ""}
          onClick={() => setTab("home")}
        >
          Overview
        </button>
        <button
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          Profile & logistics
        </button>
        <button
          className={tab === "resources" ? "active" : ""}
          onClick={() => setTab("resources")}
        >
          Resources
        </button>
        <button
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
        >
          Files
        </button>
      </nav>
      {tab === "home" && (
        <div className="portal-grid">
          <section className="portal-card">
            <div className="portal-card-title">
              <CheckCircle2 size={20} />
              <div>
                <h2>Onboarding</h2>
                <p>Complete what the program team needs.</p>
              </div>
            </div>
            {tasks.length ? (
              tasks.map((task) => (
                <div
                  className="portal-task"
                  id={`task-${task.id}`}
                  tabIndex={-1}
                  key={task.id}
                >
                  <span className={`task-dot task-${task.status}`} />
                  <div>
                    <strong>{task.title}</strong>
                    <small>
                      {task.description}
                      {task.dueAt
                        ? ` · Due ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(task.dueAt))}`
                        : ""}
                    </small>
                  </div>
                  {!["submitted", "complete"].includes(task.status ?? "") && (
                    <button
                      onClick={() =>
                        task.taskType === "file_request"
                          ? setTab("files")
                          : submitTask(task)
                      }
                      disabled={busy}
                    >
                      {task.taskType === "file_request"
                        ? "Upload requested file"
                        : "Mark complete"}
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="inline-empty">No tasks assigned yet.</div>
            )}
          </section>
          <section className="portal-card">
            <div className="portal-card-title">
              <BookOpen size={20} />
              <div>
                <h2>Your sessions</h2>
                <p>Accepted program content.</p>
              </div>
            </div>
            {sessions.map((session) => (
              <article className="portal-session" key={session.id}>
                <strong>{session.title}</strong>
                <p>{session.abstract || "Abstract not provided."}</p>
              </article>
            ))}
          </section>
        </div>
      )}
      {tab === "profile" && (
        <form className="speaker-profile-form" onSubmit={saveProfile}>
          <section>
            <h2>Public profile</h2>
            <div className="headshot-editor">
              {profile.headshotKey ? (
                <img
                  src={`/api/speakers/events/${eventId}/headshot`}
                  alt={`${profile.firstName} ${profile.lastName}`}
                />
              ) : (
                <div className="speaker-avatar">
                  <UserRound size={20} />
                </div>
              )}
              <label className="button button-ghost button-small">
                <Upload size={14} />{" "}
                {profile.headshotKey ? "Replace headshot" : "Upload headshot"}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) uploadHeadshot(chosen);
                  }}
                />
              </label>
              <small>PNG, JPEG, or WebP · 5 MB max</small>
            </div>
            <div className="public-field-grid">
              <label>
                First name
                <input
                  name="firstName"
                  defaultValue={profile.firstName}
                  required
                />
              </label>
              <label>
                Last name
                <input
                  name="lastName"
                  defaultValue={profile.lastName}
                  required
                />
              </label>
              <label>
                Pronouns
                <input name="pronouns" defaultValue={profile.pronouns ?? ""} />
              </label>
              <label>
                Job title
                <input name="jobTitle" defaultValue={profile.jobTitle ?? ""} />
              </label>
              <label>
                Company
                <input name="company" defaultValue={profile.company ?? ""} />
              </label>
              <label className="wide">
                Bio
                <textarea
                  name="bio"
                  rows={6}
                  defaultValue={profile.bio ?? ""}
                />
              </label>
              <label>
                LinkedIn
                <input
                  name="linkedin"
                  type="url"
                  defaultValue={profile.social.linkedin ?? ""}
                />
              </label>
              <label>
                Website
                <input
                  name="website"
                  type="url"
                  defaultValue={profile.social.website ?? ""}
                />
              </label>
              <label>
                X / social URL
                <input
                  name="x"
                  type="url"
                  defaultValue={profile.social.x ?? ""}
                />
              </label>
            </div>
          </section>
          <section>
            <h2>Private logistics</h2>
            <p>Visible only to the authorized event team.</p>
            <div className="public-field-grid">
              <label>
                Dietary needs
                <input
                  name="dietary"
                  defaultValue={String(profile.logistics.dietary ?? "")}
                />
              </label>
              <label>
                Accessibility needs
                <input
                  name="accessibility"
                  defaultValue={String(profile.logistics.accessibility ?? "")}
                />
              </label>
              <label className="wide">
                Travel notes
                <textarea
                  name="travelNotes"
                  rows={4}
                  defaultValue={String(profile.logistics.travelNotes ?? "")}
                />
              </label>
            </div>
          </section>
          <button className="button button-large" disabled={busy}>
            <Save size={17} /> Save profile
          </button>
        </form>
      )}
      {tab === "resources" && (
        <div className="resource-list">
          {resources.length ? (
            resources.map((resource) => (
              <article
                id={`resource-${resource.id}`}
                tabIndex={-1}
                key={resource.id}
              >
                <h2>{resource.title}</h2>
                <SanitizedResource html={resource.bodyHtml} />
              </article>
            ))
          ) : (
            <div className="submission-empty">
              <BookOpen size={30} />
              <h2>No resources yet</h2>
            </div>
          )}
        </div>
      )}
      {tab === "files" && (
        <div className="speaker-file-list">
          {files.length ? (
            files.map((file) => (
              <article id={`file-${file.id}`} tabIndex={-1} key={file.id}>
                <div>
                  <FileInput size={20} />
                  <span>
                    <strong>{file.purpose}</strong>
                    <small>
                      {file.sessionTitle ? `${file.sessionTitle} · ` : ""}
                      {file.filename
                        ? `${file.filename} · ${file.versionCount ?? file.versionNumber} version${(file.versionCount ?? file.versionNumber) === 1 ? "" : "s"}`
                        : "Waiting for upload"}
                    </small>
                  </span>
                </div>
                <em className={`submission-status status-${file.status}`}>
                  {file.status.replaceAll("_", " ")}
                </em>
                <div>
                  {file.filename && (
                    <button
                      className="button button-ghost button-small"
                      onClick={() => openFile(file)}
                    >
                      <MessageSquare size={14} /> Versions & comments
                    </button>
                  )}
                  <label className="button button-small">
                    <Upload size={14} />{" "}
                    {file.filename ? "New version" : "Upload"}
                    <input
                      className="sr-only"
                      type="file"
                      accept=".pdf,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.webp"
                      onChange={(event) => {
                        const chosen = event.target.files?.[0];
                        if (chosen) uploadFile(file, chosen);
                      }}
                    />
                  </label>
                </div>
              </article>
            ))
          ) : (
            <div className="submission-empty">
              <FileInput size={30} />
              <h2>No file requests yet</h2>
            </div>
          )}
        </div>
      )}
      {selectedFile && fileDetail && (
        <div className="detail-backdrop">
          <aside
            className="content-detail file-detail"
            role="dialog"
            aria-modal="true"
            aria-label={`File details for ${selectedFile.purpose}`}
          >
            <header>
              <div>
                <small>{selectedFile.sessionTitle}</small>
                <h2>{selectedFile.filename || selectedFile.purpose}</h2>
              </div>
              <button
                className="button button-small button-ghost"
                data-dismiss
                onClick={() => {
                  setSelectedFile(undefined);
                  setFileDetail(undefined);
                }}
              >
                <X size={16} /> Close file details
              </button>
            </header>
            <section className="revision-list">
              <h3>File versions</h3>
              {fileDetail.versions.map((version) => (
                <article key={version.id}>
                  <div>
                    <strong>
                      Version {version.versionNumber}{" "}
                      {version.isCurrent && <em>Latest</em>}
                    </strong>
                    <span>{version.uploadedByName}</span>
                    <small>
                      {new Date(version.createdAt).toLocaleString()}
                    </small>
                  </div>
                  <a
                    href={`/api/speakers/events/${eventId}/files/${selectedFile.id}/versions/${version.id}/download`}
                  >
                    <Download size={14} /> Download
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
              <form onSubmit={addFileComment}>
                <label>
                  Add a comment
                  <textarea
                    name="body"
                    rows={3}
                    required
                    placeholder="Draft deck — final version coming Friday."
                  />
                </label>
                <button className="button button-small" disabled={busy}>
                  Add comment
                </button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function OrganizerSpeakers({ eventId }: { eventId: string }) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskAssignments, setTaskAssignments] = useState<TaskAssignment[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [files, setFiles] = useState<SpeakerFile[]>([]);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  async function load() {
    const result = await api<{
      speakers: Speaker[];
      tasks: Task[];
      taskAssignments: TaskAssignment[];
      resources: Resource[];
      files: SpeakerFile[];
    }>(`/api/speakers/admin/events/${eventId}`);
    setSpeakers(result.speakers);
    setTasks(result.tasks);
    setTaskAssignments(result.taskAssignments);
    setResources(result.resources);
    setFiles(result.files);
  }
  useEffect(() => {
    load().catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [eventId]);
  useEffect(() => {
    if (
      (!speakers.length && !tasks.length && !resources.length) ||
      !window.location.hash
    )
      return;
    const target = document.getElementById(window.location.hash.slice(1));
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [resources, speakers, tasks]);
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    const data = new FormData(formElement);
    try {
      await api(`/api/speakers/admin/events/${eventId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: data.get("title"),
          description: data.get("description"),
          taskType: data.get("taskType"),
          dueAt: data.get("dueAt")
            ? new Date(String(data.get("dueAt"))).toISOString()
            : null,
          assignAll: true,
        }),
      });
      formElement.reset();
      await load();
      setFeedback({
        kind: "success",
        message: "Task assigned to all current speakers.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not create task.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    const data = new FormData(formElement);
    try {
      await api(`/api/speakers/admin/events/${eventId}/resources`, {
        method: "POST",
        body: JSON.stringify({
          title: data.get("title"),
          bodyHtml: data.get("bodyHtml"),
          published: data.get("published") === "on",
        }),
      });
      formElement.reset();
      await load();
      setFeedback({ kind: "success", message: "Speaker resource saved." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not create resource.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function createFileRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    const data = new FormData(formElement);
    try {
      await api(`/api/speakers/admin/events/${eventId}/file-requests`, {
        method: "POST",
        body: JSON.stringify({
          purpose: data.get("purpose"),
          speakerIds: speakers.map((speaker) => speaker.id),
        }),
      });
      formElement.reset();
      await load();
      setFeedback({
        kind: "success",
        message: "File request assigned to all speakers.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not create request.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function reviewFile(
    file: SpeakerFile,
    status: "approved" | "needs_changes",
  ) {
    const note =
      status === "needs_changes"
        ? (window.prompt("What should the speaker change?") ?? undefined)
        : undefined;
    setBusy(true);
    try {
      await api(`/api/speakers/admin/events/${eventId}/files/${file.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, note }),
      });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not review file.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function reviewTask(
    assignment: TaskAssignment,
    status: "complete" | "needs_changes",
  ) {
    const note =
      status === "needs_changes"
        ? (window.prompt("What should the speaker change?") ?? undefined)
        : undefined;
    setBusy(true);
    try {
      await api(
        `/api/speakers/admin/events/${eventId}/task-assignments/${assignment.taskId}/${assignment.speakerId}`,
        { method: "PATCH", body: JSON.stringify({ status, note }) },
      );
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not review task.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function updateSpeakerStatus(speaker: Speaker, status: string) {
    setBusy(true);
    try {
      await api(
        `/api/speakers/admin/events/${eventId}/speakers/${speaker.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      await load();
      setFeedback({
        kind: "success",
        message: `${speaker.firstName} ${speaker.lastName} is now ${status}. Next, filter or communicate with the updated roster.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not update status.",
      });
    } finally {
      setBusy(false);
    }
  }
  const visibleSpeakers = speakers.filter(
    (speaker) => statusFilter === "all" || speaker.eventStatus === statusFilter,
  );
  return (
    <>
      <header className="event-heading">
        <div>
          <p className="kicker">Speaker operations</p>
          <h1>Speaker readiness</h1>
          <p>
            Profiles, tasks, resources, logistics, and content requests in one
            progress view.
          </p>
        </div>
        <div className="submission-total">
          <strong>{speakers.length}</strong>
          <span>Accepted speakers</span>
        </div>
        <div className="inline-actions">
          <a
            className="button"
            href={`/app/events/${eventId}/communications?category=speaker_portal_invitation`}
          >
            <Mail size={14} /> Invite speaker
          </a>
          <a
            className="button button-ghost"
            href={`/app/crm?action=add-speaker&eventId=${eventId}`}
          >
            Add speaker record
          </a>
          <a
            className="button button-ghost"
            href={`/app/crm?action=import-speakers&eventId=${eventId}`}
          >
            Import speakers
          </a>
        </div>
      </header>
      {feedback && (
        <div className={`form-status form-status-${feedback.kind}`}>
          {feedback.message}
        </div>
      )}
      <label className="speaker-status-filter">
        Filter speaker status
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="proposed">Proposed</option>
          <option value="invited">Invited</option>
          <option value="confirmed">Confirmed</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
      </label>
      <section className="speaker-roster">
        {visibleSpeakers.map((speaker) => (
          <article id={`speaker-${speaker.id}`} tabIndex={-1} key={speaker.id}>
            <div className="speaker-avatar">
              {speaker.firstName[0]}
              {speaker.lastName[0]}
            </div>
            <div>
              <strong>
                {speaker.firstName} {speaker.lastName}
              </strong>
              <span>
                {speaker.jobTitle}
                {speaker.company ? ` · ${speaker.company}` : ""}
              </span>
              <small>{speaker.email}</small>
            </div>
            <em className={`submission-status status-${speaker.portalStatus}`}>
              {speaker.portalStatus.replaceAll("_", " ")}
            </em>
            <label className="speaker-event-status">
              Program status
              <select
                value={speaker.eventStatus}
                disabled={busy}
                onChange={(event) =>
                  updateSpeakerStatus(speaker, event.target.value)
                }
              >
                <option value="proposed">Proposed</option>
                <option value="invited">Invited</option>
                <option value="confirmed">Confirmed</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </label>
            <div className="speaker-progress">
              <span>
                <strong>
                  {speaker.completedTaskCount}/{speaker.taskCount}
                </strong>{" "}
                tasks
              </span>
              <span>
                <strong>
                  {speaker.approvedFileCount}/{speaker.fileRequestCount}
                </strong>{" "}
                files
              </span>
            </div>
            <a
              className="speaker-communication-link"
              href={`/app/events/${eventId}/content?speaker=${speaker.id}`}
            >
              <Pencil size={14} /> Edit speaker profile
            </a>
            <a
              className="speaker-communication-link"
              href={`/app/events/${eventId}/communications?speaker=${speaker.id}`}
            >
              <Mail size={14} /> Communication timeline
            </a>
          </article>
        ))}
        {!visibleSpeakers.length && (
          <div className="inline-empty">
            No speakers match this status. Choose All statuses or import a
            speaker.
          </div>
        )}
      </section>
      <section
        className="file-review-list"
        aria-label="Configured onboarding tasks"
      >
        <h2>Configured onboarding tasks</h2>
        {tasks.map((task) => (
          <article id={`task-${task.id}`} tabIndex={-1} key={task.id}>
            <span>
              <strong>{task.title}</strong>
              <small>{task.description || "No description"}</small>
            </span>
          </article>
        ))}
      </section>
      <section className="file-review-list" aria-label="Speaker resources">
        <h2>Speaker resources</h2>
        {resources.map((resource) => (
          <article
            id={`resource-${resource.id}`}
            tabIndex={-1}
            key={resource.id}
          >
            <span>
              <strong>{resource.title}</strong>
              <small>{resource.publishedAt ? "Published" : "Draft"}</small>
            </span>
          </article>
        ))}
      </section>
      <div className="speaker-admin-grid">
        <form className="operations-card" onSubmit={createTask}>
          <CheckCircle2 size={22} />
          <h2>Assign onboarding task</h2>
          <label>
            Title
            <input
              name="title"
              placeholder="Confirm session details"
              required
            />
          </label>
          <label>
            Description
            <textarea name="description" rows={3} />
          </label>
          <label>
            Type
            <select name="taskType">
              <option value="action">Action</option>
              <option value="form">Form</option>
              <option value="file_request">File request</option>
            </select>
          </label>
          <label>
            Due date
            <input name="dueAt" type="datetime-local" />
          </label>
          <button className="button" disabled={busy || !speakers.length}>
            <Plus size={15} /> Assign to all
          </button>
          <small>{tasks.length} tasks configured</small>
        </form>
        <form className="operations-card" onSubmit={createResource}>
          <BookOpen size={22} />
          <h2>Publish resource</h2>
          <label>
            Title
            <input name="title" placeholder="Speaker guide" required />
          </label>
          <label>
            HTML content
            <textarea
              name="bodyHtml"
              rows={6}
              placeholder="Use headings, links, lists, or approved video/slides iframe embeds."
              required
            />
          </label>
          <label className="check-row">
            <input name="published" type="checkbox" defaultChecked />
            <span>
              <strong>Publish now</strong>
              <small>Visible immediately in speaker portals.</small>
            </span>
          </label>
          <button className="button" disabled={busy}>
            <Plus size={15} /> Save resource
          </button>
          <small>{resources.length} resources configured</small>
        </form>
        <form className="operations-card" onSubmit={createFileRequest}>
          <FileInput size={22} />
          <h2>Request a file</h2>
          <label>
            File purpose
            <input name="purpose" placeholder="Final slide deck" required />
          </label>
          <button className="button" disabled={busy || !speakers.length}>
            <Plus size={15} /> Request from all
          </button>
          <small>PDF, PowerPoint, ZIP, or image · 25 MB max</small>
        </form>
      </div>
      <section className="file-review-list">
        <h2>Submitted onboarding tasks</h2>
        {taskAssignments
          .filter(
            (assignment) =>
              assignment.status === "submitted" ||
              assignment.status === "needs_changes",
          )
          .map((assignment) => (
            <article key={`${assignment.taskId}:${assignment.speakerId}`}>
              <span>
                <strong>{assignment.speakerName}</strong>
                <small>{assignment.title}</small>
              </span>
              <em className={`submission-status status-${assignment.status}`}>
                {assignment.status.replaceAll("_", " ")}
              </em>
              <div>
                <button
                  onClick={() => reviewTask(assignment, "needs_changes")}
                  disabled={busy}
                >
                  Needs changes
                </button>
                <button
                  onClick={() => reviewTask(assignment, "complete")}
                  disabled={busy}
                >
                  Complete
                </button>
              </div>
            </article>
          ))}
      </section>
      <section className="file-review-list">
        <h2>Submitted files</h2>
        {files
          .filter((file) => file.filename)
          .map((file) => (
            <article key={file.id}>
              <span>
                <strong>{file.speakerName}</strong>
                <small>
                  {file.purpose} · {file.filename} · v{file.versionNumber}
                </small>
              </span>
              <em className={`submission-status status-${file.status}`}>
                {file.status.replaceAll("_", " ")}
              </em>
              <div>
                <a
                  className="button button-ghost button-small"
                  href={`/api/speakers/admin/events/${eventId}/files/${file.id}/download`}
                >
                  <Download size={14} /> Download
                </a>
                <button
                  onClick={() => reviewFile(file, "needs_changes")}
                  disabled={busy}
                >
                  Needs changes
                </button>
                <button
                  onClick={() => reviewFile(file, "approved")}
                  disabled={busy}
                >
                  Approve
                </button>
              </div>
            </article>
          ))}
      </section>
    </>
  );
}
