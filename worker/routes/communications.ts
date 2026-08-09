import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";
import {
  defaultCommunicationTemplates,
  supportedCommunicationMergeFields,
} from "../lib/communicationTemplates";
import {
  enqueueCommunication,
  syncCrmCommunicationState,
} from "../lib/communications";
import { randomToken, sha256 } from "../lib/crypto";
import {
  communicationCategories,
  domainEventStatement,
  extractMergeFields,
  logOperationalEvent,
  notificationStatement,
  renderMergeFields,
  validateMergeFields,
  type CommunicationCategory,
} from "../lib/operations";
import { verifyResendWebhook } from "../lib/resendWebhook";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;
const categorySchema = z.enum(communicationCategories);
const messageStatuses = [
  "prepared",
  "queued",
  "processing",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "cancelled",
] as const;

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  category: categorySchema,
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(1).max(300),
  bodyHtml: z.string().trim().min(1).max(100_000),
  bodyText: z.string().trim().min(1).max(50_000),
  enabled: z.boolean().default(true),
});
const previewSchema = z.object({
  templateId: z.string().uuid().optional(),
  category: categorySchema,
  subject: z.string().max(300).optional(),
  bodyHtml: z.string().max(100_000).optional(),
  bodyText: z.string().max(50_000).optional(),
  recipientKey: z.string().min(3).max(500),
  organizerMessage: z.string().trim().max(20_000).optional(),
});
const prepareSchema = z.object({
  templateId: z.string().uuid(),
  recipientKeys: z.array(z.string().min(3).max(500)).min(1).max(200),
  confirmedRecipientCount: z.number().int().min(1).max(200),
  organizerMessage: z.string().trim().max(20_000).optional(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
  sendNow: z.boolean().default(false),
  operationKey: z.string().trim().min(8).max(160),
});

type EventRecord = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};
type Recipient = {
  key: string;
  email: string;
  name: string;
  entityType: string;
  entityId: string;
  context: string;
  data: Record<string, string | number | boolean | null | undefined>;
};

router.post("/resend/webhook", async (context) => {
  if (!context.env.RESEND_WEBHOOK_SECRET)
    throw new HttpError(404, "webhook_not_found", "Webhook not found.");
  const body = await context.req.text();
  const webhookId = context.req.header("svix-id") ?? "";
  const valid = await verifyResendWebhook(
    context.env.RESEND_WEBHOOK_SECRET,
    {
      id: webhookId,
      timestamp: context.req.header("svix-timestamp") ?? "",
      signature: context.req.header("svix-signature") ?? "",
    },
    body,
  );
  if (!valid)
    throw new HttpError(
      403,
      "invalid_webhook_signature",
      "Invalid webhook signature.",
    );
  const input = JSON.parse(body) as {
    type?: string;
    created_at?: string;
    data?: { email_id?: string };
  };
  if (!input.type || !input.data?.email_id)
    return context.json({ accepted: true, matched: false });
  const db = database(context.env);
  const duplicate = await db
    .prepare(
      "SELECT id FROM communication_delivery_events WHERE provider_event_id=?",
    )
    .bind(webhookId)
    .first();
  if (duplicate)
    return context.json({ accepted: true, matched: true, duplicate: true });
  const message = await db
    .prepare(
      `SELECT id,organization_id AS organizationId,event_id AS eventId,status,
              correlation_id AS correlationId
       FROM communication_messages WHERE provider_id=?`,
    )
    .bind(input.data.email_id)
    .first<{
      id: string;
      organizationId: string;
      eventId: string;
      status: string;
      correlationId: string;
    }>();
  if (!message) return context.json({ accepted: true, matched: false });

  const status = providerStatus(input.type);
  const owners =
    status && ["bounced", "failed"].includes(status)
      ? await db
          .prepare(
            `SELECT user_id AS userId FROM organization_members
           WHERE organization_id=? AND role IN ('owner','admin') LIMIT 50`,
          )
          .bind(message.organizationId)
          .all<{ userId: string }>()
      : { results: [] as Array<{ userId: string }> };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO communication_delivery_events
          (id,message_id,provider_event_id,provider_event_type,provider_created_at,payload_hash)
         VALUES(?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        message.id,
        webhookId,
        input.type,
        input.created_at ?? null,
        await sha256(body),
      ),
  ];
  if (status) {
    const timestampColumn =
      status === "delivered"
        ? "delivered_at"
        : status === "bounced"
          ? "bounced_at"
          : status === "failed"
            ? "failed_at"
            : "sent_at";
    statements.push(
      db
        .prepare(
          `UPDATE communication_messages SET status=?,provider_event_id=?,
             ${timestampColumn}=COALESCE(${timestampColumn},CURRENT_TIMESTAMP),
             updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='cancelled'`,
        )
        .bind(status, webhookId, message.id),
      db
        .prepare(
          `UPDATE communication_attempts SET status=?,finished_at=COALESCE(finished_at,CURRENT_TIMESTAMP)
           WHERE message_id=? AND attempt_number=(SELECT MAX(attempt_number) FROM communication_attempts WHERE message_id=?)`,
        )
        .bind(status === "sent" ? "accepted" : status, message.id, message.id),
      db
        .prepare(
          `INSERT INTO audit_events
            (id,organization_id,event_id,action,entity_type,entity_id,before_json,after_json,request_id,correlation_id)
           VALUES(?,?,?,'communication.provider_status','communication',?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          message.organizationId,
          message.eventId,
          message.id,
          JSON.stringify({ status: message.status }),
          JSON.stringify({ status, providerEventType: input.type }),
          webhookId,
          message.correlationId,
        ),
    );
    if (["bounced", "failed"].includes(status))
      statements.push(
        ...owners.results.map((owner) =>
          notificationStatement(db, {
            organizationId: message.organizationId,
            eventId: message.eventId,
            recipientUserId: owner.userId,
            category: "delivery",
            notificationType: "communication.delivery_failed",
            severity: "blocking",
            title: "A program communication needs attention",
            body: "Resend reported a failed or bounced delivery. Review the event outbox before retrying.",
            actionUrl: `/app/events/${message.eventId}/communications?status=${status}`,
            entityType: "communication",
            entityId: message.id,
            coalesceKey: `delivery:${message.id}`,
          }),
        ),
      );
  }
  await db.batch(statements);
  if (status)
    await syncCrmCommunicationState(
      db,
      message.id,
      status,
      input.data.email_id,
      ["bounced", "failed"].includes(status)
        ? "Provider reported delivery failure."
        : undefined,
    );
  logOperationalEvent(
    status && ["bounced", "failed"].includes(status) ? "error" : "info",
    {
      operation: "communication_provider_event",
      correlationId: message.correlationId,
      eventId: message.eventId,
      messageId: message.id,
      providerId: input.data.email_id,
      errorCode:
        status && ["bounced", "failed"].includes(status)
          ? input.type
          : undefined,
    },
  );
  return context.json({ accepted: true, matched: true });
});

router.get("/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(
    context,
    eventId,
    organizerRoles.slice(),
  );
  const db = database(context.env);
  const event = await getEvent(db, eventId);
  await ensureDefaultTemplates(db, event, access.user.id);

  const category = categorySchema.safeParse(context.req.query("category"));
  const status = z.enum(messageStatuses).safeParse(context.req.query("status"));
  const search = (context.req.query("search") ?? "").trim().slice(0, 160);
  const speakerId = z.string().uuid().safeParse(context.req.query("speaker"));
  const page = Math.max(1, Number(context.req.query("page") ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Number(context.req.query("pageSize") ?? 50) || 50),
  );
  const conditions = ["event_id=?"];
  const bindings: unknown[] = [eventId];
  if (category.success) {
    conditions.push("category=?");
    bindings.push(category.data);
  }
  if (status.success) {
    conditions.push("status=?");
    bindings.push(status.data);
  }
  if (search) {
    conditions.push(
      "(recipient_email LIKE ? OR recipient_name LIKE ? OR subject LIKE ?)",
    );
    bindings.push(
      ...Array(3).fill(
        `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
      ),
    );
  }
  if (speakerId.success) {
    const speaker = await db
      .prepare(
        `SELECT sp.email FROM speaker_profiles sp
         JOIN (SELECT speaker_id FROM event_speakers WHERE event_id=?
               UNION SELECT ss.speaker_id FROM session_speakers ss
                 JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=?) roster
           ON roster.speaker_id=sp.id
         WHERE sp.id=? LIMIT 1`,
      )
      .bind(eventId, eventId, speakerId.data)
      .first<{ email: string }>();
    if (!speaker)
      throw new HttpError(404, "speaker_not_found", "Speaker not found.");
    conditions.push("recipient_email=? COLLATE NOCASE");
    bindings.push(speaker.email);
  }

  const [templates, stats, total, messages] = await Promise.all([
    db
      .prepare(
        `SELECT id,category,name,subject,body_html AS bodyHtml,body_text AS bodyText,
                merge_fields_json AS mergeFieldsJson,enabled,version,updated_at AS updatedAt
         FROM communication_templates WHERE event_id=? ORDER BY category,name`,
      )
      .bind(eventId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT status,COUNT(*) AS count FROM communication_messages
         WHERE event_id=? GROUP BY status`,
      )
      .bind(eventId)
      .all<{ status: string; count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM communication_messages WHERE ${conditions.join(" AND ")}`,
      )
      .bind(...bindings)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT id,category,recipient_email AS recipientEmail,recipient_name AS recipientName,
                subject,status,provider_id AS providerId,attempts,scheduled_for AS scheduledFor,
                sent_at AS sentAt,delivered_at AS deliveredAt,bounced_at AS bouncedAt,
                failed_at AS failedAt,last_error_code AS lastErrorCode,last_error AS lastError,
                entity_type AS entityType,entity_id AS entityId,correlation_id AS correlationId,
                created_at AS createdAt,updated_at AS updatedAt
         FROM communication_messages WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, pageSize, (page - 1) * pageSize)
      .all<Record<string, unknown>>(),
  ]);

  return context.json({
    event,
    scope: speakerId.success ? { speakerId: speakerId.data } : null,
    supportedMergeFields: supportedCommunicationMergeFields,
    templates: templates.results.map((template) => ({
      ...template,
      enabled: Boolean(template.enabled),
      mergeFields: JSON.parse(String(template.mergeFieldsJson)),
      mergeFieldsJson: undefined,
    })),
    stats: Object.fromEntries(
      messageStatuses.map((item) => [
        item,
        stats.results.find((row) => row.status === item)?.count ?? 0,
      ]),
    ),
    messages: messages.results,
    pagination: { page, pageSize, total: total?.count ?? 0 },
  });
});

