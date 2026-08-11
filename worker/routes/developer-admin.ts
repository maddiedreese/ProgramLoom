import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireOrganizationRole } from "../lib/authz";
import { randomToken, sha256 } from "../lib/crypto";
import {
  developerScopes,
  encryptDeveloperSecret,
} from "../lib/developerPlatform";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const scope = z.enum(developerScopes);
const tokenSchema = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(scope).min(1).max(developerScopes.length),
  eventIds: z.array(z.uuid()).max(100).default([]),
  hidePii: z.boolean().default(true),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
const tokenEditSchema = tokenSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Choose at least one setting to update.",
  );
const webhookSchema = z.object({
  name: z.string().trim().min(2).max(120),
  endpointUrl: z.url().refine((value) => value.startsWith("https://"), {
    message: "Webhook endpoints must use HTTPS.",
  }),
  eventIds: z.array(z.uuid()).max(100).default([]),
  entityTypes: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  enabled: z.boolean().default(true),
});
const oauthClientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  redirectUris: z
    .array(z.url().refine((value) => value.startsWith("https://")))
    .min(1)
    .max(20),
  scopes: z.array(scope).min(1).max(developerScopes.length),
  confidential: z.boolean().default(false),
});

async function validateEventRestrictions(
  db: D1Database,
  organizationId: string,
  eventIds: string[] | undefined,
) {
  if (!eventIds?.length) return;
  const rows = await db
    .prepare(
      `SELECT id FROM events WHERE organization_id=? AND id IN (${eventIds.map(() => "?").join(",")})`,
    )
    .bind(organizationId, ...eventIds)
    .all<{ id: string }>();
  if (rows.results.length !== new Set(eventIds).size)
    throw new HttpError(
      400,
      "invalid_event_restriction",
      "Every event restriction must belong to this organization.",
    );
}

router.get("/organizations/:organizationId", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
  const db = database(context.env);
  const [tokens, webhooks, clients, usage] = await Promise.all([
    db
      .prepare(
        `SELECT id,name,token_prefix tokenPrefix,scopes_json scopesJson,event_ids_json eventIdsJson,
         hide_pii hidePii,expires_at expiresAt,last_used_at lastUsedAt,revoked_at revokedAt,
         created_at createdAt,updated_at updatedAt FROM api_tokens
         WHERE organization_id=? ORDER BY created_at DESC LIMIT 250`,
      )
      .bind(organizationId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT s.id,s.name,s.endpoint_url endpointUrl,s.event_ids_json eventIdsJson,
         s.entity_types_json entityTypesJson,s.enabled,s.created_at createdAt,s.updated_at updatedAt,
         COUNT(d.id) deliveryCount,SUM(CASE WHEN d.status='failed' THEN 1 ELSE 0 END) failedCount
         FROM api_webhook_subscriptions s LEFT JOIN api_webhook_deliveries d ON d.subscription_id=s.id
         WHERE s.organization_id=? GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 250`,
      )
      .bind(organizationId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id,name,redirect_uris_json redirectUrisJson,scopes_json scopesJson,
         CASE WHEN client_secret_hash IS NULL THEN 0 ELSE 1 END confidential,
         created_at createdAt,revoked_at revokedAt FROM oauth_clients
         WHERE organization_id=? ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(organizationId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT token_id tokenId,COUNT(*) requests,SUM(CASE WHEN result_status>=400 THEN 1 ELSE 0 END) failures,
         MAX(created_at) lastRequestAt FROM api_usage_events WHERE organization_id=?
         AND created_at>=datetime('now','-30 days') GROUP BY token_id`,
      )
      .bind(organizationId)
      .all<Record<string, unknown>>(),
  ]);
  return context.json({
    scopes: developerScopes,
    tokens: tokens.results.map((row) => ({
      ...row,
      scopes: JSON.parse(String(row.scopesJson)),
      eventIds: JSON.parse(String(row.eventIdsJson)),
      hidePii: Boolean(row.hidePii),
      scopesJson: undefined,
      eventIdsJson: undefined,
    })),
    webhooks: webhooks.results.map((row) => ({
      ...row,
      eventIds: JSON.parse(String(row.eventIdsJson)),
      entityTypes: JSON.parse(String(row.entityTypesJson)),
      enabled: Boolean(row.enabled),
      eventIdsJson: undefined,
      entityTypesJson: undefined,
    })),
    oauthClients: clients.results.map((row) => ({
      ...row,
      redirectUris: JSON.parse(String(row.redirectUrisJson)),
      scopes: JSON.parse(String(row.scopesJson)),
      confidential: Boolean(row.confidential),
      redirectUrisJson: undefined,
      scopesJson: undefined,
    })),
    usage: usage.results,
  });
});

