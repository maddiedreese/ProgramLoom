import { unzipSync } from "fflate";

const baseUrl = process.env.PROGRAMLOOM_SMOKE_URL ?? "http://127.0.0.1:5179";
const eventId = "00000000-0000-4000-8000-000000000003";
const organizerSession =
  process.env.PROGRAMLOOM_SMOKE_SESSION ?? "programloom-local-crm-session-v1";
const speakerSession =
  process.env.PROGRAMLOOM_SPEAKER_SESSION ??
  "programloom-local-speaker-content-v1";

async function api(path, session, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie: `programloom_session=${session}`,
      ...(init.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : new Uint8Array(await response.arrayBuffer());
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureTask(title, description, dueAt) {
  const current = await api(
    `/api/content/admin/events/${eventId}`,
    organizerSession,
  );
  if (current.assignments.some((item) => item.title === title)) return;
  await api(`/api/speakers/admin/events/${eventId}/tasks`, organizerSession, {
    method: "POST",
    body: JSON.stringify({
      title,
      description,
      taskType: "file_request",
      dueAt,
      assignAll: true,
    }),
  });
}

await ensureTask(
  "Upload Session Presentation",
  "Final slide deck as a PDF, 16:9 aspect ratio.",
  "2027-05-01T23:59:00.000Z",
);
await ensureTask(
  "Upload Final Headshot (print quality)",
  "Upload a print-quality event headshot.",
  "2027-04-14T23:59:00.000Z",
);

let admin = await api(`/api/content/admin/events/${eventId}`, organizerSession);
const fixtureAssignments = admin.assignments.filter((item) =>
  [
    "Upload Session Presentation",
    "Upload Final Headshot (print quality)",
  ].includes(item.title),
);
assert(
  fixtureAssignments.length === 4,
  "Expected two content tasks for two distinct speakers.",
);
assert(
  fixtureAssignments.every((item) => item.dueAt),
  "Content assignments should retain their deadlines.",
);

const portal = await api(`/api/speakers/events/${eventId}`, speakerSession);
const presentationTask = portal.tasks.find(
  (item) => item.title === "Upload Session Presentation",
);
const headshotTask = portal.tasks.find(
  (item) => item.title === "Upload Final Headshot (print quality)",
);
assert(presentationTask && headshotTask, "Speaker portal is missing tasks.");
const presentationFile = portal.files.find(
  (item) => item.taskId === presentationTask.id,
);
assert(presentationFile, "Presentation task has no linked upload slot.");
const initialDetail = presentationFile.filename
  ? await api(
      `/api/speakers/events/${eventId}/files/${presentationFile.id}`,
      speakerSession,
    )
  : { versions: [] };
const initialVersionCount = initialDetail.versions.length;

const firstBytes = new TextEncoder().encode(
  "%PDF-1.4\n% ProgramLoom content smoke v1\n%%EOF",
);
const secondBytes = new TextEncoder().encode(
  "%PDF-1.4\n% ProgramLoom content smoke v2 final\n%%EOF",
);
for (const [index, bytes] of [firstBytes, secondBytes].entries()) {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], "slides.pdf", { type: "application/pdf" }),
  );
  await api(
    `/api/speakers/events/${eventId}/files/${presentationFile.id}/upload`,
    speakerSession,
    { method: "POST", body: form },
  );
  if (index === 0)
    await api(
      `/api/speakers/events/${eventId}/files/${presentationFile.id}/comments`,
      speakerSession,
      {
        method: "POST",
        body: JSON.stringify({
          body: "Draft deck - final version coming Friday.",
        }),
      },
    );
}

let detail = await api(
  `/api/speakers/events/${eventId}/files/${presentationFile.id}`,
  speakerSession,
);
assert(
  detail.versions.length === initialVersionCount + 2,
  "Each pair of uploads should add two immutable file versions.",
);
assert(
  detail.versions[0].isCurrent,
  "Latest file version is not marked current.",
);
assert(
  detail.comments.some((item) => item.authorName && item.createdAt),
  "Speaker comment lacks author or timestamp.",
);

const denied = await fetch(`${baseUrl}/api/content/admin/events/${eventId}`, {
  headers: { cookie: `programloom_session=${speakerSession}` },
});
assert(denied.status === 403, "Speaker could access organizer content routes.");

await api(
  `/api/speakers/admin/events/${eventId}/files/${presentationFile.id}/comments`,
  organizerSession,
  {
    method: "POST",
    body: JSON.stringify({
      body: "Thanks - please confirm the final version by Tuesday.",
    }),
  },
);
detail = await api(
  `/api/speakers/admin/events/${eventId}/files/${presentationFile.id}`,
  organizerSession,
);
assert(
  detail.comments.length >= 2,
  "Cross-role file thread did not round-trip.",
);

admin = await api(`/api/content/admin/events/${eventId}`, organizerSession);
const primary = admin.sessions.find((item) =>
  item.title.includes("Scaling Reliable Systems"),
);
const other = admin.sessions.find((item) => item.id !== primary?.id);
assert(primary && other, "Expected two accepted content sessions.");
const original = {
  title: primary.title.replace(/^(UPDATED: )+/, ""),
  abstract: primary.abstract,
};
const firstAbstract = primary.abstract.includes(
  "This session now includes a live demo of remote build caching.",
)
  ? primary.abstract.replace(/\n\nAttendees should bring a laptop\./g, "")
  : `${primary.abstract}\n\nThis session now includes a live demo of remote build caching.`;
