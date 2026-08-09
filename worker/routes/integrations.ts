import { Hono } from "hono";
import type { Env } from "../env";
import {
  dispatchPendingAirtableOutbox,
  integrationStatus,
  queueAirtableReconciliation,
  reconcileAirtableOrganization,
  verifyAirtableWebhook,
} from "../lib/airtable";
import { database, HttpError, requireOrganizationRole } from "../lib/authz";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.post("/airtable/webhook/:pathSecret", async (context) => {
  if (
    !context.env.AIRTABLE_WEBHOOK_PATH_SECRET ||
    !constantTimeEqual(
      context.req.param("pathSecret"),
      context.env.AIRTABLE_WEBHOOK_PATH_SECRET,
    )
  )
    throw new HttpError(404, "webhook_not_found", "Webhook not found.");
  const rawBody = await context.req.raw.text();
  if (
    context.env.AIRTABLE_WEBHOOK_MAC_SECRET &&
    !(await verifyAirtableWebhook(
      context.env,
      rawBody,
      context.req.header("x-airtable-content-mac"),
    ))
  )
    throw new HttpError(
      403,
      "invalid_webhook_signature",
      "Invalid webhook signature.",
    );
  await queueAirtableReconciliation(context.env);
  return context.body(null, 204);
});

router.get("/organizations/:organizationId/airtable", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
  const organization = await database(context.env)
    .prepare("SELECT storage_mode AS storageMode FROM organizations WHERE id=?")
    .bind(organizationId)
    .first<{ storageMode: string }>();
  return context.json({
    storageMode: organization?.storageMode,
    ...(await integrationStatus(context.env, organizationId)),
  });
});

router.post("/organizations/:organizationId/airtable/sync", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
  await dispatchPendingAirtableOutbox(context.env);
  await reconcileAirtableOrganization(context.env, organizationId);
  return context.json({
    ok: true,
    status: await integrationStatus(context.env, organizationId),
  });
});

router.post(
  "/organizations/:organizationId/airtable/conflicts/:conflictId/retry",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
    const db = database(context.env);
    const conflict = await db
      .prepare(
        `SELECT entity_type AS entityType,entity_id AS entityId,direction
         FROM integration_conflicts
         WHERE id=? AND organization_id=? AND integration='airtable' AND status='open'`,
      )
      .bind(context.req.param("conflictId"), organizationId)
      .first<{ entityType: string; entityId: string; direction: string }>();
    if (!conflict)
      throw new HttpError(
        404,
        "conflict_not_found",
        "Sync conflict not found.",
      );
    await db.batch([
      db
        .prepare(
          `UPDATE integration_conflicts SET status='resolved',resolved_at=CURRENT_TIMESTAMP
           WHERE id=? AND organization_id=?`,
        )
        .bind(context.req.param("conflictId"), organizationId),
      db
        .prepare(
          `UPDATE integration_outbox SET attempts=0,last_error=NULL,available_at=CURRENT_TIMESTAMP
           WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=? AND completed_at IS NULL`,
        )
        .bind(organizationId, conflict.entityType, conflict.entityId),
    ]);
    await dispatchPendingAirtableOutbox(context.env);
    if (conflict.direction === "pull")
      await reconcileAirtableOrganization(context.env, organizationId);
    return context.json({ ok: true });
  },
);

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export default router;