router.post(
  "/organizations/:organizationId/tokens",
  zValidator("json", tokenSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await validateEventRestrictions(db, organizationId, input.eventIds);
    const id = crypto.randomUUID();
    const token = `pl_live_${randomToken(32)}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO api_tokens
           (id,organization_id,name,token_prefix,token_hash,scopes_json,event_ids_json,hide_pii,expires_at,created_by)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          organizationId,
          input.name,
          token.slice(0, 16),
          await sha256(token),
          JSON.stringify([...new Set(input.scopes)]),
          JSON.stringify([...new Set(input.eventIds)]),
          input.hidePii ? 1 : 0,
          input.expiresAt,
          access.user.id,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: access.user.id,
        action: "api_token.created",
        entityType: "api_token",
        entityId: id,
        after: { ...input, token: undefined },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(
      {
        token: {
          id,
          name: input.name,
          value: token,
          revealOnce: true,
          scopes: input.scopes,
          eventIds: input.eventIds,
          hidePii: input.hidePii,
          expiresAt: input.expiresAt,
        },
      },
      201,
    );
  },
);

router.patch(
  "/organizations/:organizationId/tokens/:tokenId",
  zValidator("json", tokenEditSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await validateEventRestrictions(db, organizationId, input.eventIds);
    const before = await db
      .prepare("SELECT * FROM api_tokens WHERE id=? AND organization_id=?")
      .bind(context.req.param("tokenId"), organizationId)
      .first<Record<string, unknown>>();
    if (!before)
      throw new HttpError(404, "api_token_not_found", "API token not found.");
    await db.batch([
      db
        .prepare(
          `UPDATE api_tokens SET name=COALESCE(?,name),scopes_json=COALESCE(?,scopes_json),
           event_ids_json=COALESCE(?,event_ids_json),hide_pii=COALESCE(?,hide_pii),
           expires_at=CASE WHEN ? THEN ? ELSE expires_at END,updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND organization_id=?`,
        )
        .bind(
          input.name ?? null,
          input.scopes ? JSON.stringify([...new Set(input.scopes)]) : null,
          input.eventIds ? JSON.stringify([...new Set(input.eventIds)]) : null,
          input.hidePii === undefined ? null : input.hidePii ? 1 : 0,
          Object.hasOwn(input, "expiresAt") ? 1 : 0,
          input.expiresAt ?? null,
          context.req.param("tokenId"),
          organizationId,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: access.user.id,
        action: "api_token.updated",
        entityType: "api_token",
        entityId: context.req.param("tokenId"),
        before: {
          name: before.name,
          scopes: JSON.parse(String(before.scopes_json)),
          eventIds: JSON.parse(String(before.event_ids_json)),
          hidePii: Boolean(before.hide_pii),
          expiresAt: before.expires_at,
        },
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ ok: true });
  },
);

router.post(
  "/organizations/:organizationId/tokens/:tokenId/rotate",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const token = `pl_live_${randomToken(32)}`;
    const db = database(context.env);
    const result = await db
      .prepare(
        `UPDATE api_tokens SET token_hash=?,token_prefix=?,last_used_at=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND organization_id=? AND revoked_at IS NULL`,
      )
      .bind(
        await sha256(token),
        token.slice(0, 16),
        context.req.param("tokenId"),
        organizationId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "api_token_not_found",
        "Active API token not found.",
      );
    await auditStatement(db, {
      organizationId,
      actorUserId: access.user.id,
      action: "api_token.rotated",
      entityType: "api_token",
      entityId: context.req.param("tokenId"),
      after: { rotated: true },
      requestId: context.get("requestId"),
    }).run();
    return context.json({ value: token, revealOnce: true });
  },
);

router.delete(
  "/organizations/:organizationId/tokens/:tokenId",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const db = database(context.env);
    const result = await db
      .prepare(
        "UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND revoked_at IS NULL",
      )
      .bind(context.req.param("tokenId"), organizationId)
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "api_token_not_found",
        "Active API token not found.",
      );
    await auditStatement(db, {
      organizationId,
      actorUserId: access.user.id,
      action: "api_token.revoked",
      entityType: "api_token",
      entityId: context.req.param("tokenId"),
      after: { revoked: true },
      requestId: context.get("requestId"),
    }).run();
    return context.body(null, 204);
  },
);

router.post(
  "/organizations/:organizationId/webhooks",
  zValidator("json", webhookSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await validateEventRestrictions(db, organizationId, input.eventIds);
    const id = crypto.randomUUID();
    const secret = `whsec_${randomToken(32)}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO api_webhook_subscriptions
           (id,organization_id,name,endpoint_url,secret_ciphertext,event_ids_json,entity_types_json,enabled,created_by)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          organizationId,
          input.name,
          input.endpointUrl,
          await encryptDeveloperSecret(context.env, secret),
          JSON.stringify(input.eventIds),
          JSON.stringify(input.entityTypes),
          input.enabled ? 1 : 0,
          access.user.id,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: access.user.id,
        action: "api_webhook.created",
        entityType: "api_webhook_subscription",
        entityId: id,
        after: { ...input, secret: undefined },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(
      { webhook: { id, ...input, secret, revealOnce: true } },
      201,
    );
  },
);

