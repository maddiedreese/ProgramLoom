import type { Env } from "../env";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "./communications";
import { renderSimpleTransactionalEmail } from "./email";
import {
  notificationStatement,
  type NotificationCategory,
  type OperationalSeverity,
} from "./operations";

export function eventManagerNotificationStatement(
  db: D1Database,
  input: {
    organizationId: string;
    eventId?: string;
    category: NotificationCategory;
    notificationType: string;
    severity: OperationalSeverity;
    title: string;
    body: string;
    actionUrl: string;
    entityType?: string;
    entityId?: string;
    coalesceKey?: string;
    excludeUserId?: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO notifications
       (id,organization_id,event_id,recipient_user_id,category,notification_type,severity,
        title,body,action_url,entity_type,entity_id,coalesce_key)
       SELECT lower(hex(randomblob(16))),?,?,om.user_id,?,?,?,?,?,?,?,?,?
       FROM organization_members om
       WHERE om.organization_id=? AND om.role IN ('owner','admin')
       AND (? IS NULL OR om.user_id<>?)
       ON CONFLICT DO UPDATE SET
         occurrence_count=notifications.occurrence_count+1,
         severity=excluded.severity,title=excluded.title,body=excluded.body,
         action_url=excluded.action_url,entity_type=excluded.entity_type,entity_id=excluded.entity_id,
         last_occurred_at=CURRENT_TIMESTAMP,read_at=NULL,updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(
      input.organizationId,
      input.eventId ?? null,
      input.category,
      input.notificationType,
      input.severity,
      input.title,
      input.body,
      input.actionUrl,
      input.entityType ?? null,
      input.entityId ?? null,
      input.coalesceKey ?? null,
      input.organizationId,
      input.excludeUserId ?? null,
      input.excludeUserId ?? null,
    );
}

export async function cleanupNotificationRetention(env: Env) {
  if (!env.DB) return { archived: 0, deleted: 0 };
  const archive = await env.DB.prepare(
    `UPDATE notifications SET archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE archived_at IS NULL AND (
       (expires_at IS NOT NULL AND expires_at<CURRENT_TIMESTAMP) OR
       last_occurred_at<datetime('now','-180 days')
     )`,
  ).run();
  const remove = await env.DB.prepare(
    `DELETE FROM notifications
     WHERE archived_at IS NOT NULL AND archived_at<datetime('now','-30 days')`,
  ).run();
  const result = {
    archived: archive.meta.changes ?? 0,
    deleted: remove.meta.changes ?? 0,
  };
  console.log(
    JSON.stringify({
      level: "info",
      service: "notifications",
      operation: "retention_cleanup",
      ...result,
    }),
  );
  return result;
}

export async function dispatchNotificationEmails(env: Env) {
  if (!env.DB) return { prepared: 0, queued: 0 };
  const due = await env.DB.prepare(
    `SELECT n.id,n.organization_id organizationId,n.event_id eventId,n.category,
       n.title,n.body,n.action_url actionUrl,u.id userId,u.email,u.name,
       d.status deliveryStatus
       FROM notifications n JOIN users u ON u.id=n.recipient_user_id
       LEFT JOIN notification_channel_deliveries d
         ON d.notification_id=n.id AND d.channel='email'
       WHERE n.archived_at IS NULL AND n.event_id IS NOT NULL
       AND (d.id IS NULL OR d.status='failed')
       AND COALESCE(
         (SELECT email_enabled FROM notification_preferences np
          WHERE np.organization_id=n.organization_id AND np.event_id=n.event_id
            AND np.user_id=n.recipient_user_id AND np.category=n.category),
         (SELECT email_enabled FROM notification_preferences np
          WHERE np.organization_id=n.organization_id AND np.event_id IS NULL
            AND np.user_id=n.recipient_user_id AND np.category=n.category),
         CASE WHEN n.notification_type='task.overdue' AND EXISTS (
           SELECT 1 FROM speaker_profiles sp
           JOIN speaker_task_assignments sta ON sta.speaker_id=sp.id
           JOIN onboarding_tasks t ON t.id=sta.task_id
           WHERE sp.user_id=n.recipient_user_id AND t.event_id=n.event_id
             AND (t.id||':'||sp.id)=n.entity_id
         ) THEN 1 ELSE 0 END
       )=1
       ORDER BY n.created_at,n.id LIMIT 50`,
  ).all<{
    id: string;
    organizationId: string;
    eventId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    actionUrl: string;
    userId: string;
    email: string;
    name: string;
  }>();
  let queued = 0;
  for (const item of due.results) {
    const messageId = `notification-email:${item.id}`;
    const actionUrl = new URL(item.actionUrl, env.APP_URL).toString();
    const rendered = renderSimpleTransactionalEmail({
      recipientName: item.name,
      paragraphs: [item.body],
      actionLabel: "Open in ProgramLoom",
      actionUrl,
    });
    await env.DB.batch([
      prepareCommunicationStatement(env.DB, {
        id: messageId,
        organizationId: item.organizationId,
        eventId: item.eventId,
        category: "speaker_message",
        recipientUserId: item.userId,
        recipientEmail: item.email,
        recipientName: item.name,
        subject: item.title,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
        entityType: "notification",
        entityId: item.id,
        metadata: { notificationCategory: item.category },
        idempotencyKey: `notification-email/${item.id}`,
        correlationId: `notification-email/${item.id}`,
      }),
      env.DB.prepare(
        `INSERT INTO notification_channel_deliveries
           (id,notification_id,channel,status,message_id,attempts)
           VALUES(?,?,'email','prepared',?,1)
           ON CONFLICT(notification_id,channel) DO UPDATE SET
             status='prepared',message_id=excluded.message_id,
             attempts=notification_channel_deliveries.attempts+1,
             last_error=NULL,updated_at=CURRENT_TIMESTAMP`,
      ).bind(crypto.randomUUID(), item.id, messageId),
    ]);
    try {
      const result = await enqueueCommunication(env, messageId);
      await env.DB.prepare(
        `UPDATE notification_channel_deliveries SET status=?,updated_at=CURRENT_TIMESTAMP
           WHERE notification_id=? AND channel='email'`,
      )
        .bind(
          result.queued || result.alreadyQueued ? "queued" : "prepared",
          item.id,
        )
        .run();
      if (result.queued || result.alreadyQueued) queued += 1;
    } catch (error) {
      await env.DB.prepare(
        `UPDATE notification_channel_deliveries SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP
           WHERE notification_id=? AND channel='email'`,
      )
        .bind("Notification email could not be queued.", item.id)
        .run();
      console.error(
        JSON.stringify({
          level: "error",
          service: "notifications",
          operation: "email_dispatch",
          notificationId: item.id,
          eventId: item.eventId,
          errorCode: "queue_failed",
        }),
      );
    }
  }
  return { prepared: due.results.length, queued };
}

export async function createOverdueTaskNotifications(env: Env) {
  if (!env.DB) return { createdFor: 0 };
  const overdue = await env.DB.prepare(
    `SELECT t.id taskId,t.event_id eventId,t.organization_id organizationId,t.title,
       sta.speaker_id speakerId,sp.user_id speakerUserId
       FROM onboarding_tasks t JOIN speaker_task_assignments sta ON sta.task_id=t.id
       JOIN speaker_profiles sp ON sp.id=sta.speaker_id
       WHERE t.due_at IS NOT NULL AND t.due_at<CURRENT_TIMESTAMP
       AND sta.status NOT IN ('submitted','complete')
       AND NOT EXISTS (
         SELECT 1 FROM notifications n WHERE n.coalesce_key='task-overdue:'||t.id||':'||sta.speaker_id
           AND n.archived_at IS NULL
       ) ORDER BY t.due_at,t.id,sta.speaker_id LIMIT 50`,
  ).all<{
    taskId: string;
    eventId: string;
    organizationId: string;
    title: string;
    speakerId: string;
    speakerUserId: string | null;
  }>();
  for (const item of overdue.results) {
    const statements = [
      eventManagerNotificationStatement(env.DB, {
        organizationId: item.organizationId,
        eventId: item.eventId,
        category: "task",
        notificationType: "task.overdue",
        severity: "warning",
        title: "A speaker onboarding task is overdue",
        body: item.title,
        actionUrl: `/app/events/${item.eventId}/speakers#task-${item.taskId}`,
        entityType: "speaker_task",
        entityId: `${item.taskId}:${item.speakerId}`,
        coalesceKey: `task-overdue:${item.taskId}:${item.speakerId}`,
      }),
    ];
    if (item.speakerUserId)
      statements.push(
        notificationStatement(env.DB, {
          organizationId: item.organizationId,
          eventId: item.eventId,
          recipientUserId: item.speakerUserId,
          category: "task",
          notificationType: "task.overdue",
          severity: "warning",
          title: "An onboarding task is overdue",
          body: item.title,
          actionUrl: `/app/events/${item.eventId}/speaker#task-${item.taskId}`,
          entityType: "speaker_task",
          entityId: `${item.taskId}:${item.speakerId}`,
          coalesceKey: `task-overdue:${item.taskId}:${item.speakerId}`,
        }),
      );
    await env.DB.batch(statements);
  }
  return { createdFor: overdue.results.length };
}

export async function createOverdueTaskNotificationsAndDispatchEmails(
  env: Env,
) {
  const notifications = await createOverdueTaskNotifications(env);
  const emails = await dispatchNotificationEmails(env);
  return { notifications, emails };
}
