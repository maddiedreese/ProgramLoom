import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, normalizeSlug, requireOrganizationRole, requireUser } from "../lib/authz";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(64).optional(),
  storageMode: z.enum(["native", "airtable"]).default("native"),
});

const eventSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(64).optional(),
  eventType: z.string().trim().min(2).max(50).default("conference"),
  timezone: z.string().trim().min(1).max(100),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  venueName: z.string().trim().max(160).optional(),
  websiteUrl: z.url().optional().or(z.literal("")),
}).superRefine((value, context) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after start time." });
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }); } catch { context.addIssue({ code: "custom", path: ["timezone"], message: "Choose a valid IANA timezone." }); }
});

router.get("/", async (context) => {
  const user = await requireUser(context);
  const result = await database(context.env).prepare(
    `SELECT o.id, o.name, o.slug, o.storage_mode AS storageMode, om.role,
            COUNT(DISTINCT e.id) AS eventCount
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     LEFT JOIN events e ON e.organization_id = o.id
     WHERE om.user_id = ?
     GROUP BY o.id, o.name, o.slug, o.storage_mode, om.role
     ORDER BY o.created_at ASC`,
  ).bind(user.id).all();
  return context.json({ organizations: result.results });
});

router.post("/", zValidator("json", organizationSchema), async (context) => {
  const user = await requireUser(context);
  const input = context.req.valid("json");
  const slug = normalizeSlug(input.slug || input.name);
  if (!slug) throw new HttpError(400, "invalid_slug", "Choose an organization name containing letters or numbers.");
  const db = database(context.env);
  const existing = await db.prepare("SELECT id FROM organizations WHERE slug = ? COLLATE NOCASE").bind(slug).first();
  if (existing) throw new HttpError(409, "slug_taken", "That workspace URL is already in use.");
  const id = crypto.randomUUID();
  const organization = { id, name: input.name, slug, storageMode: input.storageMode, role: "owner" as const, eventCount: 0 };
  await db.batch([
    db.prepare("INSERT INTO organizations (id, name, slug, storage_mode, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, input.name, slug, input.storageMode, user.id),
    db.prepare("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
    auditStatement(db, { organizationId: id, actorUserId: user.id, action: "organization.created", entityType: "organization", entityId: id, after: organization, requestId: context.get("requestId") }),
  ]);
  return context.json({ organization }, 201);
});

router.get("/:organizationId/events", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, ["owner", "admin", "member"]);
  const result = await database(context.env).prepare(
    `SELECT id, name, slug, event_type AS eventType, timezone, starts_at AS startsAt, ends_at AS endsAt,
            venue_name AS venueName, website_url AS websiteUrl, status
     FROM events WHERE organization_id = ? ORDER BY starts_at ASC`,
  ).bind(organizationId).all();
  return context.json({ events: result.results });
});

router.post("/:organizationId/events", zValidator("json", eventSchema), async (context) => {
  const organizationId = context.req.param("organizationId");
  const { user } = await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
  const input = context.req.valid("json");
  const slug = normalizeSlug(input.slug || input.name);
  if (!slug) throw new HttpError(400, "invalid_slug", "Choose an event name containing letters or numbers.");
  const db = database(context.env);
  const existing = await db.prepare("SELECT id FROM events WHERE organization_id = ? AND slug = ? COLLATE NOCASE").bind(organizationId, slug).first();
  if (existing) throw new HttpError(409, "slug_taken", "That event URL is already in use for this workspace.");
  const id = crypto.randomUUID();
  const event = { id, organizationId, name: input.name, slug, eventType: input.eventType, timezone: input.timezone, startsAt: input.startsAt, endsAt: input.endsAt, venueName: input.venueName ?? null, websiteUrl: input.websiteUrl || null, status: "draft" as const };
  await db.batch([
    db.prepare(
      `INSERT INTO events
        (id, organization_id, name, slug, event_type, website_url, venue_name, timezone, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, organizationId, input.name, slug, input.eventType, input.websiteUrl || null, input.venueName ?? null, input.timezone, input.startsAt, input.endsAt, user.id),
    db.prepare("INSERT INTO event_members (event_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
    auditStatement(db, { organizationId, eventId: id, actorUserId: user.id, action: "event.created", entityType: "event", entityId: id, after: event, requestId: context.get("requestId") }),
  ]);
  return context.json({ event }, 201);
});

export default router;