router.get("/events/:eventId/recipients", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, organizerRoles.slice());
  const parsed = categorySchema.safeParse(context.req.query("category"));
  if (!parsed.success)
    throw new HttpError(
      409,
      "category_required",
      "Choose a communication category.",
    );
  const db = database(context.env);
  const event = await getEvent(db, eventId);
  const recipients = await resolveRecipients(db, event, parsed.data);
  return context.json({
    recipients: recipients.map(({ data: _data, ...recipient }) => recipient),
    count: recipients.length,
    truncated: recipients.length === 200,
  });
});

router.put(
  "/events/:eventId/templates",
  zValidator("json", templateSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(
      context,
      eventId,
      organizerRoles.slice(),
    );
    const db = database(context.env);
    const event = await getEvent(db, eventId);
    const input = context.req.valid("json");
    const unsupported = validateMergeFields(
      [input.subject, input.bodyHtml, input.bodyText],
      supportedCommunicationMergeFields,
    );
    if (unsupported.length)
      throw new HttpError(
        409,
        "unsupported_merge_fields",
        `Unsupported merge fields: ${unsupported.join(", ")}.`,
      );
    const bodyHtml = sanitizeEmailHtml(input.bodyHtml);
    const mergeFields = extractMergeFields(
      input.subject,
      bodyHtml,
      input.bodyText,
    );
    const current = input.id
      ? await db
          .prepare(
            "SELECT id,category,name,subject,body_html AS bodyHtml,body_text AS bodyText,enabled,version FROM communication_templates WHERE id=? AND event_id=?",
          )
          .bind(input.id, eventId)
          .first<Record<string, unknown>>()
      : null;
    const id = current ? String(current.id) : crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO communication_templates
            (id,organization_id,event_id,category,name,subject,body_html,body_text,merge_fields_json,enabled,created_by,updated_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET category=excluded.category,name=excluded.name,
             subject=excluded.subject,body_html=excluded.body_html,body_text=excluded.body_text,
             merge_fields_json=excluded.merge_fields_json,enabled=excluded.enabled,
             version=communication_templates.version+1,updated_by=excluded.updated_by,
             updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          id,
          event.organizationId,
          eventId,
          input.category,
          input.name,
          input.subject,
          bodyHtml,
          input.bodyText,
          JSON.stringify(mergeFields),
          input.enabled ? 1 : 0,
          access.user.id,
          access.user.id,
        ),
      auditStatement(db, {
        organizationId: event.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: current
          ? "communication_template.updated"
          : "communication_template.created",
        entityType: "communication_template",
        entityId: id,
        before: current ?? undefined,
        after: {
          ...input,
          bodyHtml: "[template body updated]",
          bodyText: "[template body updated]",
          mergeFields,
        },
        requestId: context.get("requestId"),
      }),
      domainEventStatement(db, {
        organizationId: event.organizationId,
        eventId,
        eventType: "communication_template.changed",
        entityType: "communication_template",
        entityId: id,
        actorUserId: access.user.id,
        payload: {
          category: input.category,
          version: Number(current?.version ?? 0) + 1,
        },
        correlationId: context.get("requestId"),
      }),
    ]);
    return context.json(
      { template: { id, ...input, bodyHtml, mergeFields } },
      current ? 200 : 201,
    );
  },
);

