import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";
import { syncAgendaCalendarInvitations } from "../lib/calendarLifecycle";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "../lib/communications";
import { domainEventStatement } from "../lib/operations";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

const settingsSchema = z.object({
  deliveryRule: z.enum(["on_placement", "on_publication", "manual"]),
  organizerName: z.string().trim().min(1).max(160),
  organizerEmail: z.email().transform((value) => value.toLowerCase()),
  sendUpdatesAutomatically: z.boolean(),
});
const syncSchema = z.object({
  operation: z.enum(["create_or_update", "cancel", "reschedule"]),
  speakerId: z.string().uuid().optional(),
});

router.get("/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const [settings, records, revisions] = await Promise.all([
    db
      .prepare(
        `SELECT delivery_rule AS deliveryRule,organizer_name AS organizerName,
                organizer_email AS organizerEmail,
                send_updates_automatically AS sendUpdatesAutomatically,
                updated_at AS updatedAt
         FROM event_calendar_settings WHERE event_id=?`,
      )
      .bind(eventId)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT c.id,c.agenda_item_id AS agendaItemId,c.submission_id AS submissionId,
                c.speaker_id AS speakerId,c.attendee_email AS attendeeEmail,
                c.attendee_name AS attendeeName,c.uid,c.sequence,c.state,
                c.last_message_id AS lastMessageId,c.cancelled_at AS cancelledAt,
                c.created_at AS createdAt,c.updated_at AS updatedAt,a.title,
                a.starts_at AS startsAt,a.ends_at AS endsAt,r.name AS roomName,
                m.status AS deliveryStatus,m.provider_id AS providerId
         FROM calendar_records c JOIN agenda_items a ON a.id=c.agenda_item_id
         LEFT JOIN rooms r ON r.id=a.room_id
         LEFT JOIN communication_messages m ON m.id=c.last_message_id
         WHERE c.event_id=? ORDER BY c.updated_at DESC,c.id LIMIT 500`,
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        `SELECT r.id,r.calendar_record_id AS calendarRecordId,r.message_id AS messageId,
                r.sequence,r.method,r.reason,r.created_at AS createdAt,m.status AS deliveryStatus
         FROM calendar_revisions r JOIN calendar_records c ON c.id=r.calendar_record_id
         LEFT JOIN communication_messages m ON m.id=r.message_id
         WHERE c.event_id=? ORDER BY r.created_at DESC,r.id LIMIT 1000`,
      )
      .bind(eventId)
      .all(),
  ]);
  return context.json({
    settings: settings
      ? {
          ...settings,
          sendUpdatesAutomatically: Boolean(settings.sendUpdatesAutomatically),
        }
      : null,
    records: records.results,
    revisions: revisions.results,
  });
});

router.put(
  "/admin/events/:eventId/settings",
  zValidator("json", settingsSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const before = await db
      .prepare("SELECT * FROM event_calendar_settings WHERE event_id=?")
      .bind(eventId)
      .first();
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_calendar_settings
            (event_id,organization_id,delivery_rule,organizer_name,organizer_email,
             send_updates_automatically,created_by,updated_by)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(event_id) DO UPDATE SET delivery_rule=excluded.delivery_rule,
             organizer_name=excluded.organizer_name,organizer_email=excluded.organizer_email,
             send_updates_automatically=excluded.send_updates_automatically,
             updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          eventId,
          access.organizationId,
          input.deliveryRule,
          input.organizerName,
          input.organizerEmail,
          input.sendUpdatesAutomatically,
          access.user.id,
          access.user.id,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "calendar.settings_updated",
        entityType: "event",
        entityId: eventId,
        before,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ settings: input });
  },
);

router.post(
  "/admin/events/:eventId/items/:itemId/sync",
  zValidator("json", syncSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const sync = context.req.valid("json");
    const operation = sync.operation;
    const result = await syncAgendaCalendarInvitations(context.env, {
      eventId,
      agendaItemId: context.req.param("itemId"),
      actorUserId: access.user.id,
      correlationId: context.get("requestId"),
      action: operation === "cancel" ? "cancellation" : "manual",
      explicitReschedule: operation === "reschedule",
      speakerId: sync.speakerId,
    });
    return context.json({ result });
  },
);

router.post(
  "/admin/events/:eventId/records/:recordId/resend",
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const source = await db
      .prepare(
        `SELECT c.id,c.organization_id AS organizationId,c.last_message_id AS sourceMessageId,
                m.category,m.recipient_user_id AS recipientUserId,m.recipient_email AS recipientEmail,
                m.recipient_name AS recipientName,m.subject,m.body_html AS bodyHtml,
                m.body_text AS bodyText,m.attachment_manifest_json AS attachmentManifestJson
         FROM calendar_records c JOIN communication_messages m ON m.id=c.last_message_id
         WHERE c.id=? AND c.event_id=?`,
      )
      .bind(context.req.param("recordId"), eventId)
      .first<Record<string, string | null>>();
    if (!source)
      throw new HttpError(
        404,
        "calendar_record_not_found",
        "Calendar record not found.",
      );
    const messageId = crypto.randomUUID();
    await db.batch([
      prepareCommunicationStatement(db, {
        id: messageId,
        organizationId: access.organizationId,
        eventId,
        category: source.category as
          "calendar_invitation" | "calendar_update" | "calendar_cancellation",
        recipientUserId: source.recipientUserId ?? undefined,
        recipientEmail: String(source.recipientEmail),
        recipientName: source.recipientName ?? undefined,
        subject: String(source.subject),
        bodyHtml: String(source.bodyHtml),
        bodyText: String(source.bodyText),
        entityType: "calendar_record",
        entityId: String(source.id),
        attachmentManifest: JSON.parse(String(source.attachmentManifestJson)),
        metadata: { explicitResendOf: source.sourceMessageId },
        idempotencyKey: `calendar-resend/${source.id}/${messageId}`,
        preparedBy: access.user.id,
        correlationId: context.get("requestId"),
      }),
      domainEventStatement(db, {
        organizationId: access.organizationId,
        eventId,
        eventType: "calendar.resend_prepared",
        entityType: "calendar_record",
        entityId: String(source.id),
        actorUserId: access.user.id,
        payload: { messageId, sourceMessageId: source.sourceMessageId },
        correlationId: context.get("requestId"),
      }),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "calendar.resent",
        entityType: "calendar_record",
        entityId: String(source.id),
        after: { messageId, sourceMessageId: source.sourceMessageId },
        requestId: context.get("requestId"),
      }),
    ]);
    let status = "prepared";
    try {
      if (
        (
          await enqueueCommunication(
            context.env,
            messageId,
            context.get("requestId"),
          )
        ).queued
      )
        status = "queued";
    } catch {
      // Durable outbox remains available for retry.
    }
    return context.json({ messageId, status });
  },
);

router.get(
  "/admin/events/:eventId/revisions/:revisionId/ics",
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    if (!context.env.FILES)
      throw new HttpError(
        503,
        "storage_unavailable",
        "Calendar storage is unavailable.",
      );
    const revision = await database(context.env)
      .prepare(
        `SELECT r.ics_r2_key AS r2Key,a.title,r.method
         FROM calendar_revisions r JOIN calendar_records c ON c.id=r.calendar_record_id
         JOIN agenda_items a ON a.id=c.agenda_item_id
         WHERE r.id=? AND c.event_id=?`,
      )
      .bind(context.req.param("revisionId"), eventId)
      .first<{ r2Key: string; title: string; method: string }>();
    if (!revision)
      throw new HttpError(
        404,
        "calendar_revision_not_found",
        "Calendar revision not found.",
      );
    const object = await context.env.FILES.get(revision.r2Key);
    if (!object)
      throw new HttpError(
        404,
        "calendar_file_not_found",
        "Calendar file not found.",
      );
    return new Response(object.body, {
      headers: {
        "content-type": `text/calendar; method=${revision.method}; charset=UTF-8`,
        "content-disposition": `attachment; filename="programloom-calendar-${context.req.param("revisionId")}.ics"`,
        "cache-control": "private, no-store",
      },
    });
  },
);

export default router;
