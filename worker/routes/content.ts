import { zValidator } from "@hono/zod-validator";
import { zipSync } from "fflate";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";
import { randomToken, sha256 } from "../lib/crypto";
import { syncAgendaCalendarInvitations } from "../lib/calendarLifecycle";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "../lib/communications";
import { renderSimpleTransactionalEmail } from "../lib/email";
import {
  domainEventStatement,
  logOperationalEvent,
  notificationStatement,
  safeOperationalError,
} from "../lib/operations";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

const sessionSchema = z.object({
  title: z.string().trim().min(2).max(300),
  abstract: z.string().trim().max(20_000),
  contentStatus: z.enum(["draft", "in_review", "approved"]),
});
const speakerSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  bio: z.string().trim().max(5000).nullable().optional(),
});
const exportSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(100),
  grouping: z.enum(["session", "speaker", "flat"]).default("session"),
});
const remixSchema = z.object({
  objective: z.enum(["clarity", "concise", "tone"]).default("clarity"),
});

router.get("/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const [event, sessions, speakers, assignments, files, exports] =
    await Promise.all([
      db
        .prepare(
          "SELECT id,name,timezone,file_uploads_enabled AS fileUploadsEnabled FROM events WHERE id=?",
        )
        .bind(eventId)
        .first(),
      db
        .prepare(
          `SELECT s.id,s.title,s.abstract,s.status,COALESCE(cs.status,'draft') AS contentStatus,
                  COUNT(DISTINCT f.id) AS fileCount
           FROM submissions s
           LEFT JOIN session_content_state cs ON cs.submission_id=s.id
           LEFT JOIN files f ON f.submission_id=s.id
           WHERE s.event_id=? AND s.status='accepted'
           GROUP BY s.id ORDER BY s.title`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT DISTINCT sp.id,sp.first_name AS firstName,sp.last_name AS lastName,
                  sp.email,sp.job_title AS jobTitle,sp.company,sp.bio,
                  CASE WHEN sp.headshot_key IS NULL THEN 0 ELSE 1 END AS hasHeadshot
           FROM speaker_profiles sp
           JOIN session_speakers ss ON ss.speaker_id=sp.id
           JOIN submissions s ON s.id=ss.submission_id
           WHERE s.event_id=? AND s.status='accepted'
           ORDER BY sp.last_name,sp.first_name`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT a.task_id AS taskId,a.speaker_id AS speakerId,
                  sp.first_name||' '||sp.last_name AS speakerName,sp.email,
                  t.title,t.description,t.due_at AS dueAt,a.status,a.completed_at AS completedAt,
                  COUNT(DISTINCT f.id) AS fileCount
           FROM speaker_task_assignments a
           JOIN onboarding_tasks t ON t.id=a.task_id
           JOIN speaker_profiles sp ON sp.id=a.speaker_id
           LEFT JOIN files f ON f.task_id=t.id AND f.speaker_id=sp.id
           WHERE t.event_id=? AND t.task_type='file_request'
           GROUP BY a.task_id,a.speaker_id ORDER BY t.due_at,t.title,speakerName`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT f.id,f.task_id AS taskId,f.submission_id AS submissionId,
                  s.title AS sessionTitle,f.speaker_id AS speakerId,
                  sp.first_name||' '||sp.last_name AS speakerName,f.purpose,f.status,
                  fv.filename,fv.size_bytes AS sizeBytes,fv.created_at AS uploadedAt,
                  (SELECT COUNT(*) FROM file_versions allv WHERE allv.file_id=f.id) AS versionCount
           FROM files f
           JOIN speaker_profiles sp ON sp.id=f.speaker_id
           LEFT JOIN submissions s ON s.id=f.submission_id
           LEFT JOIN file_versions fv ON fv.id=f.current_version_id
           WHERE f.event_id=? ORDER BY COALESCE(fv.created_at,f.created_at) DESC`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT id,status,grouping,size_bytes AS sizeBytes,error,created_at AS createdAt,completed_at AS completedAt FROM content_exports WHERE event_id=? ORDER BY created_at DESC LIMIT 20",
        )
        .bind(eventId)
        .all(),
    ]);
  return context.json({
    event: { ...event, fileUploadsEnabled: Boolean(event?.fileUploadsEnabled) },
    sessions: sessions.results,
    speakers: speakers.results.map((speaker: Record<string, unknown>) => ({
      ...speaker,
      hasHeadshot: Boolean(speaker.hasHeadshot),
      headshotUrl: speaker.hasHeadshot
        ? `/api/widgets/public/events/${eventId}/speakers/${speaker.id}/headshot`
        : null,
    })),
    assignments: assignments.results,
    files: files.results,
    exports: exports.results,
  });
});

router.patch(
  "/admin/events/:eventId/settings",
  zValidator("json", z.object({ fileUploadsEnabled: z.boolean() })),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await db.batch([
      db
        .prepare(
          "UPDATE events SET file_uploads_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(input.fileUploadsEnabled ? 1 : 0, eventId),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "content.file_uploads_configured",
        entityType: "event",
        entityId: eventId,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(input);
  },
);

router.patch(
  "/admin/events/:eventId/sessions/:submissionId",
  zValidator("json", sessionSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const current = await db
      .prepare(
        `SELECT s.id,s.title,s.abstract,s.answers_json AS answersJson,
         COALESCE(cs.status,'draft') contentStatus FROM submissions s
         LEFT JOIN session_content_state cs ON cs.submission_id=s.id
         WHERE s.id=? AND s.event_id=? AND s.status='accepted'`,
      )
      .bind(context.req.param("submissionId"), eventId)
      .first<{
        id: string;
        title: string;
        abstract: string;
        answersJson: string;
        contentStatus: string;
      }>();
    if (!current)
      throw new HttpError(404, "session_not_found", "Session not found.");
    const contentChanged =
      current.title !== input.title || current.abstract !== input.abstract;
    const speakerUsers = await db
      .prepare(
        `SELECT DISTINCT sp.user_id userId FROM session_speakers ss
         JOIN speaker_profiles sp ON sp.id=ss.speaker_id
         WHERE ss.submission_id=? AND sp.user_id IS NOT NULL LIMIT 20`,
      )
      .bind(current.id)
      .all<{ userId: string }>();
    const statements: D1PreparedStatement[] = [];
    if (contentChanged) {
      const next = await db
        .prepare(
          "SELECT COALESCE(MAX(version_number),0)+1 AS versionNumber FROM content_revisions WHERE submission_id=?",
        )
        .bind(current.id)
        .first<{ versionNumber: number }>();
      statements.push(
        db
          .prepare(
            `INSERT INTO content_revisions
             (id,submission_id,version_number,title,abstract,answers_json,created_by)
             VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            current.id,
            Number(next?.versionNumber ?? 1),
            current.title,
            current.abstract,
            current.answersJson,
            access.user.id,
          ),
        db
          .prepare(
            "UPDATE submissions SET title=?,abstract=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?",
          )
          .bind(input.title, input.abstract, current.id, eventId),
        db
          .prepare(
            `UPDATE agenda_items SET title=?,description=?,status='draft',
             version=version+1,updated_at=CURRENT_TIMESTAMP
             WHERE submission_id=? AND event_id=? AND cancelled_at IS NULL`,
          )
          .bind(input.title, input.abstract, current.id, eventId),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO session_content_state(submission_id,status,updated_by)
           VALUES(?,?,?) ON CONFLICT(submission_id) DO UPDATE SET
           status=excluded.status,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(current.id, input.contentStatus, access.user.id),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: contentChanged
          ? "content.session_updated"
          : "content.status_updated",
        entityType: "submission",
        entityId: current.id,
        before: { title: current.title, abstract: current.abstract },
        after: input,
        requestId: context.get("requestId"),
      }),
      ...(current.contentStatus !== input.contentStatus &&
      ["approved", "draft"].includes(input.contentStatus)
        ? speakerUsers.results.map((speaker) =>
            notificationStatement(db, {
              organizationId: access.organizationId,
              eventId,
              recipientUserId: speaker.userId,
              category: "content",
              notificationType:
                input.contentStatus === "approved"
                  ? "content.session_approved"
                  : "content.session_returned",
              severity: input.contentStatus === "approved" ? "info" : "warning",
              title:
                input.contentStatus === "approved"
                  ? "Your session content was approved"
                  : "Your session content was returned for changes",
              body: input.title,
              actionUrl: `/app/events/${eventId}/speaker`,
              entityType: "submission",
              entityId: current.id,
              coalesceKey: `session-content:${current.id}`,
            }),
          )
        : []),
    );
    await db.batch(statements);
    let calendarFailures = 0;
    if (contentChanged) {
      const agendaItems = await db
        .prepare(
          `SELECT id FROM agenda_items WHERE submission_id=? AND event_id=?
           AND cancelled_at IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
           ORDER BY id LIMIT 20`,
        )
        .bind(current.id, eventId)
        .all<{ id: string }>();
      for (const item of agendaItems.results) {
        try {
          await syncAgendaCalendarInvitations(context.env, {
            eventId,
            agendaItemId: item.id,
            actorUserId: access.user.id,
            correlationId: context.get("requestId"),
            action: "material_change",
          });
        } catch (error) {
          calendarFailures += 1;
          logOperationalEvent("error", {
            operation: "calendar_content_sync_failed",
            requestId: context.get("requestId"),
            eventId,
            entityType: "agenda_item",
            entityId: item.id,
            message: safeOperationalError(error),
          });
        }
      }
    }
    return context.json({
      session: { id: current.id, ...input },
      calendarFailures,
    });
  },
);

