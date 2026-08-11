import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";
import { eventManagerNotificationStatement } from "../lib/notifications";
import { notificationStatement } from "../lib/operations";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

export async function assignAllFileTargets(db: D1Database, eventId: string) {
  return db
    .prepare(
      `SELECT ss.speaker_id AS speakerId,MIN(s.id) AS submissionId
       FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id
       WHERE s.event_id=? AND s.status='accepted'
       GROUP BY ss.speaker_id
       ORDER BY ss.speaker_id`,
    )
    .bind(eventId)
    .all<{ speakerId: string; submissionId: string }>();
}

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
const speakerEventStatusSchema = z.object({
  status: z.enum(["proposed", "invited", "confirmed", "withdrawn"]),
});
const fileCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
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
      `SELECT f.id,f.task_id AS taskId,f.submission_id AS submissionId,s.title AS sessionTitle,
              f.purpose,f.status,f.current_version_id AS currentVersionId,fv.filename,
              fv.content_type AS contentType,fv.size_bytes AS sizeBytes,fv.version_number AS versionNumber,
              fv.created_at AS uploadedAt,
              (SELECT COUNT(*) FROM file_versions allv WHERE allv.file_id=f.id) AS versionCount
       FROM files f LEFT JOIN submissions s ON s.id=f.submission_id
       LEFT JOIN file_versions fv ON fv.id=f.current_version_id
       WHERE f.event_id=? AND f.speaker_id=? ORDER BY f.created_at`,
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
      eventManagerNotificationStatement(db, {
        organizationId: access.organizationId,
        eventId,
        category: "speaker",
        notificationType: "speaker.profile_updated",
        severity: "info",
        title: "A speaker updated their profile",
        body: `${input.firstName} ${input.lastName}`,
        actionUrl: `/app/events/${eventId}/speakers#speaker-${profile.id}`,
        entityType: "speaker",
        entityId: String(profile.id),
        coalesceKey: `speaker-profile:${profile.id}`,
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
  const buffer = await upload.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const checksum = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const trackedHeadshot = await db
    .prepare(
      "SELECT id FROM files WHERE event_id=? AND speaker_id=? AND purpose='Speaker headshot' ORDER BY created_at LIMIT 1",
    )
    .bind(eventId, profile.id)
    .first<{ id: string }>();
  const fileId = trackedHeadshot?.id ?? crypto.randomUUID();
  const latest = await db
    .prepare(
      "SELECT COALESCE(MAX(version_number),0)+1 AS versionNumber FROM file_versions WHERE file_id=?",
    )
    .bind(fileId)
    .first<{ versionNumber: number }>();
  const version = Number(latest?.versionNumber ?? 1);
  const versionId = crypto.randomUUID();
  const safeName =
    upload.name
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 160) || `headshot.${extension}`;
  const key = `${access.organizationId}/${eventId}/${profile.id}/headshots/v${version}-${versionId}-${safeName}`;
  await context.env.FILES.put(key, buffer, {
    httpMetadata: { contentType: upload.type },
    customMetadata: { originalFilename: upload.name, sha256: checksum },
  });
  const previousKey =
    typeof profile.headshotKey === "string" ? profile.headshotKey : null;
  try {
    const statements = [
      ...(trackedHeadshot
        ? []
        : [
            db
              .prepare(
                "INSERT INTO files (id,organization_id,event_id,speaker_id,purpose,status) VALUES (?,?,?,?,?,'submitted')",
              )
              .bind(
                fileId,
                access.organizationId,
                eventId,
                profile.id,
                "Speaker headshot",
              ),
          ]),
      db
        .prepare(
          "INSERT INTO file_versions (id,file_id,r2_key,filename,content_type,size_bytes,sha256,version_number,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          versionId,
          fileId,
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
          "UPDATE files SET current_version_id=?,status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(versionId, fileId),
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
        entityType: "file",
        entityId: fileId,
        after: { contentType: upload.type, size: upload.size },
        requestId: context.get("requestId"),
      }),
      eventManagerNotificationStatement(db, {
        organizationId: access.organizationId,
        eventId,
        category: "file",
        notificationType: previousKey ? "file.replaced" : "file.uploaded",
        severity: "info",
        title: previousKey
          ? "A speaker replaced their headshot"
          : "A speaker uploaded a headshot",
        body: `${profile.firstName} ${profile.lastName}`,
        actionUrl: `/app/events/${eventId}/content?file=${fileId}`,
        entityType: "file",
        entityId: fileId,
        coalesceKey: `speaker-headshot:${profile.id}`,
      }),
    ];
    await db.batch(statements);
  } catch (error) {
    await context.env.FILES.delete(key);
    throw error;
  }
  return context.json(
    {
      headshotUrl: `/api/speakers/events/${eventId}/headshot`,
      fileId,
      version,
    },
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
    if (input.status === "submitted")
      await eventManagerNotificationStatement(db, {
        organizationId: access.organizationId,
        eventId,
        category: "task",
        notificationType: "task.completed",
        severity: "info",
        title: "A speaker completed an onboarding task",
        body: `${profile.firstName} ${profile.lastName}`,
        actionUrl: `/app/events/${eventId}/speakers#task-${context.req.param("taskId")}`,
        entityType: "speaker_task",
        entityId: `${context.req.param("taskId")}:${profile.id}`,
        coalesceKey: `speaker-task:${context.req.param("taskId")}:${profile.id}`,
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
    .prepare(
      `SELECT f.id,f.task_id AS taskId,e.file_uploads_enabled AS fileUploadsEnabled
       FROM files f JOIN events e ON e.id=f.event_id
       WHERE f.id=? AND f.event_id=? AND f.speaker_id=?`,
    )
    .bind(context.req.param("fileId"), eventId, profile.id)
    .first<{ id: string; taskId?: string; fileUploadsEnabled: number }>();
  if (!request)
    throw new HttpError(
      404,
      "file_request_not_found",
      "File request not found.",
    );
  if (!request.fileUploadsEnabled)
    throw new HttpError(
      409,
      "file_uploads_disabled",
      "This event is not currently accepting file uploads.",
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
    const statements = [
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
      eventManagerNotificationStatement(db, {
        organizationId: access.organizationId,
        eventId,
        category: "file",
        notificationType: version > 1 ? "file.replaced" : "file.uploaded",
        severity: "info",
        title:
          version > 1
            ? "A speaker replaced a requested file"
            : "A speaker uploaded a requested file",
        body: upload.name,
        actionUrl: `/app/events/${eventId}/content?file=${context.req.param("fileId")}`,
        entityType: "file",
        entityId: context.req.param("fileId"),
        coalesceKey: `file-upload:${context.req.param("fileId")}`,
      }),
    ];
    if (request.taskId)
      statements.push(
        db
          .prepare(
            "UPDATE speaker_task_assignments SET status='submitted',response_json=?,updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND speaker_id=?",
          )
          .bind(
            JSON.stringify({ fileId: context.req.param("fileId"), version }),
            request.taskId,
            profile.id,
          ),
      );
    await db.batch(statements);
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

router.get("/events/:eventId/files/:fileId", async (context) => {
  const eventId = context.req.param("eventId");
  const { db, profile } = await speakerContext(context, eventId);
  await requireOwnedFile(db, context.req.param("fileId"), eventId, profile.id);
  return context.json(await fileDetail(db, context.req.param("fileId")));
});

router.post(
  "/events/:eventId/files/:fileId/comments",
  zValidator("json", fileCommentSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const { access, db, profile } = await speakerContext(context, eventId);
    await requireOwnedFile(
      db,
      context.req.param("fileId"),
      eventId,
      profile.id,
    );
    const input = context.req.valid("json");
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO comments(id,organization_id,entity_type,entity_id,author_user_id,body) VALUES(?,?,'file',?,?,?)",
        )
        .bind(
          id,
          access.organizationId,
          context.req.param("fileId"),
          access.user.id,
          input.body,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_file.commented",
        entityType: "file",
        entityId: context.req.param("fileId"),
        after: { commentId: id },
        requestId: context.get("requestId"),
      }),
      eventManagerNotificationStatement(db, {
        organizationId: access.organizationId,
        eventId,
        category: "file",
        notificationType: "file.comment_added",
        severity: "info",
        title: "A speaker commented on a file",
        body: "Open the file thread to review the comment.",
        actionUrl: `/app/events/${eventId}/content?file=${context.req.param("fileId")}`,
        entityType: "file",
        entityId: context.req.param("fileId"),
        coalesceKey: `file-comment:${context.req.param("fileId")}`,
      }),
    ]);
    return context.json(
      {
        comment: {
          id,
          body: input.body,
          authorName: access.user.name,
          createdAt: new Date().toISOString(),
        },
      },
      201,
    );
  },
);

