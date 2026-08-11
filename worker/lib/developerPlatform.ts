import type { Env } from "../env";
import { auditStatement } from "./audit";
import { database } from "./authz";
import { sha256 } from "./crypto";
import { eventManagerNotificationStatement } from "./notifications";

export const developerScopes = [
  "read:events",
  "read:sessions",
  "read:speakers",
  "read:contacts",
  "read:submissions",
  "read:agenda",
  "read:content",
  "write:sessions",
  "write:contacts",
  "write:events",
  "write:metadata",
  "write:fields",
  "write:agenda",
] as const;

export type DeveloperScope = (typeof developerScopes)[number];
export type ApiTokenContext = {
  id: string;
  organizationId: string;
  name: string;
  scopes: DeveloperScope[];
  eventIds: string[];
  hidePii: boolean;
  createdBy: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64ToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function secretKey(secret: string, usage: KeyUsage[]) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, usage);
}

export async function encryptDeveloperSecret(env: Env, value: string) {
  if (!env.DEVELOPER_SECRET_KEY)
    throw new Error("Developer secret encryption is not configured.");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await secretKey(env.DEVELOPER_SECRET_KEY, ["encrypt"]),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(nonce)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptDeveloperSecret(env: Env, value: string) {
  if (!env.DEVELOPER_SECRET_KEY)
    throw new Error("Developer secret encryption is not configured.");
  const [nonce, ciphertext] = value.split(".");
  if (!nonce || !ciphertext) throw new Error("Invalid encrypted secret.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(nonce) },
    await secretKey(env.DEVELOPER_SECRET_KEY, ["decrypt"]),
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function queueDeveloperWebhookAudits(env: Env, requestId: string) {
  if (!env.DB) return 0;
  const db = database(env);
  const audits = await db
    .prepare(
      `SELECT id,organization_id organizationId,event_id eventId,action,entity_type entityType,
              entity_id entityId,created_at createdAt
       FROM audit_events WHERE request_id=? ORDER BY created_at,id LIMIT 250`,
    )
    .bind(requestId)
    .all<Record<string, unknown>>();
  let queued = 0;
  for (const audit of audits.results) {
    const sequence = Number(
      (
        await db
          .prepare(
            `SELECT COUNT(*) count FROM audit_events WHERE organization_id=? AND entity_type=? AND entity_id=?
             AND (created_at<? OR (created_at=? AND id<=?))`,
          )
          .bind(
            audit.organizationId,
            audit.entityType,
            audit.entityId,
            audit.createdAt,
            audit.createdAt,
            audit.id,
          )
          .first<{ count: number }>()
      )?.count ?? 1,
    );
    const subscriptions = await db
      .prepare(
        `SELECT id,event_ids_json eventIdsJson,entity_types_json entityTypesJson
         FROM api_webhook_subscriptions WHERE organization_id=? AND enabled=1`,
      )
      .bind(audit.organizationId)
      .all<Record<string, unknown>>();
    for (const subscription of subscriptions.results) {
      const eventIds = JSON.parse(
        String(subscription.eventIdsJson),
      ) as string[];
      const entityTypes = JSON.parse(
        String(subscription.entityTypesJson),
      ) as string[];
      if (eventIds.length && !eventIds.includes(String(audit.eventId ?? "")))
        continue;
      if (entityTypes.length && !entityTypes.includes(String(audit.entityType)))
        continue;
      const id = crypto.randomUUID();
      const payload = {
        deliveryId: id,
        auditEventId: audit.id,
        eventId: audit.eventId ?? null,
        entityType: audit.entityType,
        entityId: audit.entityId,
        action: audit.action,
        timestamp: audit.createdAt,
        sequence,
      };
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO api_webhook_deliveries
           (id,subscription_id,organization_id,event_id,audit_event_id,entity_type,entity_id,action,payload_json)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          subscription.id,
          audit.organizationId,
          audit.eventId ?? null,
          audit.id,
          audit.entityType,
          audit.entityId,
          audit.action,
          JSON.stringify(payload),
        )
        .run();
      if (!result.meta.changes) continue;
      queued += 1;
      await env.JOBS?.send({ kind: "developer_webhook", deliveryId: id });
    }
  }
  return queued;
}

export async function processDeveloperWebhook(env: Env, deliveryId: string) {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  const db = database(env);
  const delivery = await db
    .prepare(
      `SELECT d.id,d.subscription_id subscriptionId,d.organization_id organizationId,d.event_id eventId,
              d.payload_json payloadJson,d.status,d.attempts,s.name subscriptionName,s.created_by createdBy,
              s.endpoint_url endpointUrl,s.secret_ciphertext secretCiphertext,s.enabled
       FROM api_webhook_deliveries d JOIN api_webhook_subscriptions s ON s.id=d.subscription_id
       WHERE d.id=?`,
    )
    .bind(deliveryId)
    .first<Record<string, unknown>>();
  if (!delivery || ["delivered", "cancelled"].includes(String(delivery.status)))
    return { retry: false };
  if (!delivery.enabled) {
    await db
      .prepare(
        "UPDATE api_webhook_deliveries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(deliveryId)
      .run();
    return { retry: false };
  }
  const attempts = Number(delivery.attempts) + 1;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = String(delivery.payloadJson);
  try {
    const claimed = await db
      .prepare(
        "UPDATE api_webhook_deliveries SET status='processing',attempts=?,last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','retrying')",
      )
      .bind(attempts, deliveryId)
      .run();
    if (!claimed.meta.changes) return { retry: false };
    const secret = await decryptDeveloperSecret(
      env,
      String(delivery.secretCiphertext),
    );
    const response = await fetch(String(delivery.endpointUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "ProgramLoom-Webhooks/1.0",
        "x-programloom-delivery": deliveryId,
        "x-programloom-timestamp": timestamp,
        "x-programloom-signature": `v1=${await signWebhook(secret, timestamp, body)}`,
      },
      body,
    });
    if (response.ok) {
      const success = db
        .prepare(
          `UPDATE api_webhook_deliveries SET status='delivered',response_status=?,delivered_at=CURRENT_TIMESTAMP,
           failure_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='cancelled'`,
        )
        .bind(response.status, deliveryId);
      if (attempts > 1)
        await db.batch([
          success,
          auditStatement(db, {
            organizationId: String(delivery.organizationId),
            eventId: delivery.eventId ? String(delivery.eventId) : undefined,
            actorUserId: String(delivery.createdBy),
            action: "api_webhook.delivery_recovered",
            entityType: "api_webhook_delivery",
            entityId: deliveryId,
            after: { status: "delivered", attempts },
            requestId: deliveryId,
          }),
          eventManagerNotificationStatement(db, {
            organizationId: String(delivery.organizationId),
            eventId: delivery.eventId ? String(delivery.eventId) : undefined,
            category: "integration",
            notificationType: "integration.webhook_recovered",
            severity: "info",
            title: "Webhook delivery recovered",
            body: `${String(delivery.subscriptionName)} delivered successfully after ${attempts} attempts.`,
            actionUrl: "/app/settings?tab=webhooks",
            entityType: "api_webhook_delivery",
            entityId: deliveryId,
            coalesceKey: `webhook-recovered:${deliveryId}`,
          }),
        ]);
      else await success.run();
      return { retry: false };
    }
    throw new Error(`Endpoint returned HTTP ${response.status}.`);
  } catch (error) {
    const terminal = attempts >= 8;
    const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
    const failure = db
      .prepare(
        `UPDATE api_webhook_deliveries SET status=?,failure_reason=?,next_attempt_at=datetime('now',?),
         updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('delivered','cancelled')`,
      )
      .bind(
        terminal ? "failed" : "retrying",
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Delivery failed.",
        `+${delaySeconds} seconds`,
        deliveryId,
      );
    if (terminal)
      await db.batch([
        failure,
        auditStatement(db, {
          organizationId: String(delivery.organizationId),
          eventId: delivery.eventId ? String(delivery.eventId) : undefined,
          actorUserId: String(delivery.createdBy),
          action: "api_webhook.delivery_exhausted",
          entityType: "api_webhook_delivery",
          entityId: deliveryId,
          after: { status: "failed", attempts },
          requestId: deliveryId,
        }),
        eventManagerNotificationStatement(db, {
          organizationId: String(delivery.organizationId),
          eventId: delivery.eventId ? String(delivery.eventId) : undefined,
          category: "integration",
          notificationType: "integration.webhook_failed",
          severity: "blocking",
          title: "Webhook delivery needs intervention",
          body: `${String(delivery.subscriptionName)} exhausted ${attempts} delivery attempts.`,
          actionUrl: "/app/settings?tab=webhooks",
          entityType: "api_webhook_delivery",
          entityId: deliveryId,
          coalesceKey: `webhook-failed:${deliveryId}`,
        }),
      ]);
    else await failure.run();
    return { retry: !terminal, delaySeconds };
  }
}

export async function dispatchPendingDeveloperWebhooks(env: Env) {
  if (!env.DB || !env.JOBS) return 0;
  const db = database(env);
  await db
    .prepare(
      `UPDATE api_webhook_deliveries SET status='retrying',next_attempt_at=CURRENT_TIMESTAMP,
       failure_reason='Recovered an interrupted delivery.',updated_at=CURRENT_TIMESTAMP
       WHERE status='processing' AND last_attempt_at<datetime('now','-10 minutes')`,
    )
    .run();
  const rows = await db
    .prepare(
      `SELECT id FROM api_webhook_deliveries WHERE status IN ('queued','retrying')
       AND next_attempt_at<=CURRENT_TIMESTAMP ORDER BY next_attempt_at,id LIMIT 100`,
    )
    .all<{ id: string }>();
  for (const row of rows.results)
    await env.JOBS.send({ kind: "developer_webhook", deliveryId: row.id });
  return rows.results.length;
}

export async function requestHash(value: unknown) {
  return sha256(JSON.stringify(value));
}
