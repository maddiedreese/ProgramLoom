import type { Env } from "../env";
import { sendTransactionalEmail } from "./email";
import {
  domainEventStatement,
  logOperationalEvent,
  notificationStatement,
  safeOperationalError,
  type CommunicationCategory,
} from "./operations";

export type CommunicationJob = {
  kind: "communication_send";
  messageId: string;
  jobId: string;
};

type MessageRecord = {
  id: string;
  organizationId: string;
  eventId: string;
  category: CommunicationCategory;
  recipientEmail: string;
  replyTo: string | null;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor: string | null;
  attachmentManifestJson: string;
  correlationId: string;
};

export function prepareCommunicationStatement(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    eventId: string;
    templateId?: string;
    category: CommunicationCategory;
    recipientUserId?: string;
    recipientEmail: string;
    recipientName?: string;
    replyTo?: string | null;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    entityType?: string;
    entityId?: string;
    sensitiveExpiresAt?: string;
    attachmentManifest?: Array<{
      key: string;
      filename: string;
      contentType?: string;
    }>;
    metadata?: Record<string, unknown>;
    idempotencyKey: string;
    scheduledFor?: string;
    preparedBy?: string;
    correlationId: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO communication_messages
        (id,organization_id,event_id,template_id,category,recipient_user_id,
         recipient_email,recipient_name,reply_to,subject,body_html,body_text,entity_type,
         entity_id,sensitive_expires_at,attachment_manifest_json,metadata_json,
         idempotency_key,status,scheduled_for,prepared_by,correlation_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      input.id,
      input.organizationId,
      input.eventId,
      input.templateId ?? null,
      input.category,
      input.recipientUserId ?? null,
      input.recipientEmail,
      input.recipientName ?? null,
      input.replyTo ?? null,
      input.subject,
      input.bodyHtml,
      input.bodyText,
      input.entityType ?? null,
      input.entityId ?? null,
      input.sensitiveExpiresAt ?? null,
      JSON.stringify(input.attachmentManifest ?? []),
      JSON.stringify(input.metadata ?? {}),
      input.idempotencyKey,
      input.scheduledFor ?? null,
      input.preparedBy ?? null,
      input.correlationId,
    );
}

