import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import {
  database,
  HttpError,
  requireEventRole,
  requireOrganizationRole,
  requireUser,
} from "../lib/authz";
import type { NotificationCategory } from "../lib/operations";

type Variables = { requestId: string };

export const notificationCategories = [
  "submission",
  "review",
  "decision",
  "speaker",
  "task",
  "file",
  "content",
  "agenda",
  "delivery",
  "queue",
  "airtable",
  "integration",
] as const;

const listSchema = z.object({
  eventId: z.string().uuid().optional(),
  category: z.enum(notificationCategories).optional(),
  severity: z.enum(["info", "warning", "blocking"]).optional(),
  read: z.enum(["read", "unread"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});
const readSchema = z.object({ read: z.boolean() });
const preferencesQuery = z.object({
  organizationId: z.string().uuid(),
  eventId: z.string().uuid().optional(),
});
const preferenceSchema = preferencesQuery.extend({
  category: z.enum(notificationCategories),
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
});

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.get("/", zValidator("query", listSchema), async (context) => {
  const user = await requireUser(context);
  const input = context.req.valid("query");
  const db = database(context.env);
  const where = [
    "n.recipient_user_id=?",
    "n.archived_at IS NULL",
    `COALESCE(
      (SELECT in_app_enabled FROM notification_preferences np
       WHERE np.organization_id=n.organization_id AND np.event_id IS n.event_id
         AND np.user_id=n.recipient_user_id AND np.category=n.category),
      (SELECT in_app_enabled FROM notification_preferences np
       WHERE np.organization_id=n.organization_id AND np.event_id IS NULL
         AND np.user_id=n.recipient_user_id AND np.category=n.category),1
     )=1`,
  ];
  const values: unknown[] = [user.id];
  if (input.eventId) {
    where.push("n.event_id=?");
    values.push(input.eventId);
  }
  if (input.category) {
    where.push("n.category=?");
    values.push(input.category);
  }
  if (input.severity) {
    where.push("n.severity=?");
    values.push(input.severity);
  }
  if (input.read)
    where.push(
      input.read === "read" ? "n.read_at IS NOT NULL" : "n.read_at IS NULL",
    );
  const clause = where.join(" AND ");
  const offset = (input.page - 1) * input.pageSize;
  const [items, totals, globalTotals, events, organizations] =
    await Promise.all([
      db
        .prepare(
          `SELECT n.id,n.organization_id organizationId,n.event_id eventId,e.name eventName,
         n.category,n.notification_type notificationType,n.severity,n.title,n.body,
         n.action_url actionUrl,n.entity_type entityType,n.entity_id entityId,
         n.occurrence_count occurrenceCount,n.first_occurred_at firstOccurredAt,
         n.last_occurred_at lastOccurredAt,n.read_at readAt
         FROM notifications n LEFT JOIN events e ON e.id=n.event_id
         WHERE ${clause}
         ORDER BY CASE n.severity WHEN 'blocking' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           n.last_occurred_at DESC,n.id LIMIT ? OFFSET ?`,
        )
        .bind(...values, input.pageSize, offset)
        .all(),
      db
        .prepare(
          `SELECT COUNT(*) total,
         SUM(CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END) unread
         FROM notifications n WHERE ${clause}`,
        )
        .bind(...values)
        .first<{ total: number; unread: number | null }>(),
      db
        .prepare(
          `SELECT COUNT(*) unread FROM notifications
         WHERE recipient_user_id=? AND archived_at IS NULL AND read_at IS NULL
         AND COALESCE(
           (SELECT in_app_enabled FROM notification_preferences np
            WHERE np.organization_id=notifications.organization_id AND np.event_id IS notifications.event_id
              AND np.user_id=notifications.recipient_user_id AND np.category=notifications.category),
           (SELECT in_app_enabled FROM notification_preferences np
            WHERE np.organization_id=notifications.organization_id AND np.event_id IS NULL
              AND np.user_id=notifications.recipient_user_id AND np.category=notifications.category),1
         )=1`,
        )
        .bind(user.id)
        .first<{ unread: number }>(),
      db
        .prepare(
          `SELECT DISTINCT e.id,e.name,e.organization_id organizationId
         FROM events e
         LEFT JOIN organization_members om ON om.organization_id=e.organization_id AND om.user_id=?
         LEFT JOIN event_members em ON em.event_id=e.id AND em.user_id=?
         WHERE om.role IN ('owner','admin','member') OR em.role IN ('owner','admin','reviewer','speaker')
         ORDER BY e.name LIMIT 100`,
        )
        .bind(user.id, user.id)
        .all<{ id: string; name: string; organizationId: string }>(),
      db
        .prepare(
          `SELECT DISTINCT o.id,o.name FROM organizations o
         LEFT JOIN organization_members om ON om.organization_id=o.id AND om.user_id=?
         LEFT JOIN events e ON e.organization_id=o.id
         LEFT JOIN event_members em ON em.event_id=e.id AND em.user_id=?
         WHERE om.role IN ('owner','admin','member') OR em.role IN ('owner','admin','reviewer','speaker')
         ORDER BY o.name LIMIT 50`,
        )
        .bind(user.id, user.id)
        .all<{ id: string; name: string }>(),
    ]);
  return context.json({
    notifications: items.results,
    events: events.results,
    organizations: organizations.results,
    page: input.page,
    pageSize: input.pageSize,
    total: totals?.total ?? 0,
    unread: totals?.unread ?? 0,
    globalUnread: globalTotals?.unread ?? 0,
    hasMore: offset + items.results.length < (totals?.total ?? 0),
  });
});

router.patch(
  "/:notificationId",
  zValidator("json", readSchema),
  async (context) => {
    const user = await requireUser(context);
    const id = context.req.param("notificationId");
    const input = context.req.valid("json");
    const db = database(context.env);
    const existing = await db
      .prepare(
        "SELECT id FROM notifications WHERE id=? AND recipient_user_id=? AND archived_at IS NULL",
      )
      .bind(id, user.id)
      .first();
    if (!existing)
      throw new HttpError(
        404,
        "notification_not_found",
        "Notification not found.",
      );
    await db
      .prepare(
        "UPDATE notifications SET read_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND recipient_user_id=?",
      )
      .bind(input.read ? new Date().toISOString() : null, id, user.id)
      .run();
    return context.json({ notification: { id, read: input.read } });
  },
);

router.post(
  "/read-all",
  zValidator(
    "json",
    listSchema.pick({ eventId: true, category: true, severity: true }),
  ),
  async (context) => {
    const user = await requireUser(context);
    const input = context.req.valid("json");
    const where = [
      "recipient_user_id=?",
      "archived_at IS NULL",
      "read_at IS NULL",
    ];
    const values: unknown[] = [user.id];
    if (input.eventId) {
      where.push("event_id=?");
      values.push(input.eventId);
    }
    if (input.category) {
      where.push("category=?");
      values.push(input.category);
    }
    if (input.severity) {
      where.push("severity=?");
      values.push(input.severity);
    }
    const result = await database(context.env)
      .prepare(
        `UPDATE notifications SET read_at=?,updated_at=CURRENT_TIMESTAMP WHERE ${where.join(" AND ")}`,
      )
      .bind(new Date().toISOString(), ...values)
      .run();
    return context.json({ updated: result.meta.changes ?? 0 });
  },
);

router.get(
  "/preferences",
  zValidator("query", preferencesQuery),
  async (context) => {
    const user = await requireUser(context);
    const input = context.req.valid("query");
    await requirePreferenceScope(context, input.organizationId, input.eventId);
    const rows = await database(context.env)
      .prepare(
        `SELECT category,event_id eventId,in_app_enabled inAppEnabled,email_enabled emailEnabled
         FROM notification_preferences WHERE organization_id=? AND user_id=?
         AND (event_id IS NULL OR (? IS NOT NULL AND event_id=?))
         ORDER BY category,event_id IS NOT NULL DESC`,
      )
      .bind(
        input.organizationId,
        user.id,
        input.eventId ?? null,
        input.eventId ?? null,
      )
      .all<{
        category: NotificationCategory;
        eventId: string | null;
        inAppEnabled: number;
        emailEnabled: number;
      }>();
    const stored = new Map<
      NotificationCategory,
      (typeof rows.results)[number]
    >();
    for (const item of rows.results)
      if (!stored.has(item.category)) stored.set(item.category, item);
    return context.json({
      preferences: notificationCategories.map((category) => ({
        category,
        inAppEnabled: Boolean(stored.get(category)?.inAppEnabled ?? 1),
        emailEnabled: Boolean(stored.get(category)?.emailEnabled ?? 0),
        inherited: Boolean(input.eventId && !stored.get(category)?.eventId),
      })),
    });
  },
);

router.put(
  "/preferences",
  zValidator("json", preferenceSchema),
  async (context) => {
    const user = await requireUser(context);
    const input = context.req.valid("json");
    await requirePreferenceScope(context, input.organizationId, input.eventId);
    const db = database(context.env);
    const existing = await db
      .prepare(
        `SELECT id,in_app_enabled inAppEnabled,email_enabled emailEnabled
         FROM notification_preferences WHERE organization_id=? AND user_id=? AND category=?
         AND ((event_id IS NULL AND ? IS NULL) OR event_id=?)`,
      )
      .bind(
        input.organizationId,
        user.id,
        input.category,
        input.eventId ?? null,
        input.eventId ?? null,
      )
      .first<{ id: string; inAppEnabled: number; emailEnabled: number }>();
    const id = existing?.id ?? crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO notification_preferences
           (id,organization_id,event_id,user_id,category,in_app_enabled,email_enabled)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET
           in_app_enabled=excluded.in_app_enabled,email_enabled=excluded.email_enabled,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          id,
          input.organizationId,
          input.eventId ?? null,
          user.id,
          input.category,
          input.inAppEnabled ? 1 : 0,
          input.emailEnabled ? 1 : 0,
        ),
      auditStatement(db, {
        organizationId: input.organizationId,
        eventId: input.eventId,
        actorUserId: user.id,
        action: "notification.preference_changed",
        entityType: "notification_preference",
        entityId: id,
        before: existing
          ? {
              inAppEnabled: Boolean(existing.inAppEnabled),
              emailEnabled: Boolean(existing.emailEnabled),
            }
          : undefined,
        after: {
          category: input.category,
          inAppEnabled: input.inAppEnabled,
          emailEnabled: input.emailEnabled,
        },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ preference: { id, ...input } });
  },
);

async function requirePreferenceScope(
  context: Parameters<typeof requireUser>[0],
  organizationId: string,
  eventId?: string,
) {
  if (eventId) {
    const access = await requireEventRole(context, eventId, [
      "owner",
      "admin",
      "reviewer",
      "speaker",
    ]);
    if (access.organizationId !== organizationId)
      throw new HttpError(404, "event_not_found", "Event not found.");
    return;
  }
  await requireOrganizationRole(context, organizationId, [
    "owner",
    "admin",
    "member",
  ]);
}

export default router;