await api(
  `/api/content/admin/events/${eventId}/sessions/${primary.id}`,
  organizerSession,
  {
    method: "PATCH",
    body: JSON.stringify({
      title: `UPDATED: ${original.title}`,
      abstract: firstAbstract,
      contentStatus: "draft",
    }),
  },
);
await api(
  `/api/content/admin/events/${eventId}/sessions/${primary.id}`,
  organizerSession,
  {
    method: "PATCH",
    body: JSON.stringify({
      title: `UPDATED: ${original.title}`,
      abstract: `${firstAbstract}\n\nAttendees should bring a laptop.`,
      contentStatus: "in_review",
    }),
  },
);
const history = await api(
  `/api/content/admin/events/${eventId}/sessions/${primary.id}/history`,
  organizerSession,
);
assert(
  history.revisions.length >= 2,
  "Session revision history is incomplete.",
);
const firstEdit = history.revisions.find(
  (item) =>
    item.abstract.includes("live demo") &&
    !item.abstract.includes("bring a laptop"),
);
assert(
  firstEdit?.editorName && firstEdit.createdAt,
  "Revision lacks attribution.",
);
await api(
  `/api/content/admin/events/${eventId}/sessions/${primary.id}/history/${firstEdit.id}/restore`,
  organizerSession,
  { method: "POST" },
);
await api(
  `/api/content/admin/events/${eventId}/sessions/${primary.id}`,
  organizerSession,
  {
    method: "PATCH",
    body: JSON.stringify({
      title: `UPDATED: ${original.title}`,
      abstract: firstEdit.abstract,
      contentStatus: "approved",
    }),
  },
);
await api(
  `/api/content/admin/events/${eventId}/sessions/${other.id}`,
  organizerSession,
  {
    method: "PATCH",
    body: JSON.stringify({
      title: other.title,
      abstract: other.abstract,
      contentStatus: "draft",
    }),
  },
);

let widgetAdmin = await api(
  `/api/widgets/admin/events/${eventId}`,
  organizerSession,
);
let sessionsWidget = widgetAdmin.widgets.find(
  (item) => item.widgetType === "sessions",
);
if (!sessionsWidget) {
  const created = await api(
    `/api/widgets/admin/events/${eventId}`,
    organizerSession,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Content approval smoke",
        widgetType: "sessions",
        config: {
          theme: "light",
          primaryColor: "#315c45",
          showSearch: true,
          showFilters: true,
          trackIds: [],
          fields: ["title", "abstract", "speakers", "track"],
        },
      }),
    },
  );
  sessionsWidget = created.widget;
}
const publicSessions = await api(
  `/api/widgets/public/${sessionsWidget.publicKey}`,
  organizerSession,
);
assert(
  publicSessions.sessions.some(
    (item) => item.id === primary.id && item.title.startsWith("UPDATED: "),
  ),
  "Approved edited session did not propagate to public output.",
);
assert(
  !publicSessions.sessions.some((item) => item.id === other.id),
  "Unapproved session leaked into public output.",
);

const ada = admin.speakers.find((item) => item.email === "ada@example.test");
assert(ada, "Speaker content fixture is unavailable.");
await api(
  `/api/content/admin/events/${eventId}/speakers/${ada.id}`,
  organizerSession,
  {
    method: "PATCH",
    body: JSON.stringify({
      firstName: ada.firstName,
      lastName: ada.lastName,
      jobTitle: ada.jobTitle,
      company: ada.company,
      bio: `${ada.bio ?? ""}\nAda leads the developer-productivity group at Latticework Systems.`.trim(),
    }),
  },
);
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const headshot = new FormData();
headshot.set("file", new File([pixel], "headshot.png", { type: "image/png" }));
await api(
  `/api/content/admin/events/${eventId}/speakers/${ada.id}/headshot`,
  organizerSession,
  { method: "POST", body: headshot },
);

const exportResult = await api(
  `/api/content/admin/events/${eventId}/exports`,
  organizerSession,
  {
    method: "POST",
    body: JSON.stringify({
      fileIds: [presentationFile.id],
      grouping: "session",
    }),
  },
);
assert(
  exportResult.export.status === "ready",
  "ZIP export did not become ready.",
);
const archive = await api(exportResult.export.downloadUrl, organizerSession);
const unzipped = unzipSync(archive);
const zippedFiles = Object.values(unzipped);
assert(
  zippedFiles.length === 1,
  "ZIP should contain one selected latest file.",
);
assert(
  Buffer.from(zippedFiles[0]).equals(Buffer.from(secondBytes)),
  "ZIP did not contain the latest file version.",
);

const share = await api(
  `/api/content/admin/events/${eventId}/files/${presentationFile.id}/share`,
  organizerSession,
  { method: "POST" },
);
const shared = await api(new URL(share.shareUrl).pathname, organizerSession);
assert(
  Buffer.from(shared).equals(Buffer.from(secondBytes)),
  "Share link did not serve the latest version.",
);

await api(
  `/api/content/admin/events/${eventId}/sessions/${primary.id}`,
  organizerSession,
  {
    method: "PATCH",
    body: JSON.stringify({
      title: original.title,
      abstract: firstEdit.abstract,
      contentStatus: "approved",
    }),
  },
);

console.log(
  JSON.stringify({
    ok: true,
    taskAssignments: fixtureAssignments.length,
    speakerScoped: denied.status,
    versions: detail.versions.length,
    comments: detail.comments.length,
    revisions: history.revisions.length,
    approvedSession: primary.id,
    unapprovedSession: other.id,
    publicApprovalGate: true,
    zipEntries: zippedFiles.length,
    shareVerified: true,
  }),
);