router.delete("/admin/events/:eventId/tasks/:taskId", async (context) => {
  const eventId = context.req.param("eventId");
  const taskId = context.req.param("taskId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const task = await db
    .prepare(
      `SELECT id,title,description,task_type AS taskType,due_at AS dueAt
       FROM onboarding_tasks WHERE id=? AND event_id=?`,
    )
    .bind(taskId, eventId)
    .first<Record<string, unknown>>();
  if (!task) throw new HttpError(404, "task_not_found", "Task not found.");
  const uploaded = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM file_versions fv
       JOIN files f ON f.id=fv.file_id WHERE f.task_id=? AND f.event_id=?`,
    )
    .bind(taskId, eventId)
    .first<{ count: number }>();
  if (Number(uploaded?.count ?? 0) > 0)
    throw new HttpError(
      409,
      "task_has_uploads",
      "This task has uploaded file history and cannot be deleted. Keep it for auditability.",
    );
  await db.batch([
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "speaker_task.deleted",
      entityType: "speaker_task",
      entityId: taskId,
      before: task,
      after: { deleted: true, emptyFileRequestsRemoved: true },
      requestId: context.get("requestId"),
    }),
    db
      .prepare(
        "DELETE FROM files WHERE task_id=? AND event_id=? AND current_version_id IS NULL",
      )
      .bind(taskId, eventId),
    db
      .prepare("DELETE FROM onboarding_tasks WHERE id=? AND event_id=?")
      .bind(taskId, eventId),
  ]);
  return context.json({ ok: true });
});

router.delete(
  "/admin/events/:eventId/tasks/:taskId/assignments/:speakerId",
  async (context) => {
    const eventId = context.req.param("eventId");
    const taskId = context.req.param("taskId");
    const speakerId = context.req.param("speakerId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const assignment = await db
      .prepare(
        `SELECT sta.status,t.title,sp.first_name||' '||sp.last_name AS speakerName
         FROM speaker_task_assignments sta
         JOIN onboarding_tasks t ON t.id=sta.task_id
         JOIN speaker_profiles sp ON sp.id=sta.speaker_id
         WHERE sta.task_id=? AND sta.speaker_id=? AND t.event_id=?`,
      )
      .bind(taskId, speakerId, eventId)
      .first<{ status: string; title: string; speakerName: string }>();
    if (!assignment)
      throw new HttpError(
        404,
        "assignment_not_found",
        "Task assignment not found.",
      );
    if (!["todo", "in_progress"].includes(assignment.status))
      throw new HttpError(
        409,
        "assignment_has_progress",
        "Only untouched task assignments can be removed. Keep submitted or completed work for auditability.",
      );
    const uploaded = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM file_versions fv JOIN files f ON f.id=fv.file_id
         WHERE f.task_id=? AND f.speaker_id=? AND f.event_id=?`,
      )
      .bind(taskId, speakerId, eventId)
      .first<{ count: number }>();
    if (Number(uploaded?.count ?? 0) > 0)
      throw new HttpError(
        409,
        "assignment_has_uploads",
        "This assignment has uploaded file history and cannot be removed.",
      );
    await db.batch([
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker_task.assignment_removed",
        entityType: "speaker_task",
        entityId: `${taskId}:${speakerId}`,
        before: assignment,
        after: { removed: true, emptyFileRequestRemoved: true },
        requestId: context.get("requestId"),
      }),
      db
        .prepare(
          `DELETE FROM files WHERE task_id=? AND speaker_id=? AND event_id=?
           AND current_version_id IS NULL`,
        )
        .bind(taskId, speakerId, eventId),
      db
        .prepare(
          "DELETE FROM speaker_task_assignments WHERE task_id=? AND speaker_id=?",
        )
        .bind(taskId, speakerId),
    ]);
    return context.json({ ok: true });
  },
);

