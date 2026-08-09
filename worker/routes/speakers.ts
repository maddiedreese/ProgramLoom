import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  pronouns: z.string().trim().max(80).nullable().optional(),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  bio: z.string().trim().max(5000).nullable().optional(),
  social: z
    .object({
      linkedin: z.url().or(z.literal("")).optional(),
      website: z.url().or(z.literal("")).optional(),
      x: z.url().or(z.literal("")).optional(),
    })
    .default({}),
  logistics: z
    .record(
      z.string(),
      z.union([z.string(), z.boolean(), z.number(), z.null()]),
    )
    .default({}),
});
const taskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  taskType: z.enum(["action", "form", "file_request"]),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  assignAll: z.boolean().default(true),
});
const taskResponseSchema = z.object({
  status: z.enum(["todo", "in_progress", "submitted"]),
  response: z.record(z.string(), z.unknown()).default({}),
});
const taskReviewSchema = z.object({
  status: z.enum(["complete", "needs_changes"]),
  note: z.string().trim().max(2000).optional(),
});
const resourceSchema = z.object({
  title: z.string().trim().min(2).max(200),
  bodyHtml: z.string().trim().min(1).max(50000),
  published: z.boolean().default(false),
});
const fileRequestSchema = z.object({
  purpose: z.string().trim().min(2).max(200),
  speakerIds: z.array(z.string().uuid()).min(1).max(200),
});
const fileStatusSchema = z.object({
  status: z.enum(["approved", "needs_changes"]),
  note: z.string().trim().max(2000).optional(),
});

async function speakerContext(
  context: Parameters<typeof requireEventRole>[0],
  eventId: string,
) {
  const access = await requireEventRole(context, eventId, ["speaker"]);
  const db = database(context.env);
  const event = await db
    .prepare(
      "SELECT e.id, e.name, e.organization_id AS organizationId, e.timezone, e.starts_at AS startsAt, e.ends_at AS endsAt, e.venue_name AS venueName, o.name AS organizationName FROM events e JOIN organizations o ON o.id=e.organization_id WHERE e.id=?",
    )
    .bind(eventId)
    .first<Record<string, unknown>>();
  let profile = await db
    .prepare(
      "SELECT id, user_id AS userId, email, first_name AS firstName, last_name AS lastName, pronouns, job_title AS jobTitle, company, bio, headshot_key AS headshotKey, social_json AS socialJson, logistics_json AS logisticsJson, portal_status AS portalStatus FROM speaker_profiles WHERE organization_id=? AND (user_id=? OR email=? COLLATE NOCASE) ORDER BY CASE WHEN user_id=? THEN 0 ELSE 1 END LIMIT 1",
    )
    .bind(
      access.organizationId,
      access.user.id,
      access.user.email,
      access.user.id,
    )
    .first<Record<string, unknown>>();
  if (!profile)
    throw new HttpError(
      404,
      "speaker_profile_not_found",
      "Your speaker profile has not been prepared yet.",
    );
  if (!profile.userId) {
    await db
      .prepare(
        "UPDATE speaker_profiles SET user_id=?, portal_status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(access.user.id, profile.id)
      .run();
    profile = { ...profile, userId: access.user.id, portalStatus: "active" };
  }
  const parsedProfile = {
    ...profile,
    id: String(profile.id),
    social: JSON.parse(String(profile.socialJson)),
    logistics: JSON.parse(String(profile.logisticsJson)),
    socialJson: undefined,
    logisticsJson: undefined,
  } as Record<string, unknown> & { id: string };
  return { access, db, event, profile: parsedProfile };
}

router.get("/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  const { db, event, profile } = await speakerContext(context, eventId);
  const sessions = await db
    .prepare(
      "SELECT s.id, s.title, s.abstract, s.status FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE ss.speaker_id=? AND s.event_id=? ORDER BY s.title",
    )
    .bind(profile.id, eventId)
    .all();
  const tasks = await db
    .prepare(
      "SELECT t.id, t.title, t.description, t.task_type AS taskType, t.due_at AS dueAt, a.status, a.response_json AS responseJson, a.completed_at AS completedAt, a.updated_at AS updatedAt FROM onboarding_tasks t JOIN speaker_task_assignments a ON a.task_id=t.id WHERE t.event_id=? AND a.speaker_id=? ORDER BY t.position, t.due_at",
    )
    .bind(eventId, profile.id)
    .all();
  const resources = await db
    .prepare(
      "SELECT id, title, body_html AS bodyHtml, position, published_at AS publishedAt FROM resources WHERE event_id=? AND published_at IS NOT NULL ORDER BY position",
    )
    .bind(eventId)
    .all();
  const files = await db
    .prepare(
      `SELECT f.id, f.purpose, f.status, f.current_version_id AS currentVersionId, fv.filename, fv.content_type AS contentType, fv.size_bytes AS sizeBytes, fv.version_number AS versionNumber, fv.created_at AS uploadedAt FROM files f LEFT JOIN file_versions fv ON fv.id=f.current_version_id WHERE f.event_id=? AND f.speaker_id=? ORDER BY f.created_at`,
    )
    .bind(eventId, profile.id)
    .all();
  return context.json({
    event,
    profile,
    sessions: sessions.results,
    tasks: tasks.results.map((task: Record<string, unknown>) => ({
      ...task,
      response: task.responseJson ? JSON.parse(String(task.responseJson)) : {},
      responseJson: undefined,
    })),
    resources: resources.results,
    files: files.results,
  });
});

