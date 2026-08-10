export const communicationCategories = [
  "submission_confirmation",
  "draft_reminder",
  "deadline_reminder",
  "reviewer_invitation",
  "reviewer_reminder",
  "change_request",
  "decision_acceptance",
  "decision_waitlist",
  "decision_rejection",
  "speaker_invitation",
  "onboarding_reminder",
  "content_reminder",
  "scheduling_notice",
  "calendar_invitation",
  "calendar_update",
  "calendar_cancellation",
  "speaker_message",
  "crm_outreach",
] as const;

export type CommunicationCategory = (typeof communicationCategories)[number];
export type NotificationCategory =
  | "submission"
  | "review"
  | "decision"
  | "speaker"
  | "task"
  | "file"
  | "content"
  | "agenda"
  | "delivery"
  | "queue"
  | "airtable"
  | "integration";
export type OperationalSeverity = "info" | "warning" | "blocking";

const mergePattern = /{{\s*([a-z][a-z0-9_.]*)\s*}}/gi;

export function extractMergeFields(...values: string[]) {
  return [
    ...new Set(
      values.flatMap((value) =>
        [...value.matchAll(mergePattern)].map((match) =>
          match[1].toLowerCase(),
        ),
      ),
    ),
  ].sort();
}

export function validateMergeFields(
  values: string[],
  supported: readonly string[],
) {
  const allowed = new Set(supported.map((field) => field.toLowerCase()));
  return extractMergeFields(...values).filter((field) => !allowed.has(field));
}

export function renderMergeFields(
  value: string,
  data: Record<string, string | number | boolean | null | undefined>,
) {
  const normalized = new Map(
    Object.entries(data).map(([key, item]) => [key.toLowerCase(), item]),
  );
  const unresolved: string[] = [];
  const rendered = value.replace(mergePattern, (_, rawField: string) => {
    const field = rawField.toLowerCase();
    const replacement = normalized.get(field);
    if (replacement === undefined || replacement === null) {
      unresolved.push(field);
      return `{{${field}}}`;
    }
    return String(replacement);
  });
  return { rendered, unresolved: [...new Set(unresolved)].sort() };
}

export function domainEventStatement(
  db: D1Database,
  input: {
    organizationId: string;
    eventId?: string;
    eventType: string;
    entityType: string;
    entityId: string;
    actorUserId?: string;
    payload?: Record<string, unknown>;
    correlationId: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO domain_events
        (id,organization_id,event_id,event_type,entity_type,entity_id,actor_user_id,payload_json,correlation_id)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.eventId ?? null,
      input.eventType,
      input.entityType,
      input.entityId,
      input.actorUserId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.correlationId,
    );
}

export function notificationStatement(
  db: D1Database,
  input: {
    organizationId: string;
    eventId?: string;
    recipientUserId: string;
    category: NotificationCategory;
    notificationType: string;
    severity: OperationalSeverity;
    title: string;
    body: string;
    actionUrl: string;
    entityType?: string;
    entityId?: string;
    coalesceKey?: string;
    expiresAt?: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO notifications
        (id,organization_id,event_id,recipient_user_id,category,notification_type,severity,title,body,action_url,entity_type,entity_id,coalesce_key,expires_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT DO UPDATE SET
         occurrence_count=notifications.occurrence_count+1,
         severity=excluded.severity,
         title=excluded.title,
         body=excluded.body,
         action_url=excluded.action_url,
         entity_type=excluded.entity_type,
         entity_id=excluded.entity_id,
         last_occurred_at=CURRENT_TIMESTAMP,
         read_at=NULL,
         updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.eventId ?? null,
      input.recipientUserId,
      input.category,
      input.notificationType,
      input.severity,
      input.title,
      input.body,
      input.actionUrl,
      input.entityType ?? null,
      input.entityId ?? null,
      input.coalesceKey ?? null,
      input.expiresAt ?? null,
    );
}

export function logOperationalEvent(
  level: "info" | "warning" | "error",
  fields: {
    operation: string;
    requestId?: string;
    correlationId?: string;
    jobId?: string;
    eventId?: string;
    messageId?: string;
    providerId?: string;
    entityType?: string;
    entityId?: string;
    errorCode?: string;
    message?: string;
  },
) {
  const entry = JSON.stringify({
    level,
    service: "programloom",
    ...fields,
    // Never add recipient data, template bodies, tokens, or query contents here.
  });
  if (level === "error") console.error(entry);
  else if (level === "warning") console.warn(entry);
  else console.log(entry);
}

export function safeOperationalError(error: unknown) {
  const message = error instanceof Error ? error.message : "Operation failed.";
  return message
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 500);
}
