import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import {
  database,
  HttpError,
  normalizeSlug,
  requireOrganizationRole,
  requireUser,
} from "../lib/authz";
import { randomToken, sha256 } from "../lib/crypto";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "../lib/communications";
import { renderSimpleTransactionalEmail, sendInvitation } from "../lib/email";
import { domainEventStatement } from "../lib/operations";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(64).optional(),
  storageMode: z.enum(["native", "airtable"]).default("native"),
});

const eventSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z.string().trim().max(64).optional(),
    eventType: z.string().trim().min(2).max(50).default("conference"),
    timezone: z.string().trim().min(1).max(100),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    venueName: z.string().trim().max(160).optional(),
    websiteUrl: z.url().optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (new Date(value.endsAt) <= new Date(value.startsAt))
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End time must be after start time.",
      });
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone });
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Choose a valid IANA timezone.",
      });
    }
  });

const invitationSchema = z
  .object({
    email: z.email().transform((email) => email.trim().toLowerCase()),
    role: z.enum(["admin", "reviewer", "speaker"]),
    eventId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.role === "reviewer" || value.role === "speaker") &&
      !value.eventId
    )
      context.addIssue({
        code: "custom",
        path: ["eventId"],
        message: "Choose an event for reviewer and speaker invitations.",
      });
  });

router.get("/", async (context) => {
  const user = await requireUser(context);
  const result = await database(context.env)
    .prepare(
      `SELECT o.id, o.name, o.slug, o.storage_mode AS storageMode, om.role,
            COUNT(DISTINCT e.id) AS eventCount
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     LEFT JOIN events e ON e.organization_id = o.id
     WHERE om.user_id = ?
     GROUP BY o.id, o.name, o.slug, o.storage_mode, om.role
     ORDER BY o.created_at ASC`,
    )
    .bind(user.id)
    .all();
  return context.json({ organizations: result.results });
});