router.patch(
  "/events/:eventId/profile",
  zValidator("json", profileSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const { access, db, profile } = await speakerContext(context, eventId);
    const input = context.req.valid("json");
    await db.batch([
      db
        .prepare(
          "UPDATE speaker_profiles SET first_name=?, last_name=?, pronouns=?, job_title=?, company=?, bio=?, social_json=?, logistics_json=?, portal_status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(
          input.firstName,
          input.lastName,
          input.pronouns ?? null,
          input.jobTitle ?? null,
          input.company ?? null,
          input.bio ?? null,
          JSON.stringify(input.social),
          JSON.stringify(input.logistics),
          profile.id,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_profile.updated",
        entityType: "speaker",
        entityId: String(profile.id),
        after: { ...input, logistics: "[private logistics updated]" },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({
      profile: { ...profile, ...input, portalStatus: "active" },
    });
  },
);

router.post("/events/:eventId/headshot", async (context) => {
  const eventId = context.req.param("eventId");
  const { access, db, profile } = await speakerContext(context, eventId);
  if (!context.env.FILES)
    throw new HttpError(
      503,
      "storage_unavailable",
      "File storage is temporarily unavailable.",
    );
  const form = await context.req.raw.formData();
  const upload = form.get("file");
  if (!(upload instanceof File))
    throw new HttpError(400, "file_required", "Choose a headshot to upload.");
  if (upload.size <= 0 || upload.size > 5 * 1024 * 1024)
    throw new HttpError(
      400,
      "invalid_file_size",
      "Headshots must be between 1 byte and 5 MB.",
    );
  if (!["image/png", "image/jpeg", "image/webp"].includes(upload.type))
    throw new HttpError(
      400,
      "invalid_file_type",
      "Upload a PNG, JPEG, or WebP image.",
    );
  const extension =
    upload.type === "image/png"
      ? "png"
      : upload.type === "image/webp"
        ? "webp"
        : "jpg";
  const key = `${access.organizationId}/${eventId}/${profile.id}/headshots/${crypto.randomUUID()}.${extension}`;
  await context.env.FILES.put(key, await upload.arrayBuffer(), {
    httpMetadata: { contentType: upload.type },
    customMetadata: { originalFilename: upload.name },
  });
  const previousKey =
    typeof profile.headshotKey === "string" ? profile.headshotKey : null;
  try {
    await db.batch([
      db
        .prepare(
          "UPDATE speaker_profiles SET headshot_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(key, profile.id),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_headshot.updated",
        entityType: "speaker",
        entityId: String(profile.id),
        after: { contentType: upload.type, size: upload.size },
        requestId: context.get("requestId"),
      }),
    ]);
  } catch (error) {
    await context.env.FILES.delete(key);
    throw error;
  }
  if (previousKey) await context.env.FILES.delete(previousKey);
  return context.json(
    { headshotUrl: `/api/speakers/events/${eventId}/headshot` },
    201,
  );
});

router.get("/events/:eventId/headshot", async (context) => {
  const eventId = context.req.param("eventId");
  const { profile } = await speakerContext(context, eventId);
  if (!context.env.FILES || typeof profile.headshotKey !== "string")
    throw new HttpError(404, "headshot_not_found", "No headshot was found.");
  const object = await context.env.FILES.get(profile.headshotKey);
  if (!object)
    throw new HttpError(
      404,
      "headshot_not_found",
      "The stored headshot was not found.",
    );
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});

router.patch(
  "/events/:eventId/tasks/:taskId",
  zValidator("json", taskResponseSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const { access, db, profile } = await speakerContext(context, eventId);
    const input = context.req.valid("json");
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE speaker_task_assignments SET status=?, response_json=?, completed_at=NULL, updated_at=? WHERE task_id=? AND speaker_id=? AND task_id IN (SELECT id FROM onboarding_tasks WHERE event_id=?)",
      )
      .bind(
        input.status,
        JSON.stringify(input.response),
        now,
        context.req.param("taskId"),
        profile.id,
        eventId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(404, "task_not_found", "Task not found.");
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "speaker_task.updated",
      entityType: "speaker_task",
      entityId: context.req.param("taskId"),
      after: { status: input.status },
      requestId: context.get("requestId"),
    }).run();
    return context.json({
      task: {
        id: context.req.param("taskId"),
        status: input.status,
        response: input.response,
        updatedAt: now,
      },
    });
  },
);