router.get(
  "/events/:eventId/files/:fileId/versions/:versionId/download",
  async (context) => {
    const eventId = context.req.param("eventId");
    const { db, profile } = await speakerContext(context, eventId);
    await requireOwnedFile(
      db,
      context.req.param("fileId"),
      eventId,
      profile.id,
    );
    return serveFileVersion(
      context.env,
      db,
      context.req.param("fileId"),
      context.req.param("versionId"),
    );
  },
);

router.get("/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const speakers = await db
    .prepare(
      `SELECT sp.id,sp.email,sp.first_name AS firstName,sp.last_name AS lastName,sp.pronouns,sp.job_title AS jobTitle,sp.company,sp.bio,sp.headshot_key AS headshotKey,sp.social_json AS socialJson,sp.logistics_json AS logisticsJson,sp.portal_status AS portalStatus,
              COALESCE((SELECT es.status FROM event_speakers es WHERE es.event_id=? AND es.speaker_id=sp.id),'confirmed') AS eventStatus,
              COUNT(DISTINCT CASE WHEN session.event_id=? THEN ss.submission_id END) AS sessionCount,COUNT(DISTINCT task.id) AS taskCount,COUNT(DISTINCT CASE WHEN sta.status='complete' THEN task.id END) AS completedTaskCount,COUNT(DISTINCT f.id) AS fileRequestCount,COUNT(DISTINCT CASE WHEN f.status='approved' THEN f.id END) AS approvedFileCount FROM speaker_profiles sp JOIN (SELECT speaker_id FROM event_speakers WHERE event_id=? UNION SELECT ss2.speaker_id FROM session_speakers ss2 JOIN submissions s2 ON s2.id=ss2.submission_id WHERE s2.event_id=?) roster ON roster.speaker_id=sp.id LEFT JOIN session_speakers ss ON ss.speaker_id=sp.id LEFT JOIN submissions session ON session.id=ss.submission_id LEFT JOIN speaker_task_assignments sta ON sta.speaker_id=sp.id LEFT JOIN onboarding_tasks task ON task.id=sta.task_id AND task.event_id=? LEFT JOIN files f ON f.speaker_id=sp.id AND f.event_id=? GROUP BY sp.id ORDER BY sp.last_name,sp.first_name`,
    )
    .bind(eventId, eventId, eventId, eventId, eventId, eventId)
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
    speakers: speakers.results.map((speaker: Record<string, unknown>) => ({
      ...speaker,
      social: speaker.socialJson ? JSON.parse(String(speaker.socialJson)) : {},
      logistics: speaker.logisticsJson
        ? JSON.parse(String(speaker.logisticsJson))
        : {},
      socialJson: undefined,
      logisticsJson: undefined,
    })),
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

router.get(
  "/admin/events/:eventId/speakers/:speakerId/headshot",
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    const profile = await database(context.env)
      .prepare(
        `SELECT sp.headshot_key AS headshotKey FROM speaker_profiles sp
         WHERE sp.id=? AND (
           EXISTS(SELECT 1 FROM event_speakers es WHERE es.event_id=? AND es.speaker_id=sp.id)
           OR EXISTS(SELECT 1 FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=? AND ss.speaker_id=sp.id)
         )`,
      )
      .bind(context.req.param("speakerId"), eventId, eventId)
      .first<{ headshotKey: string | null }>();
    if (!context.env.FILES || !profile?.headshotKey)
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
  },
);