router.get(
  "/admin/events/:eventId/sessions/:submissionId/history",
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    const rows = await database(context.env)
      .prepare(
        `SELECT r.id,r.version_number AS versionNumber,r.title,r.abstract,
                r.created_at AS createdAt,u.name AS editorName,r.restored_from_id AS restoredFromId
         FROM content_revisions r JOIN users u ON u.id=r.created_by
         JOIN submissions s ON s.id=r.submission_id
         WHERE r.submission_id=? AND s.event_id=? ORDER BY r.version_number DESC`,
      )
      .bind(context.req.param("submissionId"), eventId)
      .all();
    return context.json({ revisions: rows.results });
  },
);

router.post(
  "/admin/events/:eventId/sessions/:submissionId/remix",
  zValidator("json", remixSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    if (!context.env.AI)
      throw new HttpError(
        503,
        "ai_unavailable",
        "Content suggestions are temporarily unavailable.",
      );
    const db = database(context.env);
    const recent = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_events
         WHERE event_id=? AND action='content.ai_suggested' AND created_at>=datetime('now','-1 day')`,
      )
      .bind(eventId)
      .first<{ count: number }>();
    if ((recent?.count ?? 0) >= 25)
      throw new HttpError(
        409,
        "ai_daily_limit",
        "This event has reached its free daily content-suggestion limit.",
      );
    const session = await db
      .prepare(
        "SELECT id,title,abstract FROM submissions WHERE id=? AND event_id=? AND status='accepted'",
      )
      .bind(context.req.param("submissionId"), eventId)
      .first<{ id: string; title: string; abstract: string }>();
    if (!session)
      throw new HttpError(404, "session_not_found", "Session not found.");
    const input = context.req.valid("json");
    const response = await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        messages: [
          {
            role: "system",
            content:
              "You are an event content editor. Return valid JSON only with title, abstract, and rationale strings. Preserve factual meaning and never invent claims.",
          },
          {
            role: "user",
            content: `Improve this accepted session for ${input.objective}. Keep the title under 300 characters and the abstract under 20,000 characters.\n\nTitle: ${session.title}\n\nAbstract: ${session.abstract}`,
          },
        ],
        max_tokens: 1000,
      },
    );
    const raw =
      typeof response === "string"
        ? response
        : "response" in response
          ? String(response.response)
          : JSON.stringify(response);
    let parsed: { title?: unknown; abstract?: unknown; rationale?: unknown };
    try {
      parsed = JSON.parse(
        raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
      );
    } catch {
      throw new HttpError(
        503,
        "ai_invalid_response",
        "The suggestion could not be reviewed safely. Try again.",
      );
    }
    const suggestion = {
      title: String(parsed.title ?? "")
        .trim()
        .slice(0, 300),
      abstract: String(parsed.abstract ?? "")
        .trim()
        .slice(0, 20_000),
      rationale: String(parsed.rationale ?? "")
        .trim()
        .slice(0, 2000),
    };
    if (!suggestion.title || !suggestion.abstract)
      throw new HttpError(
        503,
        "ai_invalid_response",
        "The suggestion was incomplete. Try again.",
      );
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "content.ai_suggested",
      entityType: "submission",
      entityId: session.id,
      after: { objective: input.objective, applied: false },
      requestId: context.get("requestId"),
    }).run();
    return context.json({ suggestion });
  },
);

router.post(
  "/admin/events/:eventId/sessions/:submissionId/history/:revisionId/restore",
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const submissionId = context.req.param("submissionId");
    const [current, revision, next] = await Promise.all([
      db
        .prepare(
          "SELECT title,abstract,answers_json AS answersJson FROM submissions WHERE id=? AND event_id=? AND status='accepted'",
        )
        .bind(submissionId, eventId)
        .first<Record<string, string>>(),
      db
        .prepare(
          "SELECT id,title,abstract,answers_json AS answersJson FROM content_revisions WHERE id=? AND submission_id=?",
        )
        .bind(context.req.param("revisionId"), submissionId)
        .first<Record<string, string>>(),
      db
        .prepare(
          "SELECT COALESCE(MAX(version_number),0)+1 AS versionNumber FROM content_revisions WHERE submission_id=?",
        )
        .bind(submissionId)
        .first<{ versionNumber: number }>(),
    ]);
    if (!current || !revision)
      throw new HttpError(404, "revision_not_found", "Revision not found.");
    await db.batch([
      db
        .prepare(
          `INSERT INTO content_revisions
           (id,submission_id,version_number,title,abstract,answers_json,created_by,restored_from_id)
           VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          submissionId,
          Number(next?.versionNumber ?? 1),
          current.title,
          current.abstract,
          current.answersJson,
          access.user.id,
          revision.id,
        ),
      db
        .prepare(
          "UPDATE submissions SET title=?,abstract=?,answers_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?",
        )
        .bind(
          revision.title,
          revision.abstract,
          revision.answersJson,
          submissionId,
          eventId,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "content.session_restored",
        entityType: "submission",
        entityId: submissionId,
        before: current,
        after: { revisionId: revision.id },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({
      session: { title: revision.title, abstract: revision.abstract },
    });
  },
);