router.post("/events/:eventId/files/:fileId/upload", async (context) => {
  const eventId = context.req.param("eventId");
  const { access, db, profile } = await speakerContext(context, eventId);
  if (!context.env.FILES)
    throw new HttpError(
      503,
      "storage_unavailable",
      "File storage is temporarily unavailable.",
    );
  const request = await db
    .prepare("SELECT id FROM files WHERE id=? AND event_id=? AND speaker_id=?")
    .bind(context.req.param("fileId"), eventId, profile.id)
    .first();
  if (!request)
    throw new HttpError(
      404,
      "file_request_not_found",
      "File request not found.",
    );
  const form = await context.req.raw.formData();
  const upload = form.get("file");
  if (!(upload instanceof File))
    throw new HttpError(400, "file_required", "Choose a file to upload.");
  if (upload.size <= 0 || upload.size > 25 * 1024 * 1024)
    throw new HttpError(
      400,
      "invalid_file_size",
      "Files must be between 1 byte and 25 MB.",
    );
  const allowed = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/zip",
    "image/png",
    "image/jpeg",
    "image/webp",
  ];
  if (!allowed.includes(upload.type))
    throw new HttpError(
      400,
      "invalid_file_type",
      "Upload a PDF, PowerPoint, ZIP, PNG, JPEG, or WebP file.",
    );
  const buffer = await upload.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const checksum = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const latest = await db
    .prepare(
      "SELECT COALESCE(MAX(version_number),0)+1 AS versionNumber FROM file_versions WHERE file_id=?",
    )
    .bind(context.req.param("fileId"))
    .first<{ versionNumber: number }>();
  const version = Number(latest?.versionNumber ?? 1);
  const safeName =
    upload.name
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 160) || "upload";
  const versionId = crypto.randomUUID();
  const key = `${access.organizationId}/${eventId}/${profile.id}/${context.req.param("fileId")}/v${version}-${versionId}-${safeName}`;
  await context.env.FILES.put(key, buffer, {
    httpMetadata: { contentType: upload.type },
    customMetadata: { sha256: checksum, originalFilename: upload.name },
  });
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO file_versions (id,file_id,r2_key,filename,content_type,size_bytes,sha256,version_number,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          versionId,
          context.req.param("fileId"),
          key,
          upload.name,
          upload.type,
          upload.size,
          checksum,
          version,
          access.user.id,
        ),
      db
        .prepare(
          "UPDATE files SET current_version_id=?, status='submitted', updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(versionId, context.req.param("fileId")),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_file.uploaded",
        entityType: "file",
        entityId: context.req.param("fileId"),
        after: {
          version,
          filename: upload.name,
          size: upload.size,
          sha256: checksum,
        },
        requestId: context.get("requestId"),
      }),
    ]);
  } catch (error) {
    await context.env.FILES.delete(key);
    throw error;
  }
  return context.json(
    {
      file: {
        id: context.req.param("fileId"),
        status: "submitted",
        currentVersionId: versionId,
        filename: upload.name,
        contentType: upload.type,
        sizeBytes: upload.size,
        versionNumber: version,
        sha256: checksum,
      },
    },
    201,
  );
});