router.patch(
  "/admin/events/:eventId/speakers/:speakerId/status",
  zValidator("json", speakerEventStatusSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const speakerId = context.req.param("speakerId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const belongs = await db
      .prepare(
        `SELECT 1 FROM speaker_profiles sp WHERE sp.id=? AND
         (EXISTS(SELECT 1 FROM event_speakers es WHERE es.event_id=? AND es.speaker_id=sp.id)
          OR EXISTS(SELECT 1 FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=? AND ss.speaker_id=sp.id))`,
      )
      .bind(speakerId, eventId, eventId)
      .first();
    if (!belongs)
      throw new HttpError(404, "speaker_not_found", "Speaker not found.");
    const before = await db
      .prepare(
        "SELECT status FROM event_speakers WHERE event_id=? AND speaker_id=?",
      )
      .bind(eventId, speakerId)
      .first<{ status: string }>();
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_speakers(event_id,speaker_id,source,added_by,status)
           VALUES(?,?,?, ?,?)
           ON CONFLICT(event_id,speaker_id) DO UPDATE SET status=excluded.status`,
        )
        .bind(eventId, speakerId, "organizer", access.user.id, input.status),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "speaker.event_status_updated",
        entityType: "speaker",
        entityId: speakerId,
        before: { status: before?.status ?? "confirmed" },
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ speaker: { id: speakerId, ...input } });
  },
);

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
    const existing = await db
      .prepare(
        `SELECT id,position FROM onboarding_tasks
         WHERE event_id=? AND task_type=? AND title=? COLLATE NOCASE
         ORDER BY position,id LIMIT 1`,
      )
      .bind(eventId, input.taskType, input.title)
      .first<{ id: string; position: number }>();
    if (existing) {
      const fileTargets =
        input.assignAll && input.taskType === "file_request"
          ? await assignAllFileTargets(db, eventId)
          : { results: [] };
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE onboarding_tasks SET description=?,due_at=?
             WHERE id=? AND event_id=?`,
          )
          .bind(
            input.description ?? null,
            input.dueAt ?? null,
            existing.id,
            eventId,
          ),
        auditStatement(db, {
          organizationId: access.organizationId,
          eventId,
          actorUserId: access.user.id,
          action: "speaker_task.reused",
          entityType: "speaker_task",
          entityId: existing.id,
          after: { ...input, duplicatePrevented: true },
          requestId: context.get("requestId"),
        }),
      ];
      if (input.assignAll)
        statements.push(
          db
            .prepare(
              `INSERT INTO speaker_task_assignments (task_id,speaker_id)
               SELECT ?,sp.id FROM speaker_profiles sp
               JOIN session_speakers ss ON ss.speaker_id=sp.id
               JOIN submissions s ON s.id=ss.submission_id
               WHERE s.event_id=? GROUP BY sp.id
               ON CONFLICT (task_id,speaker_id) DO NOTHING`,
            )
            .bind(existing.id, eventId),
        );
      for (const target of fileTargets.results)
        statements.push(
          db
            .prepare(
              `INSERT INTO files
               (id,organization_id,event_id,submission_id,speaker_id,task_id,purpose)
               SELECT ?,?,?,?,?,?,?
               WHERE NOT EXISTS (
                 SELECT 1 FROM files
                 WHERE event_id=? AND speaker_id=? AND task_id=?
               )`,
            )
            .bind(
              crypto.randomUUID(),
              access.organizationId,
              eventId,
              target.submissionId,
              target.speakerId,
              existing.id,
              input.title,
              eventId,
              target.speakerId,
              existing.id,
            ),
        );
      await db.batch(statements);
      return context.json({
        task: { id: existing.id, ...input, position: existing.position },
        reused: true,
      });
    }
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
    const fileTargets =
      input.assignAll && input.taskType === "file_request"
        ? await assignAllFileTargets(db, eventId)
        : { results: [] };
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
    for (const target of fileTargets.results)
      statements.push(
        db
          .prepare(
            `INSERT INTO files
             (id,organization_id,event_id,submission_id,speaker_id,task_id,purpose)
             VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            access.organizationId,
            eventId,
            target.submissionId,
            target.speakerId,
            id,
            input.title,
          ),
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
    const fileRecipient = await db
      .prepare(
        `SELECT sp.user_id userId FROM files f JOIN speaker_profiles sp ON sp.id=f.speaker_id
         WHERE f.id=? AND f.event_id=?`,
      )
      .bind(context.req.param("fileId"), eventId)
      .first<{ userId: string | null }>();
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
    if (input.status === "needs_changes" && fileRecipient?.userId)
      statements.push(
        notificationStatement(db, {
          organizationId: access.organizationId,
          eventId,
          recipientUserId: fileRecipient.userId,
          category: "file",
          notificationType: "file.needs_changes",
          severity: "warning",
          title: "A requested file needs changes",
          body:
            input.note || "Open the file thread for the organizer's feedback.",
          actionUrl: `/app/events/${eventId}/speaker#file-${context.req.param("fileId")}`,
          entityType: "file",
          entityId: context.req.param("fileId"),
          coalesceKey: `file-needs-changes:${context.req.param("fileId")}`,
        }),
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