router.patch(
  "/admin/events/:eventId/speakers/:speakerId",
  zValidator("json", speakerSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const result = await db
      .prepare(
        `UPDATE speaker_profiles SET first_name=?,last_name=?,job_title=?,company=?,bio=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND id IN (SELECT ss.speaker_id FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=?)`,
      )
      .bind(
        input.firstName,
        input.lastName,
        input.jobTitle ?? null,
        input.company ?? null,
        input.bio ?? null,
        context.req.param("speakerId"),
        eventId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(404, "speaker_not_found", "Speaker not found.");
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "content.speaker_updated",
      entityType: "speaker",
      entityId: context.req.param("speakerId"),
      after: input,
      requestId: context.get("requestId"),
    }).run();
    return context.json({
      speaker: { id: context.req.param("speakerId"), ...input },
    });
  },
);

router.post(
  "/admin/events/:eventId/speakers/:speakerId/headshot",
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    if (!context.env.FILES)
      throw new HttpError(
        503,
        "storage_unavailable",
        "File storage is unavailable.",
      );
    const form = await context.req.raw.formData();
    const upload = form.get("file");
    if (!(upload instanceof File))
      throw new HttpError(400, "file_required", "Choose a headshot.");
    if (upload.size <= 0 || upload.size > 5 * 1024 * 1024)
      throw new HttpError(
        400,
        "invalid_file_size",
        "Headshots must be 5 MB or smaller.",
      );
    if (!["image/png", "image/jpeg", "image/webp"].includes(upload.type))
      throw new HttpError(
        400,
        "invalid_file_type",
        "Upload a PNG, JPEG, or WebP image.",
      );
    const db = database(context.env);
    const speaker = await db
      .prepare(
        `SELECT sp.headshot_key AS headshotKey FROM speaker_profiles sp
       JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id
       WHERE sp.id=? AND s.event_id=? LIMIT 1`,
      )
      .bind(context.req.param("speakerId"), eventId)
      .first<{ headshotKey: string | null }>();
    if (!speaker)
      throw new HttpError(404, "speaker_not_found", "Speaker not found.");
    const extension =
      upload.type === "image/png"
        ? "png"
        : upload.type === "image/webp"
          ? "webp"
          : "jpg";
    const key = `${access.organizationId}/${eventId}/${context.req.param("speakerId")}/headshots/${crypto.randomUUID()}.${extension}`;
    await context.env.FILES.put(key, await upload.arrayBuffer(), {
      httpMetadata: { contentType: upload.type },
    });
    try {
      await db.batch([
        db
          .prepare(
            "UPDATE speaker_profiles SET headshot_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(key, context.req.param("speakerId")),
        auditStatement(db, {
          organizationId: access.organizationId,
          eventId,
          actorUserId: access.user.id,
          action: "content.speaker_headshot_updated",
          entityType: "speaker",
          entityId: context.req.param("speakerId"),
          after: { filename: upload.name, size: upload.size },
          requestId: context.get("requestId"),
        }),
      ]);
    } catch (error) {
      await context.env.FILES.delete(key);
      throw error;
    }
    if (speaker.headshotKey)
      await context.env.FILES.delete(speaker.headshotKey);
    return context.json(
      {
        headshotUrl: `/api/widgets/public/events/${eventId}/speakers/${context.req.param("speakerId")}/headshot`,
      },
      201,
    );
  },
);