router.post(
  "/events/:eventId/preview",
  zValidator("json", previewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, organizerRoles.slice());
    const db = database(context.env);
    const event = await getEvent(db, eventId);
    const input = context.req.valid("json");
    const template = await resolveTemplate(db, eventId, input);
    const recipient = await resolveRecipient(
      db,
      event,
      input.category,
      input.recipientKey,
    );
    const rendered = renderTemplate(
      template,
      recipient,
      input.organizerMessage,
    );
    return context.json({
      recipient: publicRecipient(recipient),
      preview: rendered,
    });
  },
);

router.post(
  "/events/:eventId/test-send",
  zValidator("json", previewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(
      context,
      eventId,
      organizerRoles.slice(),
    );
    const db = database(context.env);
    const event = await getEvent(db, eventId);
    const input = context.req.valid("json");
    const template = await resolveTemplate(db, eventId, input);
    const sourceRecipient = await resolveRecipient(
      db,
      event,
      input.category,
      input.recipientKey,
    );
    const rendered = renderTemplate(
      template,
      sourceRecipient,
      input.organizerMessage,
    );
    const messageId = crypto.randomUUID();
    const correlationId = context.get("requestId");
    await db.batch([
      communicationInsert(db, {
        id: messageId,
        event,
        templateId: template.id,
        category: input.category,
        recipientEmail: access.user.email,
        recipientName: access.user.name,
        entityType: sourceRecipient.entityType,
        entityId: sourceRecipient.entityId,
        subject: `[Test] ${rendered.subject}`,
        bodyHtml: rendered.bodyHtml,
        bodyText: rendered.bodyText,
        idempotencyKey: `test/${access.user.id}/${messageId}`,
        preparedBy: access.user.id,
        correlationId,
      }),
      auditStatement(db, {
        organizationId: event.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "communication.test_prepared",
        entityType: "communication",
        entityId: messageId,
        after: {
          category: input.category,
          sourceEntityId: sourceRecipient.entityId,
        },
        requestId: correlationId,
      }),
    ]);
    const queued = await enqueueCommunication(
      context.env,
      messageId,
      correlationId,
    );
    return context.json(
      { messageId, recipientEmail: access.user.email, queued },
      202,
    );
  },
);