router.get("/admin/events/:eventId/files/:fileId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const file = await db
    .prepare("SELECT id FROM files WHERE id=? AND event_id=?")
    .bind(context.req.param("fileId"), eventId)
    .first();
  if (!file) throw new HttpError(404, "file_not_found", "File not found.");
  return context.json(await fileDetail(db, context.req.param("fileId")));
});

router.post(
  "/admin/events/:eventId/files/:fileId/comments",
  zValidator("json", fileCommentSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const file = await db
      .prepare("SELECT id FROM files WHERE id=? AND event_id=?")
      .bind(context.req.param("fileId"), eventId)
      .first();
    if (!file) throw new HttpError(404, "file_not_found", "File not found.");
    const input = context.req.valid("json");
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO comments(id,organization_id,entity_type,entity_id,author_user_id,body) VALUES(?,?,'file',?,?,?)",
      )
      .bind(
        id,
        access.organizationId,
        context.req.param("fileId"),
        access.user.id,
        input.body,
      )
      .run();
    return context.json(
      {
        comment: {
          id,
          body: input.body,
          authorName: access.user.name,
          createdAt: new Date().toISOString(),
        },
      },
      201,
    );
  },
);

router.get(
  "/admin/events/:eventId/files/:fileId/versions/:versionId/download",
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    const db = database(context.env);
    const file = await db
      .prepare("SELECT id FROM files WHERE id=? AND event_id=?")
      .bind(context.req.param("fileId"), eventId)
      .first();
    if (!file) throw new HttpError(404, "file_not_found", "File not found.");
    return serveFileVersion(
      context.env,
      db,
      context.req.param("fileId"),
      context.req.param("versionId"),
    );
  },
);