router.post("/admin/events/:eventId/reminders", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const rows = await db
    .prepare(
      `SELECT sp.id AS speakerId,sp.email,sp.first_name||' '||sp.last_name AS speakerName,
            t.title,t.due_at AS dueAt,e.name AS eventName
     FROM speaker_task_assignments a JOIN onboarding_tasks t ON t.id=a.task_id
     JOIN speaker_profiles sp ON sp.id=a.speaker_id JOIN events e ON e.id=t.event_id
     WHERE t.event_id=? AND t.task_type='file_request' AND a.status NOT IN ('complete','submitted')
     ORDER BY sp.id,t.due_at,t.title LIMIT 500`,
    )
    .bind(eventId)
    .all<Record<string, string | null>>();
  const grouped = new Map<
    string,
    {
      email: string;
      name: string;
      eventName: string;
      outstanding: Array<{ title: string; dueAt: string | null }>;
    }
  >();
  for (const row of rows.results) {
    const key = String(row.speakerId);
    const group = grouped.get(key) ?? {
      email: String(row.email),
      name: String(row.speakerName),
      eventName: String(row.eventName),
      outstanding: [],
    };
    group.outstanding.push({ title: String(row.title), dueAt: row.dueAt });
    grouped.set(key, group);
  }
  const batchId = crypto.randomUUID();
  const deliveries = [];
  for (const [speakerId, group] of grouped) {
    const messageId = crypto.randomUUID();
    const outstanding = group.outstanding.map((item) =>
      item.dueAt
        ? `${item.title} — due ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(item.dueAt))}`
        : item.title,
    );
    const rendered = renderSimpleTransactionalEmail({
      recipientName: group.name,
      paragraphs: [
        `The ${group.eventName} program team is waiting on the following items:`,
        outstanding.join("\n"),
        "Open your speaker workspace to upload files or complete the related tasks.",
      ],
      actionLabel: "Open speaker workspace",
      actionUrl: `${context.env.APP_URL}/app/events/${eventId}/speaker`,
    });
    await db.batch([
      prepareCommunicationStatement(db, {
        id: messageId,
        organizationId: access.organizationId,
        eventId,
        category: "content_reminder",
        recipientEmail: group.email,
        recipientName: group.name,
        subject: `Outstanding program items for ${group.eventName}`,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
        entityType: "speaker",
        entityId: speakerId,
        metadata: { batchId, outstandingCount: outstanding.length },
        idempotencyKey: `content-reminder/${batchId}/${speakerId}`,
        preparedBy: access.user.id,
        correlationId: context.get("requestId"),
      }),
      domainEventStatement(db, {
        organizationId: access.organizationId,
        eventId,
        eventType: "communication.content_reminder_prepared",
        entityType: "speaker",
        entityId: speakerId,
        actorUserId: access.user.id,
        payload: { messageId, batchId, outstandingCount: outstanding.length },
        correlationId: context.get("requestId"),
      }),
    ]);
    try {
      const result = await enqueueCommunication(
        context.env,
        messageId,
        context.get("requestId"),
      );
      deliveries.push({
        speakerId,
        messageId,
        status: result.queued ? "queued" : "prepared",
      });
    } catch {
      deliveries.push({
        speakerId,
        messageId,
        status: "prepared",
      });
    }
  }
  await auditStatement(db, {
    organizationId: access.organizationId,
    eventId,
    actorUserId: access.user.id,
    action: "content.reminders_prepared",
    entityType: "event",
    entityId: eventId,
    after: { batchId, deliveries },
    requestId: context.get("requestId"),
  }).run();
  return context.json({
    batchId,
    attempted: deliveries.length,
    queued: deliveries.filter((item) => item.status === "queued").length,
    prepared: deliveries.filter((item) => item.status === "prepared").length,
    deliveries,
  });
});

