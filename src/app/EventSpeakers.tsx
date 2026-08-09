import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  FileInput,
  Inbox,
  LoaderCircle,
  Plus,
  Save,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

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
  speakerId?: string;
  speakerName?: string;
  purpose: string;
  status: string;
  filename: string | null;
  sizeBytes: number | null;
  versionNumber: number | null;
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
  const safe = useMemo(() => {
    const document = new DOMParser().parseFromString(html, "text/html");
    document
      .querySelectorAll("script,style,object,embed,link,meta")
      .forEach((node) => node.remove());
    document.querySelectorAll("*").forEach((element) => {
      for (const attribute of [...element.attributes])
        if (
          attribute.name.startsWith("on") ||
          attribute.name === "srcdoc" ||
          (attribute.name === "href" &&
            attribute.value.trim().toLowerCase().startsWith("javascript:"))
        )
          element.removeAttribute(attribute.name);
      if (element instanceof HTMLIFrameElement) {
        const source = element.getAttribute("src") ?? "";
        const allowed = [
          "https://www.youtube.com/embed/",
          "https://player.vimeo.com/video/",
          "https://docs.google.com/presentation/",
        ].some((prefix) => source.startsWith(prefix));
        if (!allowed) element.remove();
        else {
          element.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-presentation",
          );
          element.setAttribute("loading", "lazy");
        }
      }
    });
    return document.body.innerHTML;
  }, [html]);
  return (
    <div className="resource-body" dangerouslySetInnerHTML={{ __html: safe }} />
  );
}

function EventChrome({
  event,
  user,
  eventId,
  children,
}: {
  event?: EventRecord;
  user: User;
  eventId: string;
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
        <nav className="event-nav" aria-label="Event workspace">
          <a href={`/app/events/${eventId}`}>
            <FileInput size={18} /> Call for proposals
          </a>
          <a href={`/app/events/${eventId}/submissions`}>
            <Inbox size={18} /> Submissions
          </a>
          <a href={`/app/events/${eventId}/reviews`}>
            <CheckCircle2 size={18} /> Reviews
          </a>
          <a className="active" href={`/app/events/${eventId}/speakers`}>
            <UsersRound size={18} /> Speakers
          </a>
          <span>
            <Clock3 size={18} /> Agenda
          </span>
        </nav>
        <div className="sidebar-user">
          <span>{user.name}</span>
          <small>{user.email}</small>
        </div>
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
    <EventChrome event={event} user={user} eventId={eventId}>
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
                <div className="portal-task" key={task.id}>
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
                    <button onClick={() => submitTask(task)} disabled={busy}>
                      Submit
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
              <article key={resource.id}>
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
              <article key={file.id}>
                <div>
                  <FileInput size={20} />
                  <span>
                    <strong>{file.purpose}</strong>
                    <small>
                      {file.filename
                        ? `${file.filename} · Version ${file.versionNumber}`
                        : "Waiting for upload"}
                    </small>
                  </span>
                </div>
                <em className={`submission-status status-${file.status}`}>
                  {file.status.replaceAll("_", " ")}
                </em>
                <div>
                  {file.filename && (
                    <a
                      className="button button-ghost button-small"
                      href={`/api/speakers/events/${eventId}/files/${file.id}/download`}
                    >
                      <Download size={14} /> Download
                    </a>
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
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
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
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/speakers/admin/events/${eventId}/resources`, {
        method: "POST",
        body: JSON.stringify({
          title: data.get("title"),
          bodyHtml: data.get("bodyHtml"),
          published: data.get("published") === "on",
        }),
      });
      event.currentTarget.reset();
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
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/speakers/admin/events/${eventId}/file-requests`, {
        method: "POST",
        body: JSON.stringify({
          purpose: data.get("purpose"),
          speakerIds: speakers.map((speaker) => speaker.id),
        }),
      });
      event.currentTarget.reset();
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
      </header>
      {feedback && (
        <div className={`form-status form-status-${feedback.kind}`}>
          {feedback.message}
        </div>
      )}
      <section className="speaker-roster">
        {speakers.map((speaker) => (
          <article key={speaker.id}>
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