router.post(
  "/events/:eventId/messages",
  zValidator("json", prepareSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(
      context,
      eventId,
      organizerRoles.slice(),
    );
    const db = database(context.env);
    const event = await getEvent(db, eventId);
    const input = context.req.valid("json");
    const uniqueKeys = [...new Set(input.recipientKeys)];
    if (uniqueKeys.length !== input.confirmedRecipientCount)
      throw new HttpError(
        409,
        "recipient_confirmation_mismatch",
        "The confirmed recipient count no longer matches the selection.",
      );
    if (input.scheduledFor && input.scheduledFor <= new Date().toISOString())
      throw new HttpError(
        409,
        "schedule_in_past",
        "Choose a future send time.",
      );
    const template = await db
      .prepare(
        `SELECT id,category,subject,body_html AS bodyHtml,body_text AS bodyText
         FROM communication_templates WHERE id=? AND event_id=? AND enabled=1`,
      )
      .bind(input.templateId, eventId)
      .first<{
        id: string;
        category: CommunicationCategory;
        subject: string;
        bodyHtml: string;
        bodyText: string;
      }>();
    if (!template)
      throw new HttpError(
        404,
        "template_not_found",
        "Communication template not found.",
      );
    const idempotencyKeys = uniqueKeys.map(
      (key) => `${input.operationKey}/${key}`,
    );
    const existingMessages = await db
      .prepare(
        `SELECT id,idempotency_key AS idempotencyKey,status
         FROM communication_messages WHERE event_id=? AND idempotency_key IN
         (${idempotencyKeys.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...idempotencyKeys)
      .all<{ id: string; idempotencyKey: string; status: string }>();
    if (existingMessages.results.length) {
      if (existingMessages.results.length !== idempotencyKeys.length)
        throw new HttpError(
          409,
          "partial_idempotent_batch",
          "Part of this operation already exists. Review the outbox before trying again.",
        );
      return context.json({
        messageIds: existingMessages.results.map((message) => message.id),
        count: existingMessages.results.length,
        status: "already_prepared",
        duplicate: true,
      });
    }
    const available = await resolveRecipients(db, event, template.category);
    const byKey = new Map(
      available.map((recipient) => [recipient.key, recipient]),
    );
    const recipients = uniqueKeys
      .map((key) => byKey.get(key))
      .filter((item): item is Recipient => Boolean(item));
    if (recipients.length !== uniqueKeys.length)
      throw new HttpError(
        409,
        "recipient_changed",
        "One or more recipients are no longer eligible.",
      );
    const correlationId = context.get("requestId");
    const messages = await Promise.all(
      recipients.map(async (recipient) => {
        const id = crypto.randomUUID();
        const sensitive = await materializeRecipientForDelivery(
          db,
          event,
          template.category,
          recipient,
          id,
          access.user.id,
          context.env.APP_URL,
          correlationId,
        );
        const rendered = renderTemplate(
          template,
          sensitive.recipient,
          input.organizerMessage,
        );
        return {
          id,
          recipient,
          rendered,
          lifecycleStatements: sensitive.statements,
          sensitiveExpiresAt: sensitive.expiresAt,
        };
      }),
    );
    await db.batch([
      ...messages.map(({ id, recipient, rendered, sensitiveExpiresAt }) =>
        communicationInsert(db, {
          id,
          event,
          templateId: template.id,
          category: template.category,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          entityType: recipient.entityType,
          entityId: recipient.entityId,
          subject: rendered.subject,
          bodyHtml: rendered.bodyHtml,
          bodyText: rendered.bodyText,
          sensitiveExpiresAt,
          idempotencyKey: `${input.operationKey}/${recipient.key}`,
          preparedBy: access.user.id,
          correlationId,
          scheduledFor: input.scheduledFor,
        }),
      ),
      ...messages.flatMap((message) => message.lifecycleStatements),
      auditStatement(db, {
        organizationId: event.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "communication.bulk_prepared",
        entityType: "communication_batch",
        entityId: input.operationKey,
        after: {
          category: template.category,
          recipientCount: messages.length,
          scheduledFor: input.scheduledFor ?? null,
          sendNow: input.sendNow,
        },
        requestId: correlationId,
      }),
      domainEventStatement(db, {
        organizationId: event.organizationId,
        eventId,
        eventType: "communication.batch_prepared",
        entityType: "communication_batch",
        entityId: input.operationKey,
        actorUserId: access.user.id,
        payload: {
          category: template.category,
          recipientCount: messages.length,
        },
        correlationId,
      }),
    ]);
    if (input.sendNow)
      for (const message of messages)
        await enqueueCommunication(context.env, message.id, correlationId);
    return context.json(
      {
        messageIds: messages.map((message) => message.id),
        count: messages.length,
        status: input.sendNow
          ? "queued"
          : input.scheduledFor
            ? "scheduled"
            : "prepared",
      },
      201,
    );
  },
);

router.get("/events/:eventId/messages/:messageId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, organizerRoles.slice());
  const db = database(context.env);
  const messageId = context.req.param("messageId");
  const [message, attempts, events] = await Promise.all([
    db
      .prepare(
        `SELECT id,category,recipient_email AS recipientEmail,recipient_name AS recipientName,subject,body_html AS bodyHtml,body_text AS bodyText,status,provider_id AS providerId,attempts,max_attempts AS maxAttempts,scheduled_for AS scheduledFor,queued_at AS queuedAt,processing_at AS processingAt,sent_at AS sentAt,delivered_at AS deliveredAt,bounced_at AS bouncedAt,failed_at AS failedAt,cancelled_at AS cancelledAt,last_error_code AS lastErrorCode,last_error AS lastError,entity_type AS entityType,entity_id AS entityId,correlation_id AS correlationId,created_at AS createdAt,updated_at AS updatedAt FROM communication_messages WHERE id=? AND event_id=?`,
      )
      .bind(messageId, eventId)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id,attempt_number AS attemptNumber,provider,provider_id AS providerId,status,error_code AS errorCode,error_message AS errorMessage,request_id AS requestId,job_id AS jobId,started_at AS startedAt,finished_at AS finishedAt FROM communication_attempts WHERE message_id=? ORDER BY attempt_number DESC`,
      )
      .bind(messageId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT provider_event_id AS providerEventId,provider_event_type AS providerEventType,provider_created_at AS providerCreatedAt,received_at AS receivedAt FROM communication_delivery_events WHERE message_id=? ORDER BY received_at DESC`,
      )
      .bind(messageId)
      .all<Record<string, unknown>>(),
  ]);
  if (!message)
    throw new HttpError(404, "message_not_found", "Communication not found.");
  return context.json({
    message,
    attempts: attempts.results,
    deliveryEvents: events.results,
  });
});

router.post("/events/:eventId/messages/:messageId/retry", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(
    context,
    eventId,
    organizerRoles.slice(),
  );
  const db = database(context.env);
  const messageId = context.req.param("messageId");
  const message = await db
    .prepare(
      "SELECT organization_id AS organizationId,status,attempts,max_attempts AS maxAttempts FROM communication_messages WHERE id=? AND event_id=?",
    )
    .bind(messageId, eventId)
    .first<{
      organizationId: string;
      status: string;
      attempts: number;
      maxAttempts: number;
    }>();
  if (!message)
    throw new HttpError(404, "message_not_found", "Communication not found.");
  if (message.status !== "failed" || message.attempts >= message.maxAttempts)
    throw new HttpError(
      409,
      "message_not_retryable",
      "This communication cannot be retried safely.",
    );
  const queued = await enqueueCommunication(
    context.env,
    messageId,
    context.get("requestId"),
  );
  await auditStatement(db, {
    organizationId: message.organizationId,
    eventId,
    actorUserId: access.user.id,
    action: "communication.retry_requested",
    entityType: "communication",
    entityId: messageId,
    after: { attempt: message.attempts + 1 },
    requestId: context.get("requestId"),
  }).run();
  return context.json({ queued }, 202);
});

router.post("/events/:eventId/messages/:messageId/cancel", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(
    context,
    eventId,
    organizerRoles.slice(),
  );
  const db = database(context.env);
  const messageId = context.req.param("messageId");
  const message = await db
    .prepare(
      "SELECT organization_id AS organizationId,status FROM communication_messages WHERE id=? AND event_id=?",
    )
    .bind(messageId, eventId)
    .first<{ organizationId: string; status: string }>();
  if (!message)
    throw new HttpError(404, "message_not_found", "Communication not found.");
  if (!["prepared", "queued", "failed"].includes(message.status))
    throw new HttpError(
      409,
      "message_not_cancellable",
      "This communication has already been processed.",
    );
  await db.batch([
    db
      .prepare(
        "UPDATE communication_messages SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(messageId),
    auditStatement(db, {
      organizationId: message.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "communication.cancelled",
      entityType: "communication",
      entityId: messageId,
      before: { status: message.status },
      after: { status: "cancelled" },
      requestId: context.get("requestId"),
    }),
  ]);
  return context.json({ ok: true });
});

async function getEvent(db: D1Database, eventId: string) {
  const event = await db
    .prepare(
      `SELECT e.id,e.organization_id AS organizationId,o.name AS organizationName,e.name,e.slug,e.starts_at AS startsAt,e.ends_at AS endsAt,e.timezone FROM events e JOIN organizations o ON o.id=e.organization_id WHERE e.id=?`,
    )
    .bind(eventId)
    .first<EventRecord>();
  if (!event) throw new HttpError(404, "event_not_found", "Event not found.");
  return event;
}

async function ensureDefaultTemplates(
  db: D1Database,
  event: EventRecord,
  userId: string,
) {
  await db.batch(
    defaultCommunicationTemplates.map((template) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO communication_templates (id,organization_id,event_id,category,name,subject,body_html,body_text,merge_fields_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          event.organizationId,
          event.id,
          template.category,
          template.name,
          template.subject,
          template.bodyHtml,
          template.bodyText,
          JSON.stringify(
            extractMergeFields(
              template.subject,
              template.bodyHtml,
              template.bodyText,
            ),
          ),
          userId,
          userId,
        ),
    ),
  );
}

async function resolveTemplate(
  db: D1Database,
  eventId: string,
  input: z.infer<typeof previewSchema>,
) {
  if (input.templateId) {
    const template = await db
      .prepare(
        `SELECT id,category,subject,body_html AS bodyHtml,body_text AS bodyText FROM communication_templates WHERE id=? AND event_id=? AND enabled=1`,
      )
      .bind(input.templateId, eventId)
      .first<{
        id: string;
        category: CommunicationCategory;
        subject: string;
        bodyHtml: string;
        bodyText: string;
      }>();
    if (!template)
      throw new HttpError(
        404,
        "template_not_found",
        "Communication template not found.",
      );
    return {
      ...template,
      subject: input.subject ?? template.subject,
      bodyHtml: input.bodyHtml
        ? sanitizeEmailHtml(input.bodyHtml)
        : template.bodyHtml,
      bodyText: input.bodyText ?? template.bodyText,
    };
  }
  if (!input.subject || !input.bodyHtml || !input.bodyText)
    throw new HttpError(
      409,
      "template_content_required",
      "Provide a saved template or complete subject and body content.",
    );
  return {
    id: null,
    category: input.category,
    subject: input.subject,
    bodyHtml: sanitizeEmailHtml(input.bodyHtml),
    bodyText: input.bodyText,
  };
}

async function resolveRecipient(
  db: D1Database,
  event: EventRecord,
  category: CommunicationCategory,
  key: string,
) {
  const recipients = await resolveRecipients(db, event, category);
  const recipient = recipients.find((item) => item.key === key);
  if (!recipient)
    throw new HttpError(
      404,
      "recipient_not_found",
      "Recipient is no longer eligible for this communication.",
    );
  return recipient;
}

async function resolveRecipients(
  db: D1Database,
  event: EventRecord,
  category: CommunicationCategory,
): Promise<Recipient[]> {
  const base = {
    "organization.name": event.organizationName,
    "event.name": event.name,
    "event.starts_at": event.startsAt,
    "event.ends_at": event.endsAt,
    "event.timezone": event.timezone,
    "event.public_url": `https://app.programloom.com/cfp`,
  };
  if (
    [
      "submission_confirmation",
      "draft_reminder",
      "deadline_reminder",
      "decision_acceptance",
      "decision_waitlist",
      "decision_rejection",
    ].includes(category)
  ) {
    const rows = await db
      .prepare(
        `SELECT s.id,s.title,s.status,s.decision_state AS decisionState,
                p.email,p.name,p.organization AS submitterOrganization,
                f.closes_at AS closesAt,
                f.edit_closes_at AS editClosesAt,f.slug AS formSlug,
                e.slug AS eventSlug,o.slug AS organizationSlug
         FROM submissions s JOIN submission_people p ON p.submission_id=s.id AND p.role='primary'
         JOIN cfp_forms f ON f.id=s.form_id JOIN events e ON e.id=s.event_id
         JOIN organizations o ON o.id=e.organization_id
         WHERE s.event_id=? ORDER BY p.name,s.title LIMIT 200`,
      )
      .bind(event.id)
      .all<{
        id: string;
        title: string;
        status: string;
        decisionState: string;
        email: string;
        name: string;
        closesAt: string | null;
        editClosesAt: string | null;
        formSlug: string;
        eventSlug: string;
        organizationSlug: string;
        submitterOrganization: string | null;
      }>();
    const eligible = rows.results.filter((row) => {
      if (category === "submission_confirmation")
        return row.status === "pending";
      if (["draft_reminder", "deadline_reminder"].includes(category))
        return row.status === "draft";
      if (category === "decision_acceptance")
        return row.decisionState === "acceptance_staged";
      if (category === "decision_waitlist")
        return row.decisionState === "waitlist_staged";
      if (category === "decision_rejection")
        return row.decisionState === "rejection_staged";
      return false;
    });
    return eligible.map((row) => ({
      key: `submission:${row.id}:${row.email.toLowerCase()}`,
      email: row.email,
      name: row.name,
      entityType: "submission",
      entityId: row.id,
      context: row.title,
      data: {
        ...base,
        "recipient.name": row.name,
        "recipient.email": row.email,
        "submission.title": row.title,
        "submission.status": row.status,
        "event.cfp_closes_at": row.closesAt,
        "submission.edit_link":
          "[secure edit link generated for each live recipient]",
        "internal.edit_expires_at": row.editClosesAt,
        "internal.public_path": `/c/${row.organizationSlug}/${row.eventSlug}/${row.formSlug}`,
        "internal.submitter_organization": row.submitterOrganization,
        "speaker.portal_link": `https://app.programloom.com/app/events/${event.id}/speaker`,
      },
    }));
  }
  if (["reviewer_invitation", "reviewer_reminder"].includes(category)) {
    const rows = await db
      .prepare(
        `SELECT u.id,u.email,u.name,COUNT(DISTINCT ra.id) AS assigned,COUNT(DISTINCT CASE WHEN ra.id IS NOT NULL AND ra.completed_at IS NULL THEN ra.id END) AS incomplete,MIN(CASE WHEN ra.id IS NOT NULL THEN rr.closes_at END) AS dueAt,GROUP_CONCAT(DISTINCT CASE WHEN ra.id IS NOT NULL THEN rr.name END) AS rounds FROM users u JOIN event_members em ON em.user_id=u.id AND em.event_id=? AND em.role='reviewer' LEFT JOIN review_rounds rr ON rr.event_id=? LEFT JOIN review_assignments ra ON ra.round_id=rr.id AND ra.reviewer_user_id=u.id GROUP BY u.id ORDER BY u.name LIMIT 200`,
      )
      .bind(event.id, event.id)
      .all<{
        id: string;
        email: string;
        name: string;
        assigned: number;
        incomplete: number;
        dueAt: string | null;
        rounds: string | null;
      }>();
    return rows.results.map((row) => ({
      key: `reviewer:${row.id}`,
      email: row.email,
      name: row.name,
      entityType: "reviewer",
      entityId: row.id,
      context: `${row.incomplete} incomplete reviews`,
      data: {
        ...base,
        "recipient.name": row.name,
        "recipient.email": row.email,
        "review.round": row.rounds,
        "review.due_at": row.dueAt,
        "review.incomplete_count": row.incomplete,
        "review.queue_link": `https://app.programloom.com/app/events/${event.id}/reviews`,
      },
    }));
  }
  if (category === "onboarding_reminder") {
    const rows = await db
      .prepare(
        `SELECT sp.id,sp.email,sp.first_name AS firstName,sp.last_name AS lastName,
                sp.company,COUNT(sta.task_id) AS incompleteCount,
                MIN(t.title) AS taskTitle,MIN(t.due_at) AS dueAt
         FROM speaker_profiles sp
         JOIN speaker_task_assignments sta ON sta.speaker_id=sp.id AND sta.status!='complete'
         JOIN onboarding_tasks t ON t.id=sta.task_id AND t.event_id=?
         GROUP BY sp.id ORDER BY MIN(COALESCE(t.due_at,'9999')),sp.last_name,sp.first_name
         LIMIT 200`,
      )
      .bind(event.id)
      .all<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        company: string | null;
        incompleteCount: number;
        taskTitle: string;
        dueAt: string | null;
      }>();
    return rows.results.map((row) => {
      const name = `${row.firstName} ${row.lastName}`.trim();
      return {
        key: `speaker:${row.id}:onboarding`,
        email: row.email,
        name,
        entityType: "speaker",
        entityId: row.id,
        context: `${row.incompleteCount} incomplete task${row.incompleteCount === 1 ? "" : "s"}`,
        data: {
          ...base,
          "recipient.name": name,
          "recipient.email": row.email,
          "speaker.company": row.company,
          "speaker.portal_link": `https://app.programloom.com/app/events/${event.id}/speaker`,
          "task.title": row.taskTitle,
          "task.due_at": row.dueAt ?? "No deadline",
          "task.incomplete_count": row.incompleteCount,
        },
      };
    });
  }
  if (category === "content_reminder" || category === "change_request") {
    const rows = await db
      .prepare(
        `SELECT f.id,sp.id AS speakerId,sp.email,sp.first_name AS firstName,
                sp.last_name AS lastName,sp.company,f.purpose,f.status,t.due_at AS dueAt,
                s.title AS sessionTitle
         FROM files f JOIN speaker_profiles sp ON sp.id=f.speaker_id
         LEFT JOIN onboarding_tasks t ON t.id=f.task_id
         LEFT JOIN submissions s ON s.id=f.submission_id
         WHERE f.event_id=? AND f.status IN ('pending','needs_changes')
         ORDER BY COALESCE(t.due_at,'9999'),sp.last_name,sp.first_name LIMIT 200`,
      )
      .bind(event.id)
      .all<{
        id: string;
        speakerId: string;
        email: string;
        firstName: string;
        lastName: string;
        company: string | null;
        purpose: string;
        status: string;
        dueAt: string | null;
        sessionTitle: string | null;
      }>();
    return rows.results.map((row) => {
      const name = `${row.firstName} ${row.lastName}`.trim();
      return {
        key: `file:${row.id}:${row.speakerId}`,
        email: row.email,
        name,
        entityType: "file",
        entityId: row.id,
        context: `${row.purpose} · ${row.status}`,
        data: {
          ...base,
          "recipient.name": name,
          "recipient.email": row.email,
          "speaker.company": row.company,
          "speaker.portal_link": `https://app.programloom.com/app/events/${event.id}/speaker`,
          "file.request_name": row.purpose,
          "file.due_at": row.dueAt ?? "No deadline",
          "session.title": row.sessionTitle ?? row.purpose,
        },
      };
    });
  }
  if (
    ["speaker_invitation", "speaker_message", "crm_outreach"].includes(category)
  ) {
    const rows = await db
      .prepare(
        `SELECT DISTINCT sp.id,sp.email,sp.first_name AS firstName,
                sp.last_name AS lastName,sp.company
         FROM speaker_profiles sp
         JOIN (SELECT speaker_id FROM event_speakers WHERE event_id=?
               UNION SELECT ss.speaker_id FROM session_speakers ss
                 JOIN submissions sx ON sx.id=ss.submission_id WHERE sx.event_id=?) roster
           ON roster.speaker_id=sp.id
         ORDER BY sp.last_name,sp.first_name LIMIT 200`,
      )
      .bind(event.id, event.id)
      .all<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        company: string | null;
      }>();
    return rows.results.map((row) => {
      const name = `${row.firstName} ${row.lastName}`.trim();
      return {
        key: `speaker:${row.id}`,
        email: row.email,
        name,
        entityType: "speaker",
        entityId: row.id,
        context: row.company ?? "Event speaker",
        data: {
          ...base,
          "recipient.name": name,
          "recipient.email": row.email,
          "speaker.company": row.company,
          "speaker.portal_link": `https://app.programloom.com/app/events/${event.id}/speaker`,
          "organizer.message": null,
        },
      };
    });
  }
  const rows = await db
    .prepare(
      `SELECT DISTINCT sp.id,sp.email,sp.first_name AS firstName,sp.last_name AS lastName,sp.company,s.id AS submissionId,s.title AS sessionTitle,a.starts_at AS startsAt,a.ends_at AS endsAt,r.name AS roomName FROM speaker_profiles sp JOIN (SELECT speaker_id FROM event_speakers WHERE event_id=? UNION SELECT ss.speaker_id FROM session_speakers ss JOIN submissions sx ON sx.id=ss.submission_id WHERE sx.event_id=?) roster ON roster.speaker_id=sp.id LEFT JOIN session_speakers ss ON ss.speaker_id=sp.id LEFT JOIN submissions s ON s.id=ss.submission_id AND s.event_id=? LEFT JOIN agenda_items a ON a.submission_id=s.id LEFT JOIN rooms r ON r.id=a.room_id ORDER BY sp.last_name,sp.first_name LIMIT 200`,
    )
    .bind(event.id, event.id, event.id)
    .all<{
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      company: string | null;
      submissionId: string | null;
      sessionTitle: string | null;
      startsAt: string | null;
      endsAt: string | null;
      roomName: string | null;
    }>();
  return rows.results.map((row) => {
    const name = `${row.firstName} ${row.lastName}`.trim();
    return {
      key: `speaker:${row.id}:${row.submissionId ?? "profile"}`,
      email: row.email,
      name,
      entityType: row.submissionId ? "submission" : "speaker",
      entityId: row.submissionId ?? row.id,
      context: row.sessionTitle ?? "Speaker profile",
      data: {
        ...base,
        "recipient.name": name,
        "recipient.email": row.email,
        "speaker.company": row.company,
        "speaker.portal_link": `https://app.programloom.com/app/events/${event.id}/speaker`,
        "session.title": row.sessionTitle,
        "session.starts_at": row.startsAt,
        "session.ends_at": row.endsAt,
        "session.room": row.roomName,
        "organizer.message": null,
        "task.title": null,
        "task.due_at": null,
        "task.incomplete_count": null,
        "file.request_name": null,
        "file.due_at": null,
      },
    };
  });
}