router.post(
  "/admin/events/:eventId/exports",
  zValidator("json", exportSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    if (!context.env.FILES)
      throw new HttpError(
        503,
        "storage_unavailable",
        "File storage is unavailable.",
      );
    const input = context.req.valid("json");
    const db = database(context.env);
    const placeholders = input.fileIds.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT f.id,fv.r2_key AS r2Key,fv.filename,fv.size_bytes AS sizeBytes,
              s.title AS sessionTitle,sp.first_name||' '||sp.last_name AS speakerName
       FROM files f JOIN file_versions fv ON fv.id=f.current_version_id
       JOIN speaker_profiles sp ON sp.id=f.speaker_id LEFT JOIN submissions s ON s.id=f.submission_id
       WHERE f.event_id=? AND f.id IN (${placeholders})`,
      )
      .bind(eventId, ...input.fileIds)
      .all<{
        id: string;
        r2Key: string;
        filename: string;
        sizeBytes: number;
        sessionTitle: string | null;
        speakerName: string;
      }>();
    if (rows.results.length !== new Set(input.fileIds).size)
      throw new HttpError(
        400,
        "invalid_files",
        "Every selected file must be uploaded in this event.",
      );
    const total = rows.results.reduce(
      (sum, row) => sum + Number(row.sizeBytes),
      0,
    );
    if (total > 100 * 1024 * 1024)
      throw new HttpError(
        400,
        "export_too_large",
        "Select no more than 100 MB per export.",
      );
    const exportId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO content_exports(id,event_id,grouping,selected_file_ids_json,created_by) VALUES(?,?,?,?,?)",
      )
      .bind(
        exportId,
        eventId,
        input.grouping,
        JSON.stringify(input.fileIds),
        access.user.id,
      )
      .run();
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const row of rows.results) {
        const object = await context.env.FILES.get(row.r2Key);
        if (!object)
          throw new Error(`${row.filename} is missing from storage.`);
        const folder =
          input.grouping === "session"
            ? (row.sessionTitle ?? "Unassigned session")
            : input.grouping === "speaker"
              ? row.speakerName
              : "";
        const path = [folder, `${row.id.slice(0, 8)}-${row.filename}`]
          .filter(Boolean)
          .map(safePath)
          .join("/");
        entries[path] = new Uint8Array(await object.arrayBuffer());
      }
      const archive = zipSync(entries, { level: 0 });
      const key = `${access.organizationId}/${eventId}/exports/${exportId}.zip`;
      await context.env.FILES.put(key, archive, {
        httpMetadata: { contentType: "application/zip" },
      });
      await db
        .prepare(
          "UPDATE content_exports SET status='ready',r2_key=?,size_bytes=?,completed_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(key, archive.byteLength, exportId)
        .run();
      return context.json(
        {
          export: {
            id: exportId,
            status: "ready",
            grouping: input.grouping,
            fileCount: rows.results.length,
            sizeBytes: archive.byteLength,
            downloadUrl: `/api/content/admin/events/${eventId}/exports/${exportId}/download`,
          },
        },
        201,
      );
    } catch (error) {
      await db
        .prepare(
          "UPDATE content_exports SET status='failed',error=?,completed_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Export failed.",
          exportId,
        )
        .run();
      throw error;
    }
  },
);

router.get(
  "/admin/events/:eventId/exports/:exportId/download",
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    if (!context.env.FILES)
      throw new HttpError(
        503,
        "storage_unavailable",
        "File storage is unavailable.",
      );
    const row = await database(context.env)
      .prepare(
        "SELECT r2_key AS r2Key FROM content_exports WHERE id=? AND event_id=? AND status='ready'",
      )
      .bind(context.req.param("exportId"), eventId)
      .first<{ r2Key: string }>();
    if (!row)
      throw new HttpError(404, "export_not_found", "Ready export not found.");
    const object = await context.env.FILES.get(row.r2Key);
    if (!object)
      throw new HttpError(404, "export_not_found", "Export archive not found.");
    return new Response(object.body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="programloom-content-${eventId}.zip"`,
        "cache-control": "private, no-store",
      },
    });
  },
);