async function requireOwnedFile(
  db: D1Database,
  fileId: string,
  eventId: string,
  speakerId: string,
) {
  const file = await db
    .prepare("SELECT id FROM files WHERE id=? AND event_id=? AND speaker_id=?")
    .bind(fileId, eventId, speakerId)
    .first();
  if (!file) throw new HttpError(404, "file_not_found", "File not found.");
}

async function fileDetail(db: D1Database, fileId: string) {
  const [versions, comments] = await Promise.all([
    db
      .prepare(
        `SELECT fv.id,fv.filename,fv.content_type AS contentType,fv.size_bytes AS sizeBytes,
                fv.sha256,fv.version_number AS versionNumber,fv.created_at AS createdAt,
                u.name AS uploadedByName,
                CASE WHEN f.current_version_id=fv.id THEN 1 ELSE 0 END AS isCurrent
         FROM file_versions fv JOIN files f ON f.id=fv.file_id JOIN users u ON u.id=fv.uploaded_by
         WHERE fv.file_id=? ORDER BY fv.version_number DESC`,
      )
      .bind(fileId)
      .all(),
    db
      .prepare(
        `SELECT c.id,c.body,c.created_at AS createdAt,c.edited_at AS editedAt,u.name AS authorName
         FROM comments c JOIN users u ON u.id=c.author_user_id
         WHERE c.entity_type='file' AND c.entity_id=? AND c.deleted_at IS NULL
         ORDER BY c.created_at`,
      )
      .bind(fileId)
      .all(),
  ]);
  return {
    versions: versions.results.map((version: Record<string, unknown>) => ({
      ...version,
      isCurrent: Boolean(version.isCurrent),
    })),
    comments: comments.results,
  };
}

async function serveFileVersion(
  env: Env,
  db: D1Database,
  fileId: string,
  versionId: string,
) {
  if (!env.FILES)
    throw new HttpError(
      503,
      "storage_unavailable",
      "File storage is unavailable.",
    );
  const version = await db
    .prepare(
      "SELECT r2_key AS r2Key,filename,content_type AS contentType FROM file_versions WHERE id=? AND file_id=?",
    )
    .bind(versionId, fileId)
    .first<{ r2Key: string; filename: string; contentType: string }>();
  if (!version)
    throw new HttpError(404, "version_not_found", "File version not found.");
  const object = await env.FILES.get(version.r2Key);
  if (!object)
    throw new HttpError(404, "file_not_found", "Stored file not found.");
  return new Response(object.body, {
    headers: {
      "content-type": version.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(version.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default router;