router.post("/", zValidator("json", organizationSchema), async (context) => {
  const user = await requireUser(context);
  const input = context.req.valid("json");
  const slug = normalizeSlug(input.slug || input.name);
  if (!slug)
    throw new HttpError(
      400,
      "invalid_slug",
      "Choose an organization name containing letters or numbers.",
    );
  const db = database(context.env);
  const existing = await db
    .prepare("SELECT id FROM organizations WHERE slug = ? COLLATE NOCASE")
    .bind(slug)
    .first();
  if (existing)
    throw new HttpError(
      409,
      "slug_taken",
      "That workspace URL is already in use.",
    );
  const id = crypto.randomUUID();
  const organization = {
    id,
    name: input.name,
    slug,
    storageMode: input.storageMode,
    role: "owner" as const,
    eventCount: 0,
  };
  await db.batch([
    db
      .prepare(
        "INSERT INTO organizations (id, name, slug, storage_mode, created_by) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, input.name, slug, input.storageMode, user.id),
    db
      .prepare(
        "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'owner')",
      )
      .bind(id, user.id),
    auditStatement(db, {
      organizationId: id,
      actorUserId: user.id,
      action: "organization.created",
      entityType: "organization",
      entityId: id,
      after: organization,
      requestId: context.get("requestId"),
    }),
  ]);
  return context.json({ organization }, 201);
});

router.get("/:organizationId/events", async (context) => {
  const organizationId = context.req.param("organizationId");
  const access = await requireOrganizationRole(context, organizationId, [
    "owner",
    "admin",
    "member",
  ]);
  const restricted = access.role === "member";
  const result = await database(context.env)
    .prepare(
      restricted
        ? `SELECT e.id, e.name, e.slug, e.event_type AS eventType, e.timezone,
              e.starts_at AS startsAt, e.ends_at AS endsAt, e.venue_name AS venueName,
              e.website_url AS websiteUrl, e.status, em.role AS accessRole
           FROM events e JOIN event_members em ON em.event_id=e.id AND em.user_id=?
           WHERE e.organization_id=? ORDER BY e.starts_at ASC`
        : `SELECT id, name, slug, event_type AS eventType, timezone, starts_at AS startsAt,
              ends_at AS endsAt, venue_name AS venueName, website_url AS websiteUrl,
              status, ? AS accessRole
           FROM events WHERE organization_id=? ORDER BY starts_at ASC`,
    )
    .bind(access.user.id, organizationId)
    .all();
  return context.json({ events: result.results });
});

router.post(
  "/:organizationId/events",
  zValidator("json", eventSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const slug = normalizeSlug(input.slug || input.name);
    if (!slug)
      throw new HttpError(
        400,
        "invalid_slug",
        "Choose an event name containing letters or numbers.",
      );
    const db = database(context.env);
    const existing = await db
      .prepare(
        "SELECT id FROM events WHERE organization_id = ? AND slug = ? COLLATE NOCASE",
      )
      .bind(organizationId, slug)
      .first();
    if (existing)
      throw new HttpError(
        409,
        "slug_taken",
        "That event URL is already in use for this workspace.",
      );
    const id = crypto.randomUUID();
    const event = {
      id,
      organizationId,
      name: input.name,
      slug,
      eventType: input.eventType,
      timezone: input.timezone,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      venueName: input.venueName ?? null,
      websiteUrl: input.websiteUrl || null,
      status: "draft" as const,
    };
    await db.batch([
      db
        .prepare(
          `INSERT INTO events
        (id, organization_id, name, slug, event_type, website_url, venue_name, timezone, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          organizationId,
          input.name,
          slug,
          input.eventType,
          input.websiteUrl || null,
          input.venueName ?? null,
          input.timezone,
          input.startsAt,
          input.endsAt,
          user.id,
        ),
      db
        .prepare(
          "INSERT INTO event_members (event_id, user_id, role) VALUES (?, ?, 'owner')",
        )
        .bind(id, user.id),
      auditStatement(db, {
        organizationId,
        eventId: id,
        actorUserId: user.id,
        action: "event.created",
        entityType: "event",
        entityId: id,
        after: event,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ event }, 201);
  },
);

router.get("/:organizationId/members", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
  const db = database(context.env);
  const members = await db
    .prepare(
      `SELECT u.id, u.email, u.name, om.role AS organizationRole, om.created_at AS joinedAt
     FROM organization_members om JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = ? ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(organizationId)
    .all();
  const eventRoles = await db
    .prepare(
      `SELECT em.user_id AS userId, em.event_id AS eventId, e.name AS eventName, em.role
     FROM event_members em JOIN events e ON e.id = em.event_id
     WHERE e.organization_id = ? ORDER BY e.starts_at, e.name`,
    )
    .bind(organizationId)
    .all();
  const invitations = await db
    .prepare(
      `SELECT i.id, i.email, i.role, i.event_id AS eventId, e.name AS eventName, i.expires_at AS expiresAt, i.created_at AS createdAt
     FROM invitations i LEFT JOIN events e ON e.id = i.event_id
     WHERE i.organization_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
     ORDER BY i.created_at DESC`,
    )
    .bind(organizationId, new Date().toISOString())
    .all();
  return context.json({
    members: members.results,
    eventRoles: eventRoles.results,
    invitations: invitations.results,
  });
});

router.post(
  "/:organizationId/invitations",
  zValidator("json", invitationSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const organization = await db
      .prepare("SELECT name FROM organizations WHERE id = ?")
      .bind(organizationId)
      .first<{ name: string }>();
    if (!organization)
      throw new HttpError(
        404,
        "organization_not_found",
        "Organization not found.",
      );
    let eventName: string | undefined;
    if (input.eventId) {
      const event = await db
        .prepare("SELECT name FROM events WHERE id = ? AND organization_id = ?")
        .bind(input.eventId, organizationId)
        .first<{ name: string }>();
      if (!event)
        throw new HttpError(404, "event_not_found", "Event not found.");
      eventName = event.name;
    }
    const existingUser = await db
      .prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE")
      .bind(input.email)
      .first<{ id: string }>();
    if (existingUser) {
      if (input.role === "admin") {
        const membership = await db
          .prepare(
            "SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ?",
          )
          .bind(organizationId, existingUser.id)
          .first();
        if (membership)
          throw new HttpError(
            409,
            "already_member",
            "This person already belongs to the workspace.",
          );
      } else {
        const membership = await db
          .prepare(
            "SELECT role FROM event_members WHERE event_id = ? AND user_id = ? AND role = ?",
          )
          .bind(input.eventId, existingUser.id, input.role)
          .first();
        if (membership)
          throw new HttpError(
            409,
            "already_member",
            `This person is already a ${input.role} for the event.`,
          );
      }
    }
    const id = crypto.randomUUID();
    const rawToken = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const inviteLink = `${context.env.APP_URL}/invite#token=${encodeURIComponent(rawToken)}`;
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          "UPDATE invitations SET revoked_at = ? WHERE organization_id = ? AND email = ? COLLATE NOCASE AND role = ? AND COALESCE(event_id, '') = COALESCE(?, '') AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .bind(
          new Date().toISOString(),
          organizationId,
          input.email,
          input.role,
          input.eventId ?? null,
        ),
      db
        .prepare(
          "INSERT INTO invitations (id, organization_id, event_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          organizationId,
          input.eventId ?? null,
          input.email,
          input.role,
          await sha256(rawToken),
          user.id,
          expiresAt,
        ),
    ];
    let messageId: string | undefined;
    if (input.eventId && input.role !== "admin") {
      messageId = crypto.randomUUID();
      const roleLabel = input.role === "reviewer" ? "reviewer" : "speaker";
      const rendered = renderSimpleTransactionalEmail({
        recipientName: "there",
        paragraphs: [
          `${user.name} invited you to join ${eventName} as a ${roleLabel}.`,
          "This private invitation expires in seven days and can be used once.",
        ],
        actionLabel: "Accept invitation",
        actionUrl: inviteLink,
      });
      statements.push(
        prepareCommunicationStatement(db, {
          id: messageId,
          organizationId,
          eventId: input.eventId,
          category:
            input.role === "reviewer"
              ? "reviewer_invitation"
              : "speaker_invitation",
          recipientEmail: input.email,
          subject: `Join ${eventName} in ProgramLoom`,
          bodyHtml: rendered.html,
          bodyText: rendered.text,
          entityType: "invitation",
          entityId: id,
          sensitiveExpiresAt: expiresAt,
          metadata: { role: input.role },
          idempotencyKey: `invitation/${id}`,
          preparedBy: user.id,
          correlationId: context.get("requestId"),
        }),
        domainEventStatement(db, {
          organizationId,
          eventId: input.eventId,
          eventType: `invitation.${input.role}_prepared`,
          entityType: "invitation",
          entityId: id,
          actorUserId: user.id,
          payload: { messageId },
          correlationId: context.get("requestId"),
        }),
      );
    }
    statements.push(
      auditStatement(db, {
        organizationId,
        eventId: input.eventId,
        actorUserId: user.id,
        action: messageId ? "invitation.prepared" : "invitation.sent",
        entityType: "invitation",
        entityId: id,
        after: {
          email: input.email,
          role: input.role,
          eventId: input.eventId,
          expiresAt,
          messageId,
        },
        requestId: context.get("requestId"),
      }),
    );
    await db.batch(statements);
    let deliveryStatus = "sent";
    if (messageId) {
      try {
        const queued = await enqueueCommunication(
          context.env,
          messageId,
          context.get("requestId"),
        );
        deliveryStatus = queued.queued ? "queued" : "prepared";
      } catch {
        deliveryStatus = "prepared";
      }
    } else {
      try {
        await sendInvitation(context.env, {
          email: input.email,
          inviterName: user.name,
          organizationName: organization.name,
          eventName,
          role: input.role,
          inviteLink,
        });
      } catch (error) {
        await db
          .prepare("UPDATE invitations SET revoked_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), id)
          .run();
        throw error;
      }
    }
    return context.json(
      {
        invitation: {
          id,
          email: input.email,
          role: input.role,
          eventId: input.eventId ?? null,
          eventName: eventName ?? null,
          expiresAt,
        },
        deliveryStatus,
      },
      201,
    );
  },
);

export default router;