router.post("/admin/events/:eventId/files/:fileId/share", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const file = await db
    .prepare(
      "SELECT id FROM files WHERE id=? AND event_id=? AND current_version_id IS NOT NULL",
    )
    .bind(context.req.param("fileId"), eventId)
    .first();
  if (!file)
    throw new HttpError(404, "file_not_found", "Uploaded file not found.");
  const token = randomToken();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await db
    .prepare(
      "INSERT INTO file_share_links(id,file_id,token_hash,expires_at,created_by) VALUES(?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      context.req.param("fileId"),
      await sha256(token),
      expiresAt,
      access.user.id,
    )
    .run();
  return context.json(
    {
      shareUrl: `${context.env.APP_URL}/api/content/shared/files/${token}`,
      expiresAt,
    },
    201,
  );
});

router.get("/shared/files/:token", async (context) => {
  if (!context.env.FILES)
    throw new HttpError(
      503,
      "storage_unavailable",
      "File storage is unavailable.",
    );
  const row = await database(context.env)
    .prepare(
      `SELECT fv.r2_key AS r2Key,fv.filename,fv.content_type AS contentType
     FROM file_share_links l JOIN files f ON f.id=l.file_id JOIN file_versions fv ON fv.id=f.current_version_id
     WHERE l.token_hash=? AND l.revoked_at IS NULL AND l.expires_at>?`,
    )
    .bind(await sha256(context.req.param("token")), new Date().toISOString())
    .first<{ r2Key: string; filename: string; contentType: string }>();
  if (!row)
    throw new HttpError(
      404,
      "share_not_found",
      "This file link is invalid or expired.",
    );
  const object = await context.env.FILES.get(row.r2Key);
  if (!object)
    throw new HttpError(
      404,
      "file_not_found",
      "The shared file is unavailable.",
    );
  return new Response(object.body, {
    headers: {
      "content-type": row.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

function safePath(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._ -]+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 160) || "file"
  );
}

export default router;