function renderTemplate(
  template: { subject: string; bodyHtml: string; bodyText: string },
  recipient: Recipient,
  organizerMessage?: string,
) {
  const data = { ...recipient.data, "organizer.message": organizerMessage };
  const subject = renderMergeFields(template.subject, data);
  const bodyHtml = renderMergeFields(template.bodyHtml, data);
  const bodyText = renderMergeFields(template.bodyText, data);
  const unresolved = [
    ...new Set([
      ...subject.unresolved,
      ...bodyHtml.unresolved,
      ...bodyText.unresolved,
    ]),
  ].sort();
  if (unresolved.length)
    throw new HttpError(
      409,
      "unresolved_merge_fields",
      `Current recipient data cannot resolve: ${unresolved.join(", ")}.`,
    );
  return {
    subject: subject.rendered,
    bodyHtml: bodyHtml.rendered,
    bodyText: bodyText.rendered,
  };
}

async function materializeRecipientForDelivery(
  db: D1Database,
  event: EventRecord,
  category: CommunicationCategory,
  recipient: Recipient,
  messageId: string,
  actorUserId: string,
  appUrl: string,
  correlationId: string,
) {
  if (recipient.entityType !== "submission")
    return {
      recipient,
      statements: [] as D1PreparedStatement[],
      expiresAt: undefined,
    };
  if (
    ["decision_acceptance", "decision_waitlist", "decision_rejection"].includes(
      category,
    )
  )
    return materializeDecisionRecipient(
      db,
      event,
      category,
      recipient,
      messageId,
      actorUserId,
      appUrl,
      correlationId,
    );
  if (
    ![
      "submission_confirmation",
      "draft_reminder",
      "deadline_reminder",
    ].includes(category)
  )
    return {
      recipient,
      statements: [] as D1PreparedStatement[],
      expiresAt: undefined,
    };
  const rawToken = randomToken();
  const tokenId = crypto.randomUUID();
  const requestedExpiry = recipient.data["internal.edit_expires_at"];
  const fallbackExpiry = new Date(
    Date.now() + 30 * 24 * 60 * 60_000,
  ).toISOString();
  const expiresAt =
    typeof requestedExpiry === "string" &&
    requestedExpiry > new Date().toISOString()
      ? requestedExpiry
      : fallbackExpiry;
  const actionLink = `${appUrl}/action/submission-edit#token=${encodeURIComponent(rawToken)}`;
  return {
    recipient: {
      ...recipient,
      data: { ...recipient.data, "submission.edit_link": actionLink },
    },
    expiresAt,
    statements: [
      db
        .prepare(
          `INSERT INTO communication_action_tokens
          (id,organization_id,event_id,message_id,action_type,entity_type,
           entity_id,token_hash,expires_at,created_by)
         VALUES(?,?,?,?,'submission_edit','submission',?,?,?,?)`,
        )
        .bind(
          tokenId,
          event.organizationId,
          event.id,
          messageId,
          recipient.entityId,
          await sha256(rawToken),
          expiresAt,
          actorUserId,
        ),
    ],
  };
}