export async function enqueueCommunication(
  env: Env,
  messageId: string,
  requestId?: string,
) {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  if (!env.JOBS) throw new Error("Queue binding is unavailable.");
  const message = await env.DB.prepare(
    `SELECT id,organization_id AS organizationId,event_id AS eventId,status,
            scheduled_for AS scheduledFor,correlation_id AS correlationId
     FROM communication_messages WHERE id=?`,
  )
    .bind(messageId)
    .first<{
      id: string;
      organizationId: string;
      eventId: string;
      status: string;
      scheduledFor: string | null;
      correlationId: string;
    }>();
  if (!message) throw new Error("Communication message not found.");
  if (["sent", "delivered", "bounced", "cancelled"].includes(message.status))
    return { queued: false, terminal: true };
  const now = new Date().toISOString();
  if (message.scheduledFor && message.scheduledFor > now)
    return { queued: false, scheduled: true };

  if (message.status === "queued") {
    const active = await env.DB.prepare(
      `SELECT id FROM operational_jobs
       WHERE job_kind='communication_send' AND entity_type='communication'
         AND entity_id=? AND status IN ('queued','processing','retrying') LIMIT 1`,
    )
      .bind(messageId)
      .first<{ id: string }>();
    if (active) return { queued: false, alreadyQueued: true, jobId: active.id };
  }

  const jobId = crypto.randomUUID();
  const update = await env.DB.prepare(
    `UPDATE communication_messages
     SET status='queued',queued_at=COALESCE(queued_at,CURRENT_TIMESTAMP),
         last_error=NULL,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND status IN ('prepared','failed') AND attempts<max_attempts`,
  )
    .bind(messageId)
    .run();
  if (!update.meta.changes && message.status !== "queued")
    return { queued: false, terminal: false };

  await env.DB.prepare(
    `INSERT INTO operational_jobs
      (id,organization_id,event_id,job_kind,entity_type,entity_id,status,correlation_id)
     VALUES(?,?,?,'communication_send','communication',?,'queued',?)`,
  )
    .bind(
      jobId,
      message.organizationId,
      message.eventId,
      message.id,
      message.correlationId,
    )
    .run();
  try {
    await env.JOBS.send({ kind: "communication_send", messageId, jobId });
  } catch (error) {
    const safeError = safeOperationalError(error);
    const notifications = await ownerFailureNotifications(env.DB, {
      organizationId: message.organizationId,
      eventId: message.eventId,
      messageId,
      notificationType: "queue.dispatch_failed",
      title: "A communication could not enter the delivery queue",
      body: "The prepared message remains safe in the outbox and can be retried after the Queue integration recovers.",
      coalesceKey: `queue-dispatch:${messageId}`,
    });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE communication_messages SET status='prepared',last_error_code='queue_dispatch_failed',
             last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'`,
      ).bind(safeError, messageId),
      env.DB.prepare(
        `UPDATE operational_jobs SET status='exhausted',last_error_code='queue_dispatch_failed',
             last_error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(safeError, jobId),
      ...notifications,
    ]);
    throw error;
  }
  logOperationalEvent("info", {
    operation: "communication_queued",
    requestId,
    correlationId: message.correlationId,
    jobId,
    eventId: message.eventId,
    messageId,
  });
  return { queued: true, jobId };
}

export async function dispatchScheduledCommunications(env: Env) {
  if (!env.DB) return;
  const due = await env.DB.prepare(
    `SELECT id FROM communication_messages
     WHERE status IN ('prepared','failed')
       AND scheduled_for IS NOT NULL AND scheduled_for<=?
       AND attempts<max_attempts
     ORDER BY scheduled_for,id LIMIT 50`,
  )
    .bind(new Date().toISOString())
    .all<{ id: string }>();
  for (const message of due.results)
    await enqueueCommunication(env, message.id);
}

export async function processCommunication(
  env: Env,
  input: CommunicationJob,
): Promise<{ retry: boolean }> {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  const message = await env.DB.prepare(
    `SELECT id,organization_id AS organizationId,event_id AS eventId,category,
            recipient_email AS recipientEmail,reply_to AS replyTo,subject,body_html AS bodyHtml,
            body_text AS bodyText,idempotency_key AS idempotencyKey,status,
            attempts,max_attempts AS maxAttempts,scheduled_for AS scheduledFor,
            attachment_manifest_json AS attachmentManifestJson,
            correlation_id AS correlationId
     FROM communication_messages WHERE id=?`,
  )
    .bind(input.messageId)
    .first<MessageRecord>();
  if (!message) {
    await failMissingJob(env.DB, input.jobId);
    return { retry: false };
  }
  if (["sent", "delivered", "bounced", "cancelled"].includes(message.status)) {
    await finishJob(env.DB, input.jobId, "succeeded");
    return { retry: false };
  }
  if (
    !["queued", "processing", "failed"].includes(message.status) ||
    message.attempts >= message.maxAttempts
  )
    return { retry: false };

  const attemptNumber = message.attempts + 1;
  const attemptId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE communication_messages SET status='processing',attempts=?,
           processing_at=CURRENT_TIMESTAMP,last_attempt_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).bind(attemptNumber, message.id),
    env.DB.prepare(
      `UPDATE operational_jobs SET status='processing',attempts=attempts+1,
           started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
    ).bind(input.jobId),
    env.DB.prepare(
      `INSERT INTO communication_attempts
          (id,message_id,attempt_number,status,job_id)
         VALUES(?,?,?,'processing',?)`,
    ).bind(attemptId, message.id, attemptNumber, input.jobId),
  ]);

  try {
    const attachments = await loadAttachments(
      env,
      message.attachmentManifestJson,
    );
    const providerId = await sendTransactionalEmail(env, {
      to: message.recipientEmail,
      subject: message.subject,
      html: message.bodyHtml,
      text: message.bodyText,
      category: message.category,
      replyTo: message.replyTo,
      idempotencyKey: `communication/${message.idempotencyKey}`,
      attachments,
    });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE communication_messages SET status='sent',provider_id=?,sent_at=CURRENT_TIMESTAMP,
             processing_at=NULL,last_error=NULL,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
      ).bind(providerId, message.id),
      env.DB.prepare(
        `UPDATE communication_attempts SET status='accepted',provider_id=?,finished_at=CURRENT_TIMESTAMP
           WHERE id=?`,
      ).bind(providerId, attemptId),
      env.DB.prepare(
        `UPDATE operational_jobs SET status='succeeded',completed_at=CURRENT_TIMESTAMP,
             updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(input.jobId),
    ]);
    await syncCrmCommunicationState(env.DB, message.id, "sent", providerId);
    logOperationalEvent("info", {
      operation: "communication_sent",
      correlationId: message.correlationId,
      jobId: input.jobId,
      eventId: message.eventId,
      messageId: message.id,
      providerId,
    });
    return { retry: false };
  } catch (error) {
    const safeError = safeOperationalError(error);
    const exhausted = attemptNumber >= message.maxAttempts;
    const exhaustedNotifications = exhausted
      ? await ownerFailureNotifications(env.DB, {
          organizationId: message.organizationId,
          eventId: message.eventId,
          messageId: message.id,
          notificationType: "queue.job_exhausted",
          title: "A communication exhausted every delivery attempt",
          body: "Review the provider failure, correct it, and use the outbox retry control.",
          coalesceKey: `queue-exhausted:${message.id}`,
        })
      : [];
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE communication_messages SET status='failed',failed_at=CURRENT_TIMESTAMP,
             processing_at=NULL,last_error_code='provider_error',last_error=?,updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
      ).bind(safeError, message.id),
      env.DB.prepare(
        `UPDATE communication_attempts SET status='failed',error_code='provider_error',
             error_message=?,finished_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(safeError, attemptId),
      env.DB.prepare(
        `UPDATE operational_jobs SET status=?,last_error_code='provider_error',last_error=?,
             completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,
             updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(
        exhausted ? "exhausted" : "retrying",
        safeError,
        exhausted,
        input.jobId,
      ),
      ...(exhausted
        ? [
            domainEventStatement(env.DB, {
              organizationId: message.organizationId,
              eventId: message.eventId,
              eventType: "queue.job_exhausted",
              entityType: "communication",
              entityId: message.id,
              payload: { jobId: input.jobId },
              correlationId: message.correlationId,
            }),
          ]
        : []),
      ...exhaustedNotifications,
    ]);
    await syncCrmCommunicationState(
      env.DB,
      message.id,
      "failed",
      undefined,
      safeError,
    );
    logOperationalEvent("error", {
      operation: "communication_failed",
      correlationId: message.correlationId,
      jobId: input.jobId,
      eventId: message.eventId,
      messageId: message.id,
      errorCode: "provider_error",
      message: safeError,
    });
    return { retry: !exhausted };
  }
}

async function ownerFailureNotifications(
  db: D1Database,
  input: {
    organizationId: string;
    eventId: string;
    messageId: string;
    notificationType: string;
    title: string;
    body: string;
    coalesceKey: string;
  },
) {
  const owners = await db
    .prepare(
      `SELECT user_id AS userId FROM organization_members
       WHERE organization_id=? AND role IN ('owner','admin') ORDER BY user_id LIMIT 50`,
    )
    .bind(input.organizationId)
    .all<{ userId: string }>();
  return owners.results.map((owner) =>
    notificationStatement(db, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      recipientUserId: owner.userId,
      category: "queue",
      notificationType: input.notificationType,
      severity: "blocking",
      title: input.title,
      body: input.body,
      actionUrl: `/app/events/${input.eventId}/communications?status=failed`,
      entityType: "communication",
      entityId: input.messageId,
      coalesceKey: input.coalesceKey,
    }),
  );
}

export async function syncCrmCommunicationState(
  db: D1Database,
  messageId: string,
  status: "sent" | "delivered" | "bounced" | "failed",
  providerId?: string,
  error?: string,
) {
  const recipient = await db
    .prepare(
      "SELECT campaign_id AS campaignId FROM crm_email_recipients WHERE communication_message_id=?",
    )
    .bind(messageId)
    .first<{ campaignId: string }>();
  if (!recipient) return;
  await db
    .prepare(
      `UPDATE crm_email_recipients SET status=?,provider_id=COALESCE(?,provider_id),
         sent_at=CASE WHEN ? IN ('sent','delivered') THEN COALESCE(sent_at,CURRENT_TIMESTAMP) ELSE sent_at END,
         last_error=? WHERE communication_message_id=?`,
    )
    .bind(status, providerId ?? null, status, error ?? null, messageId)
    .run();
  const counts = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('sent','delivered','opened','clicked') THEN 1 ELSE 0 END) AS successful,
              SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS pending
       FROM crm_email_recipients WHERE campaign_id=?`,
    )
    .bind(recipient.campaignId)
    .first<{ total: number; successful: number; pending: number }>();
  if (!counts) return;
  const campaignStatus = counts.pending
    ? "sending"
    : counts.successful === counts.total
      ? "sent"
      : counts.successful
        ? "partial"
        : "failed";
  await db
    .prepare(
      `UPDATE crm_email_campaigns SET status=?,
         completed_at=CASE WHEN ?='sending' THEN NULL ELSE CURRENT_TIMESTAMP END
       WHERE id=?`,
    )
    .bind(campaignStatus, campaignStatus, recipient.campaignId)
    .run();
}

async function loadAttachments(env: Env, manifestJson: string) {
  const manifest = JSON.parse(manifestJson) as Array<{
    key: string;
    filename: string;
    contentType?: string;
  }>;
  if (!manifest.length) return undefined;
  if (!env.FILES) throw new Error("File storage is unavailable.");
  const attachments = [];
  for (const item of manifest) {
    const object = await env.FILES.get(item.key);
    if (!object) throw new Error("A communication attachment is unavailable.");
    const bytes = new Uint8Array(await object.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    attachments.push({
      filename: item.filename,
      content: btoa(binary),
      contentType: item.contentType,
    });
  }
  return attachments;
}

async function finishJob(db: D1Database, jobId: string, status: string) {
  await db
    .prepare(
      `UPDATE operational_jobs SET status=?,completed_at=CURRENT_TIMESTAMP,
       updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(status, jobId)
    .run();
}

async function failMissingJob(db: D1Database, jobId: string) {
  await db
    .prepare(
      `UPDATE operational_jobs SET status='exhausted',last_error_code='message_missing',
       last_error='Communication message not found.',completed_at=CURRENT_TIMESTAMP,
       updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(jobId)
    .run();
}