router.get("/events/:eventId/files/:fileId/download", async (context) => {
  const eventId = context.req.param("eventId");
  const { db, profile } = await speakerContext(context, eventId);
  if (!context.env.FILES)
    throw new HttpError(
      503,
      "storage_unavailable",
      "File storage is temporarily unavailable.",
    );
  const version = await db
    .prepare(
      "SELECT fv.r2_key AS r2Key, fv.filename, fv.content_type AS contentType FROM files f JOIN file_versions fv ON fv.id=f.current_version_id WHERE f.id=? AND f.event_id=? AND f.speaker_id=?",
    )
    .bind(context.req.param("fileId"), eventId, profile.id)
    .first<{ r2Key: string; filename: string; contentType: string }>();
  if (!version)
    throw new HttpError(404, "file_not_found", "No uploaded file was found.");
  const object = await context.env.FILES.get(version.r2Key);
  if (!object)
    throw new HttpError(
      404,
      "file_not_found",
      "The stored file was not found.",
    );
  return new Response(object.body, {
    headers: {
      "content-type": version.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(version.filename)}`,
      "cache-control": "private, no-store",
    },
  });
});

router.get("/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const speakers = await db
    .prepare(
      `SELECT sp.id, sp.email, sp.first_name AS firstName, sp.last_name AS lastName, sp.pronouns, sp.job_title AS jobTitle, sp.company, sp.bio, sp.portal_status AS portalStatus, COUNT(DISTINCT ss.submission_id) AS sessionCount, COUNT(DISTINCT sta.task_id) AS taskCount, COUNT(DISTINCT CASE WHEN sta.status='complete' THEN sta.task_id END) AS completedTaskCount, COUNT(DISTINCT f.id) AS fileRequestCount, COUNT(DISTINCT CASE WHEN f.status='approved' THEN f.id END) AS approvedFileCount FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id AND s.event_id=? LEFT JOIN speaker_task_assignments sta ON sta.speaker_id=sp.id LEFT JOIN files f ON f.speaker_id=sp.id AND f.event_id=? GROUP BY sp.id ORDER BY sp.last_name,sp.first_name`,
    )
    .bind(eventId, eventId)
    .all();
  const tasks = await db
    .prepare(
      "SELECT id,title,description,task_type AS taskType,due_at AS dueAt,position FROM onboarding_tasks WHERE event_id=? ORDER BY position",
    )
    .bind(eventId)
    .all();
  const taskAssignments = await db
    .prepare(
      "SELECT a.task_id AS taskId,a.speaker_id AS speakerId,sp.first_name||' '||sp.last_name AS speakerName,t.title,a.status,a.response_json AS responseJson,a.completed_at AS completedAt,a.updated_at AS updatedAt FROM speaker_task_assignments a JOIN onboarding_tasks t ON t.id=a.task_id JOIN speaker_profiles sp ON sp.id=a.speaker_id WHERE t.event_id=? ORDER BY a.updated_at DESC",
    )
    .bind(eventId)
    .all();
  const resources = await db
    .prepare(
      "SELECT id,title,body_html AS bodyHtml,published_at AS publishedAt,position FROM resources WHERE event_id=? ORDER BY position",
    )
    .bind(eventId)
    .all();
  const files = await db
    .prepare(
      `SELECT f.id,f.speaker_id AS speakerId,sp.first_name||' '||sp.last_name AS speakerName,f.purpose,f.status,f.current_version_id AS currentVersionId,fv.filename,fv.version_number AS versionNumber,fv.size_bytes AS sizeBytes,fv.created_at AS uploadedAt FROM files f JOIN speaker_profiles sp ON sp.id=f.speaker_id LEFT JOIN file_versions fv ON fv.id=f.current_version_id WHERE f.event_id=? ORDER BY f.created_at`,
    )
    .bind(eventId)
    .all();
  return context.json({
    speakers: speakers.results,
    tasks: tasks.results,
    taskAssignments: taskAssignments.results.map(
      (assignment: Record<string, unknown>) => ({
        ...assignment,
        response: assignment.responseJson
          ? JSON.parse(String(assignment.responseJson))
          : {},
        responseJson: undefined,
      }),
    ),
    resources: resources.results,
    files: files.results,
  });
});

router.post(
  "/admin/events/:eventId/tasks",
  zValidator("json", taskSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const id = crypto.randomUUID();
    const position = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM onboarding_tasks WHERE event_id=?",
          )
          .bind(eventId)
          .first<{ position: number }>()
      )?.position ?? 0,
    );
    const statements = [
      db
        .prepare(
          "INSERT INTO onboarding_tasks (id,event_id,title,description,task_type,due_at,position) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.title,
          input.description ?? null,
          input.taskType,
          input.dueAt ?? null,
          position,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_task.created",
        entityType: "speaker_task",
        entityId: id,
        after: input,
        requestId: context.get("requestId"),
      }),
    ];
    if (input.assignAll)
      statements.push(
        db
          .prepare(
            "INSERT INTO speaker_task_assignments (task_id,speaker_id) SELECT ?,sp.id FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=? GROUP BY sp.id ON CONFLICT (task_id,speaker_id) DO NOTHING",
          )
          .bind(id, eventId),
      );
    await db.batch(statements);
    return context.json({ task: { id, ...input, position } }, 201);
  },
);
router.post(
  "/admin/events/:eventId/resources",
  zValidator("json", resourceSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const id = crypto.randomUUID();
    const position = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM resources WHERE event_id=?",
          )
          .bind(eventId)
          .first<{ position: number }>()
      )?.position ?? 0,
    );
    const publishedAt = input.published ? new Date().toISOString() : null;
    await db.batch([
      db
        .prepare(
          "INSERT INTO resources (id,event_id,title,body_html,position,published_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(id, eventId, input.title, input.bodyHtml, position, publishedAt),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_resource.created",
        entityType: "resource",
        entityId: id,
        after: { title: input.title, published: input.published },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(
      { resource: { id, ...input, position, publishedAt } },
      201,
    );
  },
);
router.post(
  "/admin/events/:eventId/file-requests",
  zValidator("json", fileRequestSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const valid = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=? AND sp.id IN (${input.speakerIds.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...input.speakerIds)
      .first<{ count: number }>();
    if (valid?.count !== new Set(input.speakerIds).size)
      throw new HttpError(
        400,
        "invalid_speakers",
        "Every speaker must belong to this event.",
      );
    const statements = input.speakerIds.map((speakerId) =>
      db
        .prepare(
          "INSERT INTO files (id,organization_id,event_id,speaker_id,purpose) VALUES (?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          access.organizationId,
          eventId,
          speakerId,
          input.purpose,
        ),
    );
    await db.batch(statements);
    return context.json({ created: statements.length }, 201);
  },
);
router.patch(
  "/admin/events/:eventId/task-assignments/:taskId/:speakerId",
  zValidator("json", taskReviewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE speaker_task_assignments SET status=?,completed_at=?,updated_at=? WHERE task_id=? AND speaker_id=? AND task_id IN (SELECT id FROM onboarding_tasks WHERE event_id=?)",
      )
      .bind(
        input.status,
        input.status === "complete" ? now : null,
        now,
        context.req.param("taskId"),
        context.req.param("speakerId"),
        eventId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "task_assignment_not_found",
        "Task assignment not found.",
      );
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: `speaker_task.${input.status}`,
      entityType: "speaker_task",
      entityId: `${context.req.param("taskId")}:${context.req.param("speakerId")}`,
      after: input,
      requestId: context.get("requestId"),
    }).run();
    return context.json({
      assignment: {
        taskId: context.req.param("taskId"),
        speakerId: context.req.param("speakerId"),
        status: input.status,
        completedAt: input.status === "complete" ? now : null,
      },
    });
  },
);
router.patch(
  "/admin/events/:eventId/files/:fileId",
  zValidator("json", fileStatusSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const result = await db
      .prepare(
        "UPDATE files SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=? AND current_version_id IS NOT NULL",
      )
      .bind(input.status, context.req.param("fileId"), eventId)
      .run();
    if (!result.meta.changes)
      throw new HttpError(404, "file_not_found", "Submitted file not found.");
    const statements = [
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: `speaker_file.${input.status}`,
        entityType: "file",
        entityId: context.req.param("fileId"),
        after: input,
        requestId: context.get("requestId"),
      }),
    ];
    if (input.note)
      statements.push(
        db
          .prepare(
            "INSERT INTO comments (id,organization_id,entity_type,entity_id,author_user_id,body) VALUES (?,?,'file',?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            access.organizationId,
            context.req.param("fileId"),
            access.user.id,
            input.note,
          ),
      );
    await db.batch(statements);
    return context.json({
      file: { id: context.req.param("fileId"), status: input.status },
    });
  },
);

router.get("/admin/events/:eventId/files/:fileId/download", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  if (!context.env.FILES)
    throw new HttpError(
      503,
      "storage_unavailable",
      "File storage is temporarily unavailable.",
    );
  const version = await database(context.env)
    .prepare(
      "SELECT fv.r2_key AS r2Key,fv.filename,fv.content_type AS contentType FROM files f JOIN file_versions fv ON fv.id=f.current_version_id WHERE f.id=? AND f.event_id=?",
    )
    .bind(context.req.param("fileId"), eventId)
    .first<{ r2Key: string; filename: string; contentType: string }>();
  if (!version)
    throw new HttpError(404, "file_not_found", "No uploaded file was found.");
  const object = await context.env.FILES.get(version.r2Key);
  if (!object)
    throw new HttpError(
      404,
      "file_not_found",
      "The stored file was not found.",
    );
  return new Response(object.body, {
    headers: {
      "content-type": version.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(version.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

export default router;