async function materializeDecisionRecipient(
  db: D1Database,
  event: EventRecord,
  category: CommunicationCategory,
  recipient: Recipient,
  messageId: string,
  actorUserId: string,
  appUrl: string,
  correlationId: string,
) {
  const stagedState =
    category === "decision_acceptance"
      ? "acceptance_staged"
      : category === "decision_waitlist"
        ? "waitlist_staged"
        : "rejection_staged";
  const finalState =
    category === "decision_acceptance"
      ? "accepted"
      : category === "decision_waitlist"
        ? "waitlisted"
        : "rejected";
  const legacyStatus =
    finalState === "accepted"
      ? "accepted"
      : finalState === "rejected"
        ? "declined"
        : "pending";
  const current = await db
    .prepare(
      "SELECT decision_state AS decisionState FROM submissions WHERE id=? AND event_id=?",
    )
    .bind(recipient.entityId, event.id)
    .first<{ decisionState: string }>();
  if (!current || current.decisionState !== stagedState)
    throw new HttpError(
      409,
      "decision_state_changed",
      "A proposal decision changed before delivery was prepared.",
    );
  const statements: D1PreparedStatement[] = [];
  let deliveryRecipient = recipient;
  let expiresAt: string | undefined;
  if (category === "decision_acceptance") {
    const existingUser = await db
      .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
      .bind(recipient.email)
      .first<{ id: string }>();
    let portalLink = `${appUrl}/app/events/${event.id}/speaker`;
    if (existingUser) {
      statements.push(
        db
          .prepare(
            `INSERT INTO event_members(event_id,user_id,role,invited_by)
             VALUES(?,?,'speaker',?) ON CONFLICT(event_id,user_id,role) DO NOTHING`,
          )
          .bind(event.id, existingUser.id, actorUserId),
      );
    } else {
      const invitationId = crypto.randomUUID();
      const rawInvite = randomToken();
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
      portalLink = `${appUrl}/invite#token=${encodeURIComponent(rawInvite)}`;
      statements.push(
        db
          .prepare(
            `UPDATE invitations SET revoked_at=CURRENT_TIMESTAMP
             WHERE organization_id=? AND event_id=? AND email=? COLLATE NOCASE
               AND role='speaker' AND accepted_at IS NULL AND revoked_at IS NULL`,
          )
          .bind(event.organizationId, event.id, recipient.email),
        db
          .prepare(
            `INSERT INTO invitations
              (id,organization_id,event_id,email,role,token_hash,invited_by,expires_at)
             VALUES(?,?,?,?,'speaker',?,?,?)`,
          )
          .bind(
            invitationId,
            event.organizationId,
            event.id,
            recipient.email,
            await sha256(rawInvite),
            actorUserId,
            expiresAt,
          ),
      );
    }
    deliveryRecipient = {
      ...recipient,
      data: { ...recipient.data, "speaker.portal_link": portalLink },
    };
    const nameParts = recipient.name.trim().split(/\s+/);
    const speakerId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO speaker_profiles
            (id,organization_id,email,first_name,last_name,company,portal_status)
           VALUES(?,?,?,?,?,?,'invited')
           ON CONFLICT(organization_id,email) DO UPDATE SET
             portal_status=CASE WHEN portal_status='not_invited' THEN 'invited' ELSE portal_status END,
             updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          speakerId,
          event.organizationId,
          recipient.email,
          nameParts[0] || recipient.name,
          nameParts.slice(1).join(" ") || "—",
          recipient.data["internal.submitter_organization"] ?? null,
        ),
      db
        .prepare(
          `INSERT INTO session_speakers(submission_id,speaker_id,role)
           SELECT ?,id,'speaker' FROM speaker_profiles
           WHERE organization_id=? AND email=? COLLATE NOCASE
           ON CONFLICT(submission_id,speaker_id) DO NOTHING`,
        )
        .bind(recipient.entityId, event.organizationId, recipient.email),
      db
        .prepare(
          `INSERT OR IGNORE INTO event_speakers(event_id,speaker_id,source,added_by)
           SELECT ?,id,'accepted_submission',? FROM speaker_profiles
           WHERE organization_id=? AND email=? COLLATE NOCASE`,
        )
        .bind(event.id, actorUserId, event.organizationId, recipient.email),
      db
        .prepare(
          `INSERT INTO crm_contacts
            (id,organization_id,speaker_profile_id,email,first_name,last_name,company,bio,tags_json,source)
           SELECT ?,organization_id,id,email,first_name,last_name,company,bio,'[]','accepted_session'
           FROM speaker_profiles WHERE organization_id=? AND email=? COLLATE NOCASE
           ON CONFLICT(organization_id,email) DO UPDATE SET
             speaker_profile_id=excluded.speaker_profile_id,first_name=excluded.first_name,
             last_name=excluded.last_name,company=excluded.company,
             bio=COALESCE(excluded.bio,crm_contacts.bio),updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(crypto.randomUUID(), event.organizationId, recipient.email),
      db
        .prepare(
          `INSERT INTO speaker_task_assignments(task_id,speaker_id)
           SELECT task.id,speaker.id FROM onboarding_tasks task
           JOIN speaker_profiles speaker ON speaker.organization_id=? AND speaker.email=? COLLATE NOCASE
           WHERE task.event_id=? ON CONFLICT(task_id,speaker_id) DO NOTHING`,
        )
        .bind(event.organizationId, recipient.email, event.id),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE submissions SET status=?,decision_state=?,decision_message_id=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND event_id=? AND decision_state=?`,
      )
      .bind(
        legacyStatus,
        finalState,
        messageId,
        recipient.entityId,
        event.id,
        stagedState,
      ),
    db
      .prepare(
        `INSERT INTO submission_decision_history
          (id,organization_id,event_id,submission_id,from_state,to_state,message_id,changed_by)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        event.organizationId,
        event.id,
        recipient.entityId,
        stagedState,
        finalState,
        messageId,
        actorUserId,
      ),
    auditStatement(db, {
      organizationId: event.organizationId,
      eventId: event.id,
      actorUserId,
      action: `decision.${finalState}_prepared`,
      entityType: "submission",
      entityId: recipient.entityId,
      before: { decisionState: stagedState },
      after: { decisionState: finalState, messageId },
      requestId: correlationId,
    }),
    domainEventStatement(db, {
      organizationId: event.organizationId,
      eventId: event.id,
      eventType: `decision.${finalState}`,
      entityType: "submission",
      entityId: recipient.entityId,
      actorUserId,
      payload: { messageId },
      correlationId,
    }),
  );
  return { recipient: deliveryRecipient, statements, expiresAt };
}

function publicRecipient({ data: _data, ...recipient }: Recipient) {
  return recipient;
}

function sanitizeEmailHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "code",
      "h2",
      "h3",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["https", "mailto"],
    disallowedTagsMode: "discard",
  });
}

function communicationInsert(
  db: D1Database,
  input: {
    id: string;
    event: EventRecord;
    templateId: string | null;
    category: CommunicationCategory;
    recipientEmail: string;
    recipientName: string;
    entityType: string;
    entityId: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    sensitiveExpiresAt?: string;
    idempotencyKey: string;
    preparedBy: string;
    correlationId: string;
    scheduledFor?: string | null;
  },
) {
  return db
    .prepare(
      `INSERT INTO communication_messages (id,organization_id,event_id,template_id,category,recipient_email,recipient_name,subject,body_html,body_text,entity_type,entity_id,sensitive_expires_at,idempotency_key,status,scheduled_for,prepared_by,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      input.id,
      input.event.organizationId,
      input.event.id,
      input.templateId,
      input.category,
      input.recipientEmail,
      input.recipientName,
      input.subject,
      input.bodyHtml,
      input.bodyText,
      input.entityType,
      input.entityId,
      input.sensitiveExpiresAt ?? null,
      input.idempotencyKey,
      input.scheduledFor ?? null,
      input.preparedBy,
      input.correlationId,
    );
}

function providerStatus(eventType: string) {
  if (eventType === "email.sent") return "sent" as const;
  if (eventType === "email.delivered") return "delivered" as const;
  if (eventType === "email.bounced" || eventType === "email.complained")
    return "bounced" as const;
  if (eventType === "email.failed") return "failed" as const;
  return null;
}

export default router;