router.patch(
  "/organizations/:organizationId/webhooks/:subscriptionId",
  zValidator("json", webhookSchema.partial()),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await validateEventRestrictions(db, organizationId, input.eventIds);
    const result = await db
      .prepare(
        `UPDATE api_webhook_subscriptions SET name=COALESCE(?,name),endpoint_url=COALESCE(?,endpoint_url),
         event_ids_json=COALESCE(?,event_ids_json),entity_types_json=COALESCE(?,entity_types_json),
         enabled=COALESCE(?,enabled),disabled_at=CASE WHEN ?=0 THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`,
      )
      .bind(
        input.name ?? null,
        input.endpointUrl ?? null,
        input.eventIds ? JSON.stringify(input.eventIds) : null,
        input.entityTypes ? JSON.stringify(input.entityTypes) : null,
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        context.req.param("subscriptionId"),
        organizationId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "webhook_not_found",
        "Webhook subscription not found.",
      );
    await auditStatement(db, {
      organizationId,
      actorUserId: access.user.id,
      action: "api_webhook.updated",
      entityType: "api_webhook_subscription",
      entityId: context.req.param("subscriptionId"),
      after: input,
      requestId: context.get("requestId"),
    }).run();
    return context.json({ ok: true });
  },
);

router.post(
  "/organizations/:organizationId/webhooks/:subscriptionId/rotate",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const secret = `whsec_${randomToken(32)}`;
    const db = database(context.env);
    const result = await db
      .prepare(
        "UPDATE api_webhook_subscriptions SET secret_ciphertext=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?",
      )
      .bind(
        await encryptDeveloperSecret(context.env, secret),
        context.req.param("subscriptionId"),
        organizationId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "webhook_not_found",
        "Webhook subscription not found.",
      );
    await auditStatement(db, {
      organizationId,
      actorUserId: access.user.id,
      action: "api_webhook.secret_rotated",
      entityType: "api_webhook_subscription",
      entityId: context.req.param("subscriptionId"),
      after: { rotated: true },
      requestId: context.get("requestId"),
    }).run();
    return context.json({ secret, revealOnce: true });
  },
);

router.get(
  "/organizations/:organizationId/webhooks/:subscriptionId/deliveries",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
    const rows = await database(context.env)
      .prepare(
        `SELECT id,event_id eventId,entity_type entityType,entity_id entityId,action,status,attempts,
       response_status responseStatus,failure_reason failureReason,created_at createdAt,last_attempt_at lastAttemptAt,
       delivered_at deliveredAt FROM api_webhook_deliveries
       WHERE organization_id=? AND subscription_id=? ORDER BY created_at DESC LIMIT 250`,
      )
      .bind(organizationId, context.req.param("subscriptionId"))
      .all();
    return context.json({ deliveries: rows.results });
  },
);

router.post(
  "/organizations/:organizationId/webhook-deliveries/:deliveryId/retry",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const db = database(context.env);
    const result = await db
      .prepare(
        `UPDATE api_webhook_deliveries SET status='queued',next_attempt_at=CURRENT_TIMESTAMP,
       failure_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status IN ('failed','retrying')`,
      )
      .bind(context.req.param("deliveryId"), organizationId)
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        409,
        "webhook_not_retryable",
        "This delivery is not retryable.",
      );
    await context.env.JOBS?.send({
      kind: "developer_webhook",
      deliveryId: context.req.param("deliveryId"),
    });
    await auditStatement(db, {
      organizationId,
      actorUserId: access.user.id,
      action: "api_webhook.delivery_retried",
      entityType: "api_webhook_delivery",
      entityId: context.req.param("deliveryId"),
      after: { status: "queued" },
      requestId: context.get("requestId"),
    }).run();
    return context.json({ ok: true });
  },
);

