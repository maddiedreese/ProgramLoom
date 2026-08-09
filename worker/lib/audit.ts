import type { Env } from "../env";

type AuditInput = {
  organizationId: string;
  eventId?: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
};

export function auditStatement(db: D1Database, input: AuditInput): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO audit_events
      (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.organizationId,
    input.eventId ?? null,
    input.actorUserId,
    input.action,
    input.entityType,
    input.entityId,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.requestId ?? null,
  );
}

export function publicRuntimeConfig(env: Env) {
  return { applicationUrl: env.APP_URL, marketingUrl: env.MARKETING_URL };
}