router.post(
  "/organizations/:organizationId/oauth-clients",
  zValidator("json", oauthClientSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const id = `pl_client_${randomToken(18)}`;
    const clientSecret = input.confidential
      ? `pl_secret_${randomToken(32)}`
      : null;
    const db = database(context.env);
    await db.batch([
      db
        .prepare(
          `INSERT INTO oauth_clients
           (id,organization_id,name,redirect_uris_json,client_secret_hash,scopes_json,created_by)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          organizationId,
          input.name,
          JSON.stringify(input.redirectUris),
          clientSecret ? await sha256(clientSecret) : null,
          JSON.stringify(input.scopes),
          access.user.id,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: access.user.id,
        action: "oauth_client.created",
        entityType: "oauth_client",
        entityId: id,
        after: { ...input, clientSecret: undefined },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(
      {
        client: {
          id,
          ...input,
          clientSecret,
          revealOnce: Boolean(clientSecret),
        },
      },
      201,
    );
  },
);

router.patch(
  "/organizations/:organizationId/oauth-clients/:clientId",
  zValidator(
    "json",
    oauthClientSchema
      .omit({ confidential: true })
      .partial()
      .refine((value) => Object.keys(value).length > 0, {
        message: "Choose at least one client setting to update.",
      }),
  ),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const before = await db
      .prepare(
        "SELECT name,redirect_uris_json redirectUrisJson,scopes_json scopesJson FROM oauth_clients WHERE id=? AND organization_id=? AND revoked_at IS NULL",
      )
      .bind(context.req.param("clientId"), organizationId)
      .first<Record<string, unknown>>();
    if (!before)
      throw new HttpError(
        404,
        "oauth_client_not_found",
        "Active OAuth client not found.",
      );
    await db.batch([
      db
        .prepare(
          `UPDATE oauth_clients SET name=COALESCE(?,name),redirect_uris_json=COALESCE(?,redirect_uris_json),
           scopes_json=COALESCE(?,scopes_json) WHERE id=? AND organization_id=? AND revoked_at IS NULL`,
        )
        .bind(
          input.name ?? null,
          input.redirectUris ? JSON.stringify(input.redirectUris) : null,
          input.scopes ? JSON.stringify(input.scopes) : null,
          context.req.param("clientId"),
          organizationId,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: access.user.id,
        action: "oauth_client.updated",
        entityType: "oauth_client",
        entityId: context.req.param("clientId"),
        before: {
          name: before.name,
          redirectUris: JSON.parse(String(before.redirectUrisJson)),
          scopes: JSON.parse(String(before.scopesJson)),
        },
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ ok: true });
  },
);

router.post(
  "/organizations/:organizationId/oauth-clients/:clientId/rotate-secret",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const secret = `pl_secret_${randomToken(32)}`;
    const db = database(context.env);
    const result = await db
      .prepare(
        `UPDATE oauth_clients SET client_secret_hash=? WHERE id=? AND organization_id=?
         AND client_secret_hash IS NOT NULL AND revoked_at IS NULL`,
      )
      .bind(await sha256(secret), context.req.param("clientId"), organizationId)
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "oauth_client_not_found",
        "Active confidential OAuth client not found.",
      );
    await auditStatement(db, {
      organizationId,
      actorUserId: access.user.id,
      action: "oauth_client.secret_rotated",
      entityType: "oauth_client",
      entityId: context.req.param("clientId"),
      after: { rotated: true },
      requestId: context.get("requestId"),
    }).run();
    return context.json({ clientSecret: secret, revealOnce: true });
  },
);

router.delete(
  "/organizations/:organizationId/oauth-clients/:clientId",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const access = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const db = database(context.env);
    const result = await db
      .prepare(
        "UPDATE oauth_clients SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND revoked_at IS NULL",
      )
      .bind(context.req.param("clientId"), organizationId)
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        404,
        "oauth_client_not_found",
        "Active OAuth client not found.",
      );
    await db.batch([
      db
        .prepare(
          `UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id IN
           (SELECT api_token_id FROM oauth_refresh_tokens WHERE client_id=?) AND revoked_at IS NULL`,
        )
        .bind(context.req.param("clientId")),
      db
        .prepare(
          "UPDATE oauth_refresh_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE client_id=? AND revoked_at IS NULL",
        )
        .bind(context.req.param("clientId")),
      auditStatement(db, {
        organizationId,
        actorUserId: access.user.id,
        action: "oauth_client.revoked",
        entityType: "oauth_client",
        entityId: context.req.param("clientId"),
        after: { revoked: true },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.body(null, 204);
  },
);

export default router;
