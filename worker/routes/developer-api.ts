import { zValidator } from "@hono/zod-validator";
import { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, normalizeSlug } from "../lib/authz";
import { randomToken, sha256 } from "../lib/crypto";
import {
  type ApiTokenContext,
  type DeveloperScope,
  requestHash,
} from "../lib/developerPlatform";
import { syncAgendaCalendarInvitations } from "../lib/calendarLifecycle";
import { safeOperationalError } from "../lib/operations";

type Variables = {
  requestId: string;
  apiToken: ApiTokenContext;
  apiStartedAt: number;
};
type ApiContext = Context<{ Bindings: Env; Variables: Variables }>;
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const eventInput = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z.string().trim().max(64).optional(),
    type: z.string().trim().min(2).max(50).default("conference"),
    timezone: z.string().trim().min(1).max(100),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    venue: z.string().trim().max(160).nullable().default(null),
    websiteUrl: z.url().nullable().default(null),
  })
  .superRefine((value, context) => {
    if (new Date(value.endsAt) <= new Date(value.startsAt))
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end must be after the start.",
      });
  });
const eventUpdate = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  type: z.string().trim().min(2).max(50).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  venue: z.string().trim().max(160).nullable().optional(),
  websiteUrl: z.url().nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});
const sessionInput = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000).default(""),
  format: z.string().trim().max(120).nullable().default(null),
  durationMinutes: z.number().int().min(5).max(1440).nullable().default(null),
  trackIds: z.array(z.uuid()).max(20).default([]),
  speakerIds: z.array(z.uuid()).max(50).default([]),
  tags: z.array(z.uuid()).max(50).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
const sessionUpdate = sessionInput.omit({ eventId: true }).partial();
const contactInput = z.object({
  eventId: z.uuid().optional(),
  email: z.email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  company: z.string().trim().max(160).nullable().default(null),
  jobTitle: z.string().trim().max(160).nullable().default(null),
  biography: z.string().trim().max(20_000).nullable().default(null),
  tags: z.array(z.string().trim().max(80)).max(100).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
const contactUpdate = contactInput.omit({ eventId: true }).partial();
const bulkSessionChanges = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(20_000).optional(),
    format: z.string().trim().max(120).nullable().optional(),
    durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one supported field to update.",
  });
const bulkSchema = z
  .object({
    operation: z.enum(["update", "delete", "restore"]),
    ids: z.array(z.uuid()).min(1).max(100),
    changes: bulkSessionChanges.optional(),
  })
  .superRefine((value, context) => {
    if (value.operation === "update" && !value.changes)
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Update operations require changes.",
      });
    if (value.operation !== "update" && value.changes)
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Delete and restore operations do not accept changes.",
      });
  });
const querySchema = z.object({
  entity: z.enum([
    "events",
    "submissions",
    "sessions",
    "speakers",
    "contacts",
    "agenda",
  ]),
  fields: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  filters: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .default({}),
  sort: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

function apiError(
  context: ApiContext,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return context.json(
    {
      error: { code, message, ...(details === undefined ? {} : { details }) },
      requestId: context.get("requestId"),
    },
    status as ContentfulStatusCode,
  );
}

function pagination(context: {
  req: { query: (name: string) => string | undefined };
}) {
  const limit = Math.min(
    100,
    Math.max(1, Number(context.req.query("limit") ?? 25) || 25),
  );
  const page = Math.max(1, Number(context.req.query("page") ?? 1) || 1);
  return { limit, page, offset: (page - 1) * limit };
}

function parseArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function metadataVersion(value: unknown) {
  return sha256(JSON.stringify(value));
}

function eventRestriction(token: ApiTokenContext, column: string) {
  if (!token.eventIds.length) return { sql: "", bindings: [] as string[] };
  return {
    sql: ` AND ${column} IN (${token.eventIds.map(() => "?").join(",")})`,
    bindings: token.eventIds,
  };
}

async function requireEvent(
  db: D1Database,
  token: ApiTokenContext,
  eventId: string,
) {
  const restriction = eventRestriction(token, "id");
  const row = await db
    .prepare(
      `SELECT id,name,slug,event_type type,timezone,starts_at startsAt,ends_at endsAt,
       venue_name venue,website_url websiteUrl,status,updated_at updatedAt
       FROM events WHERE id=? AND organization_id=?${restriction.sql}`,
    )
    .bind(eventId, token.organizationId, ...restriction.bindings)
    .first<Record<string, unknown>>();
  if (!row)
    throw new HttpError(
      404,
      "event_not_found",
      "Event not found or not accessible.",
    );
  return row;
}

function requireScope(token: ApiTokenContext, scope: DeveloperScope) {
  if (!token.scopes.includes(scope))
    throw new HttpError(
      403,
      "insufficient_scope",
      `This request requires ${scope}.`,
    );
}

async function recordApiUsage(context: ApiContext, next: () => Promise<void>) {
  const started = Date.now();
  context.set("apiStartedAt", started);
  await next();
  const token = context.get("apiToken");
  if (!token || !context.env.DB) return;
  const routeTemplate = context.req.routePath || context.req.path;
  const db = database(context.env);
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_usage_events
       (id,organization_id,token_id,method,route_template,result_status,duration_ms,request_id)
       VALUES(?,?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        token.organizationId,
        token.id,
        context.req.method,
        routeTemplate,
        context.res.status,
        Date.now() - started,
        context.get("requestId"),
      ),
    auditStatement(db, {
      organizationId: token.organizationId,
      actorUserId: token.createdBy,
      action: "api_token.used",
      entityType: "api_token",
      entityId: token.id,
      after: {
        method: context.req.method,
        routeTemplate,
        resultStatus: context.res.status,
        durationMs: Date.now() - started,
      },
      requestId: context.get("requestId"),
    }),
  ]);
}

router.use("*", async (context, next) => {
  const publicPath = context.req.path.replace(/^\/api\/v1/, "");
  if (
    ["/openapi.json", "/docs", "/changelog", "/collection.json"].includes(
      publicPath,
    ) ||
    publicPath.startsWith("/downloads/")
  ) {
    await next();
    return;
  }
  const authorization = context.req.header("authorization")?.trim();
  const raw =
    context.req.header("x-access-token")?.trim() ??
    (authorization?.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : undefined);
  if (!raw)
    return apiError(
      context,
      401,
      "authentication_required",
      "Add an x-access-token header.",
    );
  const db = database(context.env);
  const row = await db
    .prepare(
      `SELECT id,organization_id organizationId,name,scopes_json scopesJson,event_ids_json eventIdsJson,
              hide_pii hidePii,created_by createdBy FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`,
    )
    .bind(await sha256(raw))
    .first<Record<string, unknown>>();
  if (!row)
    return apiError(
      context,
      401,
      "invalid_token",
      "The API token is invalid, expired, or revoked.",
    );
  const token: ApiTokenContext = {
    id: String(row.id),
    organizationId: String(row.organizationId),
    name: String(row.name),
    scopes: parseArray<DeveloperScope>(row.scopesJson),
    eventIds: parseArray<string>(row.eventIdsJson),
    hidePii: Boolean(row.hidePii),
    createdBy: String(row.createdBy),
  };
  const minute = new Date().toISOString().slice(0, 16);
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_rate_limits(token_id,window_start,request_count) VALUES(?,?,1)
         ON CONFLICT(token_id,window_start) DO UPDATE SET request_count=request_count+1`,
      )
      .bind(token.id, minute),
    db
      .prepare(
        "UPDATE api_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(token.id),
  ]);
  const rate = await db
    .prepare(
      "SELECT request_count requestCount FROM api_rate_limits WHERE token_id=? AND window_start=?",
    )
    .bind(token.id, minute)
    .first<{ requestCount: number }>();
  const limit = 600;
  context.header("x-ratelimit-limit", String(limit));
  context.header(
    "x-ratelimit-remaining",
    String(Math.max(0, limit - Number(rate?.requestCount ?? 1))),
  );
  context.header(
    "x-ratelimit-reset",
    String(Math.floor(Date.now() / 60_000 + 1) * 60),
  );
  if (Number(rate?.requestCount ?? 1) > limit)
    return apiError(
      context,
      429,
      "rate_limit_exceeded",
      "Try again after the current one-minute window.",
    );
  context.set("apiToken", token);
  await recordApiUsage(context as never, next);
});

router.onError((error, context) => {
  if (error instanceof HttpError)
    return apiError(context, error.status, error.code, error.message);
  console.error(
    JSON.stringify({
      level: "error",
      service: "developer_api",
      requestId: context.get("requestId"),
      method: context.req.method,
      route: context.req.routePath || context.req.path,
      message: safeOperationalError(error),
    }),
  );
  return apiError(
    context,
    500,
    "internal_error",
    "The request could not be completed.",
  );
});

async function idempotent<T>(
  context: ApiContext,
  routeTemplate: string,
  input: unknown,
  execute: () => Promise<{ status: number; body: T }>,
) {
  const key = context.req.header("idempotency-key")?.trim();
  if (!key || key.length > 200)
    return apiError(
      context,
      400,
      "idempotency_key_required",
      "Add an Idempotency-Key header (maximum 200 characters).",
    );
  const token = context.get("apiToken");
  const hash = await requestHash(input);
  const db = database(context.env);
  const existing = await db
    .prepare(
      `SELECT request_hash requestHash,response_status responseStatus,response_json responseJson
       FROM api_idempotency_records WHERE token_id=? AND idempotency_key=? AND expires_at>CURRENT_TIMESTAMP`,
    )
    .bind(token.id, key)
    .first<Record<string, unknown>>();
  if (existing) {
    if (existing.requestHash !== hash)
      return apiError(
        context,
        409,
        "idempotency_conflict",
        "That key was already used with a different request.",
      );
    if (Number(existing.responseStatus) === 102)
      return apiError(
        context,
        409,
        "idempotency_in_progress",
        "A request with this key is already in progress. Retry shortly with the same key.",
      );
    context.header("idempotency-replayed", "true");
    return context.json(
      JSON.parse(String(existing.responseJson)),
      Number(existing.responseStatus) as 200,
    );
  }
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO api_idempotency_records
       (id,token_id,idempotency_key,method,route_template,request_hash,response_status,response_json,expires_at)
       VALUES(?,?,?,?,?,?,?,?,datetime('now','+24 hours'))`,
    )
    .bind(
      crypto.randomUUID(),
      token.id,
      key,
      context.req.method,
      routeTemplate,
      hash,
      102,
      '{"pending":true}',
    )
    .run();
  if (!claim.meta.changes) {
    const concurrent = await db
      .prepare(
        `SELECT request_hash requestHash,response_status responseStatus,response_json responseJson
         FROM api_idempotency_records WHERE token_id=? AND idempotency_key=?`,
      )
      .bind(token.id, key)
      .first<Record<string, unknown>>();
    if (concurrent?.requestHash !== hash)
      return apiError(
        context,
        409,
        "idempotency_conflict",
        "That key was already used with a different request.",
      );
    if (Number(concurrent?.responseStatus) === 102)
      return apiError(
        context,
        409,
        "idempotency_in_progress",
        "A request with this key is already in progress. Retry shortly with the same key.",
      );
    context.header("idempotency-replayed", "true");
    return context.json(
      JSON.parse(String(concurrent?.responseJson)),
      Number(concurrent?.responseStatus) as 200,
    );
  }
  let result: { status: number; body: T };
  try {
    result = await execute();
  } catch (error) {
    await db
      .prepare(
        "DELETE FROM api_idempotency_records WHERE token_id=? AND idempotency_key=? AND response_status=102",
      )
      .bind(token.id, key)
      .run();
    throw error;
  }
  await db
    .prepare(
      `UPDATE api_idempotency_records SET response_status=?,response_json=?
       WHERE token_id=? AND idempotency_key=? AND response_status=102`,
    )
    .bind(result.status, JSON.stringify(result.body), token.id, key)
    .run();
  return context.json(result.body, result.status as 200);
}

router.get("/events", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:events");
  const { limit, page, offset } = pagination(context);
  const restriction = eventRestriction(token, "id");
  const search = context.req.query("search")?.trim().slice(0, 120);
  const bindings: unknown[] = [token.organizationId, ...restriction.bindings];
  let searchSql = "";
  if (search) {
    searchSql = " AND (name LIKE ? OR slug LIKE ?)";
    bindings.push(`%${search}%`, `${search}%`);
  }
  const rows = await database(context.env)
    .prepare(
      `SELECT id,name,slug,event_type type,timezone,starts_at startsAt,ends_at endsAt,
       venue_name venue,status,updated_at updatedAt FROM events
       WHERE organization_id=?${restriction.sql}${searchSql}
       ORDER BY starts_at DESC,id LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, limit + 1, offset)
    .all<Record<string, unknown>>();
  const hasMore = rows.results.length > limit;
  return context.json({
    data: rows.results.slice(0, limit),
    pagination: { page, limit, hasMore },
    requestId: context.get("requestId"),
  });
});

router.post("/events", zValidator("json", eventInput), async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:events");
  if (token.eventIds.length)
    throw new HttpError(
      403,
      "event_restricted_token",
      "A token restricted to existing events cannot create a new event.",
    );
  const input = context.req.valid("json");
  return idempotent(context as never, "/events", input, async () => {
    const db = database(context.env);
    const slug = normalizeSlug(input.slug || input.name);
    if (!slug)
      throw new HttpError(
        400,
        "invalid_slug",
        "Choose an event name containing letters or numbers.",
      );
    const duplicate = await db
      .prepare(
        "SELECT id FROM events WHERE organization_id=? AND slug=? COLLATE NOCASE",
      )
      .bind(token.organizationId, slug)
      .first();
    if (duplicate)
      throw new HttpError(
        409,
        "slug_taken",
        "That event slug is already in use in this organization.",
      );
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO events
             (id,organization_id,name,slug,event_type,website_url,venue_name,timezone,starts_at,ends_at,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          token.organizationId,
          input.name,
          slug,
          input.type,
          input.websiteUrl,
          input.venue,
          input.timezone,
          input.startsAt,
          input.endsAt,
          token.createdBy,
        ),
      db
        .prepare(
          "INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,'owner')",
        )
        .bind(id, token.createdBy),
      auditStatement(db, {
        organizationId: token.organizationId,
        eventId: id,
        actorUserId: token.createdBy,
        action: "developer_api.event_created",
        entityType: "event",
        entityId: id,
        after: { ...input, slug, tokenId: token.id },
        requestId: context.get("requestId"),
      }),
    ]);
    const data = await requireEvent(db, token, id);
    return {
      status: 201,
      body: { data, requestId: context.get("requestId") },
    };
  });
});

router.get("/events/:eventId", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:events");
  const event = await requireEvent(
    database(context.env),
    token,
    context.req.param("eventId"),
  );
  context.header("etag", `"${event.updatedAt}"`);
  return context.json({ data: event, requestId: context.get("requestId") });
});

router.patch(
  "/events/:eventId",
  zValidator("json", eventUpdate),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:events");
    const db = database(context.env);
    const eventId = context.req.param("eventId");
    const before = await requireEvent(db, token, eventId);
    await requireVersion(context, before.updatedAt);
    const input = context.req.valid("json");
    const startsAt = String(input.startsAt ?? before.startsAt);
    const endsAt = String(input.endsAt ?? before.endsAt);
    if (new Date(endsAt) <= new Date(startsAt))
      return apiError(
        context,
        400,
        "invalid_dates",
        "The event end must be after its start.",
      );
    await db.batch([
      db
        .prepare(
          `UPDATE events SET name=COALESCE(?,name),event_type=COALESCE(?,event_type),
           timezone=COALESCE(?,timezone),starts_at=COALESCE(?,starts_at),ends_at=COALESCE(?,ends_at),
           venue_name=CASE WHEN ? THEN ? ELSE venue_name END,
           website_url=CASE WHEN ? THEN ? ELSE website_url END,status=COALESCE(?,status),updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND organization_id=?`,
        )
        .bind(
          input.name ?? null,
          input.type ?? null,
          input.timezone ?? null,
          input.startsAt ?? null,
          input.endsAt ?? null,
          Object.hasOwn(input, "venue") ? 1 : 0,
          input.venue ?? null,
          Object.hasOwn(input, "websiteUrl") ? 1 : 0,
          input.websiteUrl ?? null,
          input.status ?? null,
          eventId,
          token.organizationId,
        ),
      auditStatement(db, {
        organizationId: token.organizationId,
        eventId,
        actorUserId: token.createdBy,
        action: "developer_api.event_updated",
        entityType: "event",
        entityId: eventId,
        before,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    const data = await requireEvent(db, token, eventId);
    context.header("etag", `"${data.updatedAt}"`);
    return context.json({ data, requestId: context.get("requestId") });
  },
);

router.get("/sessions", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:sessions");
  const { limit, page, offset } = pagination(context);
  const restriction = eventRestriction(token, "s.event_id");
  const eventId = context.req.query("eventId");
  const status = context.req.query("status")?.slice(0, 40);
  const search = context.req.query("search")?.trim().slice(0, 160);
  const sort = context.req.query("sort");
  const order =
    sort === "title"
      ? "s.title COLLATE NOCASE,s.id"
      : sort === "-updatedAt"
        ? "s.updated_at DESC,s.id"
        : "s.created_at DESC,s.id";
  const clauses = ["e.organization_id=?", "s.api_deleted_at IS NULL"];
  const bindings: unknown[] = [token.organizationId];
  if (eventId) {
    clauses.push("s.event_id=?");
    bindings.push(eventId);
  }
  if (status) {
    clauses.push("s.status=?");
    bindings.push(status);
  }
  if (search) {
    clauses.push("(s.title LIKE ? OR s.abstract LIKE ?)");
    bindings.push(`%${search}%`, `%${search}%`);
  }
  bindings.push(...restriction.bindings);
  const rows = await database(context.env)
    .prepare(
      `SELECT s.id,s.event_id eventId,s.title,s.abstract description,s.format,s.duration_minutes durationMinutes,
       s.status,s.answers_json customFields,s.created_at createdAt,s.updated_at updatedAt,
       COALESCE((SELECT json_group_array(track_id) FROM submission_tracks WHERE submission_id=s.id),'[]') trackIds,
       COALESCE((SELECT json_group_array(speaker_id) FROM session_speakers WHERE submission_id=s.id),'[]') speakerIds,
       COALESCE((SELECT json_group_array(tag_id) FROM submission_tag_assignments WHERE submission_id=s.id),'[]') tagIds
       FROM submissions s JOIN events e ON e.id=s.event_id
       WHERE ${clauses.join(" AND ")}${restriction.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, limit + 1, offset)
    .all<Record<string, unknown>>();
  const data = rows.results
    .slice(0, limit)
    .map((row) => sessionRecord(row, token.hidePii));
  return context.json({
    data,
    pagination: { page, limit, hasMore: rows.results.length > limit },
    requestId: context.get("requestId"),
  });
});

function submissionRecord(row: Record<string, unknown>, hidePii: boolean) {
  return {
    id: row.id,
    eventId: row.eventId,
    formId: row.formId,
    title: row.title,
    abstract: row.abstract,
    format: row.format,
    status: row.status,
    decisionState: row.decisionState,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
    people: hidePii ? [] : parseArray<Record<string, unknown>>(row.peopleJson),
    customFields:
      !hidePii && row.answersJson ? JSON.parse(String(row.answersJson)) : {},
  };
}

router.get("/submissions", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:submissions");
  const { limit, page, offset } = pagination(context);
  const restriction = eventRestriction(token, "s.event_id");
  const eventId = context.req.query("eventId");
  const status = context.req.query("status")?.slice(0, 40);
  const search = context.req.query("search")?.trim().slice(0, 160);
  const clauses = ["e.organization_id=?", "s.api_deleted_at IS NULL"];
  const bindings: unknown[] = [token.organizationId];
  if (eventId) {
    clauses.push("s.event_id=?");
    bindings.push(eventId);
  }
  if (status) {
    clauses.push("s.status=?");
    bindings.push(status);
  }
  if (search) {
    clauses.push("(s.title LIKE ? OR s.abstract LIKE ?)");
    bindings.push(`%${search}%`, `%${search}%`);
  }
  bindings.push(...restriction.bindings);
  const rows = await database(context.env)
    .prepare(
      `SELECT s.id,s.event_id eventId,s.form_id formId,s.title,s.abstract,s.format,s.status,
       s.decision_state decisionState,s.answers_json answersJson,s.submitted_at submittedAt,s.updated_at updatedAt,
       COALESCE((SELECT json_group_array(json_object('id',p.id,'role',p.role,'name',p.name,'email',p.email,
         'organization',p.organization,'jobTitle',p.job_title)) FROM submission_people p WHERE p.submission_id=s.id),'[]') peopleJson
       FROM submissions s JOIN events e ON e.id=s.event_id WHERE ${clauses.join(" AND ")}${restriction.sql}
       ORDER BY COALESCE(s.submitted_at,s.created_at) DESC,s.id LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, limit + 1, offset)
    .all<Record<string, unknown>>();
  return context.json({
    data: rows.results
      .slice(0, limit)
      .map((row) => submissionRecord(row, token.hidePii)),
    pagination: { page, limit, hasMore: rows.results.length > limit },
    requestId: context.get("requestId"),
  });
});

router.get("/submissions/:submissionId", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:submissions");
  const restriction = eventRestriction(token, "s.event_id");
  const row = await database(context.env)
    .prepare(
      `SELECT s.id,s.event_id eventId,s.form_id formId,s.title,s.abstract,s.format,s.status,
       s.decision_state decisionState,s.answers_json answersJson,s.submitted_at submittedAt,s.updated_at updatedAt,
       COALESCE((SELECT json_group_array(json_object('id',p.id,'role',p.role,'name',p.name,'email',p.email,
         'organization',p.organization,'jobTitle',p.job_title)) FROM submission_people p WHERE p.submission_id=s.id),'[]') peopleJson
       FROM submissions s JOIN events e ON e.id=s.event_id
       WHERE s.id=? AND e.organization_id=? AND s.api_deleted_at IS NULL${restriction.sql}`,
    )
    .bind(
      context.req.param("submissionId"),
      token.organizationId,
      ...restriction.bindings,
    )
    .first<Record<string, unknown>>();
  if (!row)
    return apiError(
      context,
      404,
      "submission_not_found",
      "Submission not found or not accessible.",
    );
  context.header("etag", `"${row.updatedAt}"`);
  return context.json({
    data: submissionRecord(row, token.hidePii),
    requestId: context.get("requestId"),
  });
});

function sessionRecord(
  row: Record<string, unknown>,
  hidePii = false,
): Record<string, unknown> & {
  id: unknown;
  eventId: unknown;
  updatedAt: unknown;
  deletedAt: unknown;
  status: unknown;
  customFields: Record<string, unknown>;
  trackIds: string[];
  speakerIds: string[];
  tagIds: string[];
} {
  return {
    ...row,
    id: row.id,
    eventId: row.eventId,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    status: row.status,
    customFields:
      !hidePii && row.customFields
        ? (JSON.parse(String(row.customFields)) as Record<string, unknown>)
        : {},
    trackIds: parseArray<string>(row.trackIds),
    speakerIds: parseArray<string>(row.speakerIds),
    tagIds: parseArray<string>(row.tagIds),
  };
}

async function sessionById(
  db: D1Database,
  token: ApiTokenContext,
  id: string,
  includeDeleted = false,
) {
  const restriction = eventRestriction(token, "s.event_id");
  const row = await db
    .prepare(
      `SELECT s.id,s.event_id eventId,s.title,s.abstract description,s.format,s.duration_minutes durationMinutes,
       s.status,s.answers_json customFields,s.api_deleted_at deletedAt,s.created_at createdAt,s.updated_at updatedAt,
       COALESCE((SELECT json_group_array(track_id) FROM submission_tracks WHERE submission_id=s.id),'[]') trackIds,
       COALESCE((SELECT json_group_array(speaker_id) FROM session_speakers WHERE submission_id=s.id),'[]') speakerIds,
       COALESCE((SELECT json_group_array(tag_id) FROM submission_tag_assignments WHERE submission_id=s.id),'[]') tagIds
       FROM submissions s JOIN events e ON e.id=s.event_id WHERE s.id=? AND e.organization_id=?
       ${includeDeleted ? "" : "AND s.api_deleted_at IS NULL"}${restriction.sql}`,
    )
    .bind(id, token.organizationId, ...restriction.bindings)
    .first<Record<string, unknown>>();
  return row ? sessionRecord(row, token.hidePii) : null;
}

router.get("/sessions/:sessionId", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:sessions");
  const row = await sessionById(
    database(context.env),
    token,
    context.req.param("sessionId"),
  );
  if (!row)
    return apiError(context, 404, "session_not_found", "Session not found.");
  context.header("etag", `"${row.updatedAt}"`);
  return context.json({ data: row, requestId: context.get("requestId") });
});

async function ensureApiForm(db: D1Database, eventId: string) {
  const existing = await db
    .prepare(
      "SELECT id FROM cfp_forms WHERE event_id=? ORDER BY created_at LIMIT 1",
    )
    .bind(eventId)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO cfp_forms(id,event_id,name,slug,description,allow_drafts)
       VALUES(?,?,'Developer API','developer-api','Sessions created through the supported developer API.',0)`,
    )
    .bind(id, eventId)
    .run();
  return id;
}

async function validateSessionRelations(
  db: D1Database,
  token: ApiTokenContext,
  eventId: string,
  input: { trackIds?: string[]; speakerIds?: string[]; tags?: string[] },
) {
  for (const [table, ids, condition] of [
    ["tracks", input.trackIds ?? [], "event_id=?"],
    [
      "speaker_profiles",
      input.speakerIds ?? [],
      "organization_id=(SELECT organization_id FROM events WHERE id=?)",
    ],
    ["submission_tags", input.tags ?? [], "event_id=?"],
  ] as const) {
    if (!ids.length) continue;
    const rows = await db
      .prepare(
        `SELECT id FROM ${table} WHERE ${condition} AND id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...ids)
      .all();
    if (rows.results.length !== new Set(ids).size)
      throw new HttpError(
        400,
        "invalid_relation",
        `One or more ${table.replaceAll("_", " ")} do not belong to the accessible event.`,
      );
  }
  await requireEvent(db, token, eventId);
}

router.post("/sessions", zValidator("json", sessionInput), async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:sessions");
  const input = context.req.valid("json");
  return idempotent(context as never, "/sessions", input, async () => {
    const db = database(context.env);
    await validateSessionRelations(db, token, input.eventId, input);
    const id = crypto.randomUUID();
    const formId = await ensureApiForm(db, input.eventId);
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO submissions
           (id,form_id,event_id,title,abstract,format,duration_minutes,status,decision_state,answers_json,submitted_at,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,'accepted','accepted',?,?,?,?)`,
        )
        .bind(
          id,
          formId,
          input.eventId,
          input.title,
          input.description,
          input.format,
          input.durationMinutes,
          JSON.stringify(input.customFields),
          now,
          now,
          now,
        ),
      ...input.trackIds.map((trackId) =>
        db
          .prepare(
            "INSERT INTO submission_tracks(submission_id,track_id) VALUES(?,?)",
          )
          .bind(id, trackId),
      ),
      ...input.speakerIds.map((speakerId) =>
        db
          .prepare(
            "INSERT INTO session_speakers(submission_id,speaker_id,role) VALUES(?,?,'speaker')",
          )
          .bind(id, speakerId),
      ),
      ...input.tags.map((tagId) =>
        db
          .prepare(
            "INSERT INTO submission_tag_assignments(submission_id,tag_id,assigned_by) VALUES(?,?,(SELECT created_by FROM events WHERE id=?))",
          )
          .bind(id, tagId, input.eventId),
      ),
      auditStatement(db, {
        organizationId: token.organizationId,
        eventId: input.eventId,
        actorUserId: token.createdBy,
        action: "developer_api.session_created",
        entityType: "submission",
        entityId: id,
        after: { title: input.title, tokenId: token.id },
        requestId: context.get("requestId"),
      }),
    ]);
    const data = await sessionById(db, token, id);
    return { status: 201, body: { data, requestId: context.get("requestId") } };
  });
});

async function requireVersion(
  context: { req: { header: (name: string) => string | undefined } },
  current: unknown,
) {
  const supplied = context.req
    .header("if-match")
    ?.replace(/^W\//, "")
    .replaceAll('"', "");
  if (!supplied)
    throw new HttpError(
      428,
      "precondition_required",
      "Add If-Match using the current ETag.",
    );
  if (supplied !== String(current))
    throw new HttpError(
      412,
      "version_conflict",
      "The record changed. Fetch it again before updating.",
    );
}

router.patch(
  "/sessions/:sessionId",
  zValidator("json", sessionUpdate),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:sessions");
    const db = database(context.env);
    const before = await sessionById(db, token, context.req.param("sessionId"));
    if (!before)
      return apiError(context, 404, "session_not_found", "Session not found.");
    await requireVersion(context, before.updatedAt);
    const input = context.req.valid("json");
    await validateSessionRelations(db, token, String(before.eventId), input);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE submissions SET title=COALESCE(?,title),abstract=COALESCE(?,abstract),
         format=CASE WHEN ? THEN ? ELSE format END,duration_minutes=CASE WHEN ? THEN ? ELSE duration_minutes END,
         answers_json=COALESCE(?,answers_json),updated_at=? WHERE id=?`,
        )
        .bind(
          input.title ?? null,
          input.description ?? null,
          Object.hasOwn(input, "format") ? 1 : 0,
          input.format ?? null,
          Object.hasOwn(input, "durationMinutes") ? 1 : 0,
          input.durationMinutes ?? null,
          input.customFields ? JSON.stringify(input.customFields) : null,
          now,
          before.id,
        ),
    ];
    if (input.trackIds) {
      statements.push(
        db
          .prepare("DELETE FROM submission_tracks WHERE submission_id=?")
          .bind(before.id),
      );
      statements.push(
        ...input.trackIds.map((id) =>
          db
            .prepare(
              "INSERT INTO submission_tracks(submission_id,track_id) VALUES(?,?)",
            )
            .bind(before.id, id),
        ),
      );
    }
    if (input.speakerIds) {
      statements.push(
        db
          .prepare("DELETE FROM session_speakers WHERE submission_id=?")
          .bind(before.id),
      );
      statements.push(
        ...input.speakerIds.map((id) =>
          db
            .prepare(
              "INSERT INTO session_speakers(submission_id,speaker_id,role) VALUES(?,?,'speaker')",
            )
            .bind(before.id, id),
        ),
      );
    }
    if (input.tags) {
      statements.push(
        db
          .prepare(
            "DELETE FROM submission_tag_assignments WHERE submission_id=?",
          )
          .bind(before.id),
      );
      statements.push(
        ...input.tags.map((id) =>
          db
            .prepare(
              "INSERT INTO submission_tag_assignments(submission_id,tag_id,assigned_by) VALUES(?,?,(SELECT created_by FROM events WHERE id=?))",
            )
            .bind(before.id, id, before.eventId),
        ),
      );
    }
    statements.push(
      auditStatement(db, {
        organizationId: token.organizationId,
        eventId: String(before.eventId),
        actorUserId: token.createdBy,
        action: "developer_api.session_updated",
        entityType: "submission",
        entityId: String(before.id),
        before,
        after: input,
        requestId: context.get("requestId"),
      }),
    );
    await db.batch(statements);
    const data = await sessionById(db, token, String(before.id));
    context.header("etag", `"${data?.updatedAt}"`);
    return context.json({ data, requestId: context.get("requestId") });
  },
);

router.patch(
  "/sessions/:sessionId/custom-fields",
  zValidator("json", z.object({ values: z.record(z.string(), z.unknown()) })),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:fields");
    const db = database(context.env);
    const before = await sessionById(db, token, context.req.param("sessionId"));
    if (!before)
      return apiError(context, 404, "session_not_found", "Session not found.");
    await requireVersion(context, before.updatedAt);
    const values = context.req.valid("json").values;
    const raw = await db
      .prepare("SELECT answers_json answersJson FROM submissions WHERE id=?")
      .bind(before.id)
      .first<{ answersJson: string | null }>();
    const current = raw?.answersJson
      ? (JSON.parse(raw.answersJson) as Record<string, unknown>)
      : {};
    const merged = { ...current, ...values };
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "UPDATE submissions SET answers_json=?,updated_at=? WHERE id=?",
        )
        .bind(JSON.stringify(merged), now, before.id),
      auditStatement(db, {
        organizationId: token.organizationId,
        eventId: String(before.eventId),
        actorUserId: token.createdBy,
        action: "developer_api.session_fields_updated",
        entityType: "submission",
        entityId: String(before.id),
        before: { fieldKeys: Object.keys(current) },
        after: { updatedFieldKeys: Object.keys(values) },
        requestId: context.get("requestId"),
      }),
    ]);
    context.header("etag", `"${now}"`);
    return context.json({
      data: {
        id: before.id,
        customFields: token.hidePii ? {} : merged,
        updatedAt: now,
      },
      requestId: context.get("requestId"),
    });
  },
);

async function softDeleteSession(
  env: Env,
  db: D1Database,
  token: ApiTokenContext,
  id: string,
  deleted: boolean,
  requestId: string,
) {
  const before = await sessionById(db, token, id, true);
  if (!before)
    throw new HttpError(404, "session_not_found", "Session not found.");
  const now = new Date().toISOString();
  const agendaItems = deleted
    ? await db
        .prepare(
          "SELECT id FROM agenda_items WHERE submission_id=? AND cancelled_at IS NULL",
        )
        .bind(id)
        .all<{ id: string }>()
    : { results: [] as { id: string }[] };
  await db.batch([
    db
      .prepare(
        `UPDATE submissions SET api_deleted_at=?,status=?,updated_at=? WHERE id=?`,
      )
      .bind(deleted ? now : null, deleted ? "withdrawn" : "accepted", now, id),
    ...(deleted
      ? [
          db
            .prepare(
              "UPDATE agenda_items SET cancelled_at=?,status='cancelled',updated_at=? WHERE submission_id=? AND cancelled_at IS NULL",
            )
            .bind(now, now, id),
        ]
      : []),
    auditStatement(db, {
      organizationId: token.organizationId,
      eventId: String(before.eventId),
      actorUserId: token.createdBy,
      action: deleted
        ? "developer_api.session_deleted"
        : "developer_api.session_restored",
      entityType: "submission",
      entityId: id,
      before: { deletedAt: before.deletedAt, status: before.status },
      after: {
        deletedAt: deleted ? now : null,
        status: deleted ? "withdrawn" : "accepted",
      },
      requestId,
    }),
  ]);
  for (const item of agendaItems.results)
    await syncAgendaCalendarInvitations(env, {
      eventId: String(before.eventId),
      agendaItemId: item.id,
      actorUserId: token.createdBy,
      correlationId: requestId,
      action: "cancellation",
    });
  return {
    id,
    deletedAt: deleted ? now : null,
    status: deleted ? "withdrawn" : "accepted",
    updatedAt: now,
  };
}

router.delete("/sessions/:sessionId", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:sessions");
  const input = {
    sessionId: context.req.param("sessionId"),
    operation: "delete",
  };
  return idempotent(
    context as never,
    "/sessions/:sessionId",
    input,
    async () => ({
      status: 200,
      body: {
        data: await softDeleteSession(
          context.env,
          database(context.env),
          token,
          input.sessionId,
          true,
          context.get("requestId"),
        ),
        requestId: context.get("requestId"),
      },
    }),
  );
});

router.post("/sessions/:sessionId/restore", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:sessions");
  const input = {
    sessionId: context.req.param("sessionId"),
    operation: "restore",
  };
  return idempotent(
    context as never,
    "/sessions/:sessionId/restore",
    input,
    async () => ({
      status: 200,
      body: {
        data: await softDeleteSession(
          context.env,
          database(context.env),
          token,
          input.sessionId,
          false,
          context.get("requestId"),
        ),
        requestId: context.get("requestId"),
      },
    }),
  );
});

router.post(
  "/sessions/bulk",
  zValidator("json", bulkSchema),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:sessions");
    const input = context.req.valid("json");
    return idempotent(context as never, "/sessions/bulk", input, async () => {
      const db = database(context.env);
      const results = [];
      for (const id of input.ids) {
        if (input.operation === "delete" || input.operation === "restore")
          results.push(
            await softDeleteSession(
              context.env,
              db,
              token,
              id,
              input.operation === "delete",
              context.get("requestId"),
            ),
          );
        else {
          const current = await sessionById(db, token, id);
          if (!current)
            throw new HttpError(
              404,
              "session_not_found",
              `Session ${id} was not found.`,
            );
          const changes = input.changes ?? {};
          const now = new Date().toISOString();
          await db
            .prepare(
              "UPDATE submissions SET title=COALESCE(?,title),abstract=COALESCE(?,abstract),format=COALESCE(?,format),duration_minutes=COALESCE(?,duration_minutes),updated_at=? WHERE id=?",
            )
            .bind(
              changes.title ?? null,
              changes.description ?? null,
              changes.format ?? null,
              changes.durationMinutes ?? null,
              now,
              id,
            )
            .run();
          await auditStatement(db, {
            organizationId: token.organizationId,
            eventId: String(current.eventId),
            actorUserId: token.createdBy,
            action: "developer_api.session_bulk_updated",
            entityType: "submission",
            entityId: id,
            before: current,
            after: changes,
            requestId: context.get("requestId"),
          }).run();
          results.push({ id, updatedAt: now });
        }
      }
      return {
        status: 200,
        body: { data: results, requestId: context.get("requestId") },
      };
    });
  },
);

router.get("/events/:eventId/speakers", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:speakers");
  const db = database(context.env);
  await requireEvent(db, token, context.req.param("eventId"));
  const { limit, page, offset } = pagination(context);
  const search = context.req.query("search")?.trim().slice(0, 160);
  const rows = await db
    .prepare(
      `SELECT DISTINCT sp.id,sp.first_name firstName,sp.last_name lastName,sp.job_title jobTitle,
       sp.company,sp.bio biography,sp.headshot_key headshotKey,
       ${token.hidePii ? "NULL" : "sp.email"} email,sp.updated_at updatedAt
       FROM speaker_profiles sp JOIN (
         SELECT speaker_id FROM event_speakers WHERE event_id=?
         UNION
         SELECT ss.speaker_id FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id
         WHERE s.event_id=? AND s.api_deleted_at IS NULL
       ) roster ON roster.speaker_id=sp.id
       WHERE sp.organization_id=?
       ${search ? "AND (sp.first_name LIKE ? OR sp.last_name LIKE ? OR sp.company LIKE ?)" : ""}
       ORDER BY sp.last_name COLLATE NOCASE,sp.first_name COLLATE NOCASE,sp.id LIMIT ? OFFSET ?`,
    )
    .bind(
      context.req.param("eventId"),
      context.req.param("eventId"),
      token.organizationId,
      ...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []),
      limit + 1,
      offset,
    )
    .all<Record<string, unknown>>();
  return context.json({
    data: rows.results.slice(0, limit),
    pagination: { page, limit, hasMore: rows.results.length > limit },
    requestId: context.get("requestId"),
  });
});

function contactRecord(row: Record<string, unknown>, hidePii: boolean) {
  return {
    id: row.id,
    email: hidePii ? null : row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    jobTitle: row.jobTitle,
    biography: row.biography,
    tags: parseArray<string>(row.tagsJson),
    customFields:
      !hidePii && row.customFieldsJson
        ? JSON.parse(String(row.customFieldsJson))
        : {},
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function contactById(
  db: D1Database,
  token: ApiTokenContext,
  id: string,
  includeDeleted = false,
) {
  const eventSql = token.eventIds.length
    ? ` AND (EXISTS (SELECT 1 FROM event_speakers ces WHERE ces.speaker_id=c.speaker_profile_id
        AND ces.event_id IN (${token.eventIds.map(() => "?").join(",")}))
        OR EXISTS (SELECT 1 FROM session_speakers css JOIN submissions cs ON cs.id=css.submission_id
        WHERE css.speaker_id=c.speaker_profile_id AND cs.event_id IN (${token.eventIds.map(() => "?").join(",")})
        AND cs.api_deleted_at IS NULL))`
    : "";
  const row = await db
    .prepare(
      `SELECT c.id,c.email,c.first_name firstName,c.last_name lastName,c.company,c.job_title jobTitle,
       c.bio biography,c.tags_json tagsJson,c.api_deleted_at deletedAt,c.created_at createdAt,c.updated_at updatedAt,
       COALESCE((SELECT json_group_object(f.name,json(v.value_json)) FROM crm_field_values v
         JOIN crm_fields f ON f.id=v.field_id WHERE v.contact_id=c.id),'{}') customFieldsJson
       FROM crm_contacts c WHERE c.id=? AND c.organization_id=?${includeDeleted ? "" : " AND c.api_deleted_at IS NULL"}${eventSql}`,
    )
    .bind(id, token.organizationId, ...token.eventIds, ...token.eventIds)
    .first<Record<string, unknown>>();
  return row ? contactRecord(row, token.hidePii) : null;
}

router.get("/contacts", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:contacts");
  const { limit, page, offset } = pagination(context);
  const search = context.req.query("search")?.trim().slice(0, 160);
  const eventSql = token.eventIds.length
    ? ` AND (EXISTS (SELECT 1 FROM event_speakers ces WHERE ces.speaker_id=c.speaker_profile_id
        AND ces.event_id IN (${token.eventIds.map(() => "?").join(",")}))
        OR EXISTS (SELECT 1 FROM session_speakers css JOIN submissions cs ON cs.id=css.submission_id
        WHERE css.speaker_id=c.speaker_profile_id AND cs.event_id IN (${token.eventIds.map(() => "?").join(",")})
        AND cs.api_deleted_at IS NULL))`
    : "";
  const rows = await database(context.env)
    .prepare(
      `SELECT c.id,c.email,c.first_name firstName,c.last_name lastName,c.company,c.job_title jobTitle,
       c.bio biography,c.tags_json tagsJson,c.api_deleted_at deletedAt,c.created_at createdAt,c.updated_at updatedAt,
       COALESCE((SELECT json_group_object(f.name,json(v.value_json)) FROM crm_field_values v
         JOIN crm_fields f ON f.id=v.field_id WHERE v.contact_id=c.id),'{}') customFieldsJson
       FROM crm_contacts c WHERE c.organization_id=? AND c.api_deleted_at IS NULL${eventSql}
       ${search ? "AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.company LIKE ? OR c.email LIKE ?)" : ""}
       ORDER BY c.last_name COLLATE NOCASE,c.first_name COLLATE NOCASE,c.id LIMIT ? OFFSET ?`,
    )
    .bind(
      token.organizationId,
      ...token.eventIds,
      ...token.eventIds,
      ...(search
        ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`]
        : []),
      limit + 1,
      offset,
    )
    .all<Record<string, unknown>>();
  return context.json({
    data: rows.results
      .slice(0, limit)
      .map((row) => contactRecord(row, token.hidePii)),
    pagination: { page, limit, hasMore: rows.results.length > limit },
    requestId: context.get("requestId"),
  });
});

router.get("/contacts/:contactId", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:contacts");
  const row = await contactById(
    database(context.env),
    token,
    context.req.param("contactId"),
  );
  if (!row)
    return apiError(context, 404, "contact_not_found", "Contact not found.");
  context.header("etag", `"${row.updatedAt}"`);
  return context.json({ data: row, requestId: context.get("requestId") });
});

router.get("/contacts/:contactId/sessions", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:contacts");
  requireScope(token, "read:sessions");
  const db = database(context.env);
  const visibleContact = await contactById(
    db,
    token,
    context.req.param("contactId"),
  );
  const contact = visibleContact
    ? await db
        .prepare(
          "SELECT speaker_profile_id speakerId FROM crm_contacts WHERE id=? AND organization_id=? AND api_deleted_at IS NULL",
        )
        .bind(context.req.param("contactId"), token.organizationId)
        .first<{ speakerId: string | null }>()
    : null;
  if (!contact)
    return apiError(context, 404, "contact_not_found", "Contact not found.");
  if (!contact.speakerId)
    return context.json({
      data: [],
      pagination: { page: 1, limit: 25, hasMore: false },
      requestId: context.get("requestId"),
    });
  const restriction = eventRestriction(token, "s.event_id");
  const rows = await db
    .prepare(
      `SELECT s.id,s.event_id eventId,s.title,s.abstract description,s.format,s.duration_minutes durationMinutes,
       s.status,s.answers_json customFields,s.created_at createdAt,s.updated_at updatedAt,'[]' trackIds,'[]' speakerIds,'[]' tagIds
       FROM submissions s JOIN session_speakers ss ON ss.submission_id=s.id JOIN events e ON e.id=s.event_id
       WHERE ss.speaker_id=? AND e.organization_id=? AND s.api_deleted_at IS NULL${restriction.sql}
       ORDER BY s.updated_at DESC LIMIT 100`,
    )
    .bind(contact.speakerId, token.organizationId, ...restriction.bindings)
    .all<Record<string, unknown>>();
  return context.json({
    data: rows.results.map((row) => sessionRecord(row, token.hidePii)),
    pagination: { page: 1, limit: 100, hasMore: false },
    requestId: context.get("requestId"),
  });
});

async function writeContactFields(
  db: D1Database,
  organizationId: string,
  contactId: string,
  values: Record<string, unknown>,
) {
  for (const [name, value] of Object.entries(values)) {
    const field = await db
      .prepare(
        "SELECT id FROM crm_fields WHERE organization_id=? AND name=? COLLATE NOCASE",
      )
      .bind(organizationId, name)
      .first<{ id: string }>();
    if (!field)
      throw new HttpError(
        400,
        "unknown_custom_field",
        `Unknown contact field: ${name}.`,
      );
    await db
      .prepare(
        `INSERT INTO crm_field_values(contact_id,field_id,value_json) VALUES(?,?,?)
         ON CONFLICT(contact_id,field_id) DO UPDATE SET value_json=excluded.value_json`,
      )
      .bind(contactId, field.id, JSON.stringify(value))
      .run();
  }
}

router.post("/contacts", zValidator("json", contactInput), async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:contacts");
  const input = context.req.valid("json");
  return idempotent(context as never, "/contacts", input, async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = database(context.env);
    const duplicate = await db
      .prepare(
        "SELECT id FROM crm_contacts WHERE organization_id=? AND email=? COLLATE NOCASE",
      )
      .bind(token.organizationId, input.email)
      .first<{ id: string }>();
    if (duplicate)
      throw new HttpError(
        409,
        "contact_email_conflict",
        "A contact with that email address already exists in this organization.",
      );
    if (
      token.eventIds.length &&
      (!input.eventId || !token.eventIds.includes(input.eventId))
    )
      throw new HttpError(
        400,
        "event_required",
        "A contact created by an event-restricted token must include an accessible eventId.",
      );
    let speakerId: string | null = null;
    if (input.eventId) {
      await requireEvent(db, token, input.eventId);
      const existingSpeaker = await db
        .prepare(
          "SELECT id FROM speaker_profiles WHERE organization_id=? AND email=? COLLATE NOCASE",
        )
        .bind(token.organizationId, input.email)
        .first<{ id: string }>();
      speakerId = existingSpeaker?.id ?? crypto.randomUUID();
      if (!existingSpeaker)
        await db
          .prepare(
            `INSERT INTO speaker_profiles
               (id,organization_id,email,first_name,last_name,company,job_title,bio)
               VALUES(?,?,?,?,?,?,?,?)`,
          )
          .bind(
            speakerId,
            token.organizationId,
            input.email,
            input.firstName,
            input.lastName,
            input.company,
            input.jobTitle,
            input.biography,
          )
          .run();
      await db
        .prepare(
          `INSERT INTO event_speakers(event_id,speaker_id,source,added_by,status)
             VALUES(?,?,'api',?,'proposed') ON CONFLICT(event_id,speaker_id) DO NOTHING`,
        )
        .bind(input.eventId, speakerId, token.createdBy)
        .run();
    }
    await db
      .prepare(
        `INSERT INTO crm_contacts
         (id,organization_id,speaker_profile_id,email,first_name,last_name,company,job_title,bio,tags_json,source,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,'api',?,?)`,
      )
      .bind(
        id,
        token.organizationId,
        speakerId,
        input.email,
        input.firstName,
        input.lastName,
        input.company,
        input.jobTitle,
        input.biography,
        JSON.stringify(input.tags),
        now,
        now,
      )
      .run();
    await writeContactFields(db, token.organizationId, id, input.customFields);
    await auditStatement(db, {
      organizationId: token.organizationId,
      actorUserId: token.createdBy,
      action: "developer_api.contact_created",
      entityType: "crm_contact",
      entityId: id,
      after: { ...input, email: token.hidePii ? undefined : input.email },
      requestId: context.get("requestId"),
    }).run();
    return {
      status: 201,
      body: {
        data: await contactById(db, token, id),
        requestId: context.get("requestId"),
      },
    };
  });
});

router.patch(
  "/contacts/:contactId",
  zValidator("json", contactUpdate),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:contacts");
    const db = database(context.env);
    const before = await contactById(db, token, context.req.param("contactId"));
    if (!before)
      return apiError(context, 404, "contact_not_found", "Contact not found.");
    await requireVersion(context, before.updatedAt);
    const input = context.req.valid("json");
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE crm_contacts SET email=COALESCE(?,email),first_name=COALESCE(?,first_name),last_name=COALESCE(?,last_name),
       company=CASE WHEN ? THEN ? ELSE company END,job_title=CASE WHEN ? THEN ? ELSE job_title END,
       bio=CASE WHEN ? THEN ? ELSE bio END,tags_json=COALESCE(?,tags_json),updated_at=? WHERE id=?`,
      )
      .bind(
        input.email ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        Object.hasOwn(input, "company") ? 1 : 0,
        input.company ?? null,
        Object.hasOwn(input, "jobTitle") ? 1 : 0,
        input.jobTitle ?? null,
        Object.hasOwn(input, "biography") ? 1 : 0,
        input.biography ?? null,
        input.tags ? JSON.stringify(input.tags) : null,
        now,
        before.id,
      )
      .run();
    if (input.customFields)
      await writeContactFields(
        db,
        token.organizationId,
        String(before.id),
        input.customFields,
      );
    await auditStatement(db, {
      organizationId: token.organizationId,
      actorUserId: token.createdBy,
      action: "developer_api.contact_updated",
      entityType: "crm_contact",
      entityId: String(before.id),
      before,
      after: input,
      requestId: context.get("requestId"),
    }).run();
    const data = await contactById(db, token, String(before.id));
    context.header("etag", `"${data?.updatedAt}"`);
    return context.json({ data, requestId: context.get("requestId") });
  },
);

async function softDeleteContact(
  db: D1Database,
  token: ApiTokenContext,
  id: string,
  deleted: boolean,
  requestId: string,
) {
  const before = await contactById(db, token, id, true);
  if (!before)
    throw new HttpError(404, "contact_not_found", "Contact not found.");
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE crm_contacts SET api_deleted_at=?,updated_at=? WHERE id=?",
      )
      .bind(deleted ? now : null, now, id),
    auditStatement(db, {
      organizationId: token.organizationId,
      actorUserId: token.createdBy,
      action: deleted
        ? "developer_api.contact_deleted"
        : "developer_api.contact_restored",
      entityType: "crm_contact",
      entityId: id,
      before: { deletedAt: before.deletedAt },
      after: { deletedAt: deleted ? now : null },
      requestId,
    }),
  ]);
  return { id, deletedAt: deleted ? now : null, updatedAt: now };
}

router.delete("/contacts/:contactId", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:contacts");
  const input = {
    contactId: context.req.param("contactId"),
    operation: "delete",
  };
  return idempotent(
    context as never,
    "/contacts/:contactId",
    input,
    async () => ({
      status: 200,
      body: {
        data: await softDeleteContact(
          database(context.env),
          token,
          input.contactId,
          true,
          context.get("requestId"),
        ),
        requestId: context.get("requestId"),
      },
    }),
  );
});

router.post("/contacts/:contactId/restore", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:contacts");
  const input = {
    contactId: context.req.param("contactId"),
    operation: "restore",
  };
  return idempotent(
    context as never,
    "/contacts/:contactId/restore",
    input,
    async () => ({
      status: 200,
      body: {
        data: await softDeleteContact(
          database(context.env),
          token,
          input.contactId,
          false,
          context.get("requestId"),
        ),
        requestId: context.get("requestId"),
      },
    }),
  );
});

router.get("/events/:eventId/metadata", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:events");
  const db = database(context.env);
  await requireEvent(db, token, context.req.param("eventId"));
  const [rooms, tracks, tags, fields, settings] = await Promise.all([
    db
      .prepare(
        "SELECT id,name,capacity,position FROM rooms WHERE event_id=? ORDER BY position,name",
      )
      .bind(context.req.param("eventId"))
      .all(),
    db
      .prepare(
        "SELECT id,name,slug,color,description,position FROM tracks WHERE event_id=? ORDER BY position,name",
      )
      .bind(context.req.param("eventId"))
      .all(),
    db
      .prepare(
        "SELECT id,name,color,created_at createdAt FROM submission_tags WHERE event_id=? ORDER BY name",
      )
      .bind(context.req.param("eventId"))
      .all(),
    db
      .prepare(
        `SELECT ff.id,ff.form_id formId,ff.field_key fieldKey,ff.label,ff.field_type type,
       ff.options_json options,ff.required,ff.searchable,ff.position FROM form_fields ff
       JOIN cfp_forms f ON f.id=ff.form_id WHERE f.event_id=? ORDER BY f.name,ff.position`,
      )
      .bind(context.req.param("eventId"))
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT formats_json formatsJson FROM event_program_settings WHERE event_id=?",
      )
      .bind(context.req.param("eventId"))
      .first<Record<string, unknown>>(),
  ]);
  const roomData = await Promise.all(
    rooms.results.map(async (room) => ({
      ...room,
      version: await metadataVersion(room),
    })),
  );
  const trackData = await Promise.all(
    tracks.results.map(async (track) => ({
      ...track,
      version: await metadataVersion(track),
    })),
  );
  const tagData = await Promise.all(
    tags.results.map(async (tag) => ({
      ...tag,
      version: await metadataVersion(tag),
    })),
  );
  const formatData = await Promise.all(
    parseArray<Record<string, unknown>>(settings?.formatsJson).map(
      async (format) => ({
        ...format,
        version: await metadataVersion(format),
      }),
    ),
  );
  return context.json({
    data: {
      rooms: roomData,
      tracks: trackData,
      tags: tagData,
      formats: formatData,
      sessionStatuses: [
        "draft",
        "pending",
        "accepted",
        "declined",
        "withdrawn",
      ],
      customFields: fields.results.map((row) => ({
        ...row,
        options: row.options ? JSON.parse(String(row.options)) : null,
        required: Boolean(row.required),
        searchable: Boolean(row.searchable),
      })),
    },
    requestId: context.get("requestId"),
  });
});

router.post(
  "/events/:eventId/metadata/:kind",
  zValidator(
    "json",
    z.object({
      name: z.string().trim().min(1).max(160),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      capacity: z.number().int().nonnegative().nullable().optional(),
      description: z.string().trim().max(1000).nullable().optional(),
    }),
  ),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:metadata");
    const kind = context.req.param("kind");
    if (!["rooms", "tracks", "tags", "formats"].includes(kind))
      return apiError(
        context,
        404,
        "metadata_kind_not_found",
        "Supported kinds are rooms, tracks, tags, and formats.",
      );
    const input = context.req.valid("json");
    const eventId = context.req.param("eventId");
    return idempotent(
      context as never,
      "/events/:eventId/metadata/:kind",
      { kind, input },
      async () => {
        const db = database(context.env);
        await requireEvent(db, token, eventId);
        const id = crypto.randomUUID();
        const duplicate =
          kind === "rooms"
            ? await db
                .prepare(
                  "SELECT id FROM rooms WHERE event_id=? AND name=? COLLATE NOCASE",
                )
                .bind(eventId, input.name)
                .first()
            : kind === "tracks"
              ? await db
                  .prepare("SELECT id FROM tracks WHERE event_id=? AND slug=?")
                  .bind(eventId, normalizeSlug(input.name))
                  .first()
              : kind === "tags"
                ? await db
                    .prepare(
                      "SELECT id FROM submission_tags WHERE event_id=? AND name=? COLLATE NOCASE",
                    )
                    .bind(eventId, input.name)
                    .first()
                : null;
        if (duplicate)
          throw new HttpError(
            409,
            "metadata_name_conflict",
            `A ${kind.slice(0, -1)} with that name already exists in this event.`,
          );
        if (kind === "rooms")
          await db
            .prepare(
              "INSERT INTO rooms(id,event_id,name,capacity,position) VALUES(?,?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM rooms WHERE event_id=?))",
            )
            .bind(id, eventId, input.name, input.capacity ?? null, eventId)
            .run();
        else if (kind === "tracks")
          await db
            .prepare(
              "INSERT INTO tracks(id,event_id,name,slug,color,description,position) VALUES(?,?,?,?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM tracks WHERE event_id=?))",
            )
            .bind(
              id,
              eventId,
              input.name,
              normalizeSlug(input.name),
              input.color ?? "#64748b",
              input.description ?? null,
              eventId,
            )
            .run();
        else if (kind === "tags")
          await db
            .prepare(
              "INSERT INTO submission_tags(id,organization_id,event_id,name,color,created_by) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              id,
              token.organizationId,
              eventId,
              input.name,
              input.color ?? "#64748b",
              token.createdBy,
            )
            .run();
        else {
          const settings = await db
            .prepare(
              "SELECT formats_json formatsJson FROM event_program_settings WHERE event_id=?",
            )
            .bind(eventId)
            .first<Record<string, unknown>>();
          const formats = parseArray<unknown>(settings?.formatsJson);
          if (
            formats.some(
              (format) =>
                typeof format === "object" &&
                format !== null &&
                String(
                  (format as Record<string, unknown>).name,
                ).toLowerCase() === input.name.toLowerCase(),
            )
          )
            throw new HttpError(
              409,
              "metadata_name_conflict",
              "A format with that name already exists in this event.",
            );
          formats.push({ id, name: input.name });
          await db
            .prepare(
              `INSERT INTO event_program_settings(event_id,formats_json) VALUES(?,?)
           ON CONFLICT(event_id) DO UPDATE SET formats_json=excluded.formats_json,updated_at=CURRENT_TIMESTAMP`,
            )
            .bind(eventId, JSON.stringify(formats))
            .run();
        }
        await auditStatement(db, {
          organizationId: token.organizationId,
          eventId,
          actorUserId: token.createdBy,
          action: `developer_api.metadata_${kind}_created`,
          entityType:
            kind === "rooms"
              ? "room"
              : kind === "tracks"
                ? "track"
                : kind === "tags"
                  ? "submission_tag"
                  : "event_program_settings",
          entityId: kind === "formats" ? eventId : id,
          after: input,
          requestId: context.get("requestId"),
        }).run();
        return {
          status: 201,
          body: {
            data: { id, kind, ...input },
            requestId: context.get("requestId"),
          },
        };
      },
    );
  },
);

router.patch(
  "/events/:eventId/metadata/:kind/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().trim().min(1).max(160).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      capacity: z.number().int().nonnegative().nullable().optional(),
      description: z.string().trim().max(1000).nullable().optional(),
    }),
  ),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:metadata");
    const eventId = context.req.param("eventId");
    const kind = context.req.param("kind");
    const id = context.req.param("id");
    if (!["rooms", "tracks", "tags", "formats"].includes(kind))
      return apiError(
        context,
        404,
        "metadata_kind_not_found",
        "Supported kinds are rooms, tracks, tags, and formats.",
      );
    const db = database(context.env);
    await requireEvent(db, token, eventId);
    const input = context.req.valid("json");
    let before: Record<string, unknown> | null | undefined;
    if (kind === "rooms")
      before = await db
        .prepare(
          "SELECT id,name,capacity,position FROM rooms WHERE id=? AND event_id=?",
        )
        .bind(id, eventId)
        .first<Record<string, unknown>>();
    else if (kind === "tracks")
      before = await db
        .prepare(
          "SELECT id,name,slug,color,description,position FROM tracks WHERE id=? AND event_id=?",
        )
        .bind(id, eventId)
        .first<Record<string, unknown>>();
    else if (kind === "tags")
      before = await db
        .prepare(
          "SELECT id,name,color,created_at createdAt FROM submission_tags WHERE id=? AND event_id=?",
        )
        .bind(id, eventId)
        .first<Record<string, unknown>>();
    else {
      const settings = await db
        .prepare(
          "SELECT formats_json formatsJson FROM event_program_settings WHERE event_id=?",
        )
        .bind(eventId)
        .first<Record<string, unknown>>();
      before = parseArray<Record<string, unknown>>(settings?.formatsJson).find(
        (format) => format.id === id,
      );
    }
    if (!before)
      return apiError(
        context,
        404,
        "metadata_not_found",
        "The metadata record was not found in this event.",
      );
    await requireVersion(context, await metadataVersion(before));
    if (kind === "rooms")
      await db
        .prepare(
          "UPDATE rooms SET name=COALESCE(?,name),capacity=CASE WHEN ? THEN ? ELSE capacity END WHERE id=? AND event_id=?",
        )
        .bind(
          input.name ?? null,
          Object.hasOwn(input, "capacity") ? 1 : 0,
          input.capacity ?? null,
          id,
          eventId,
        )
        .run();
    else if (kind === "tracks")
      await db
        .prepare(
          "UPDATE tracks SET name=COALESCE(?,name),color=COALESCE(?,color),description=CASE WHEN ? THEN ? ELSE description END WHERE id=? AND event_id=?",
        )
        .bind(
          input.name ?? null,
          input.color ?? null,
          Object.hasOwn(input, "description") ? 1 : 0,
          input.description ?? null,
          id,
          eventId,
        )
        .run();
    else if (kind === "tags")
      await db
        .prepare(
          "UPDATE submission_tags SET name=COALESCE(?,name),color=COALESCE(?,color) WHERE id=? AND event_id=?",
        )
        .bind(input.name ?? null, input.color ?? null, id, eventId)
        .run();
    else {
      const settings = await db
        .prepare(
          "SELECT formats_json formatsJson FROM event_program_settings WHERE event_id=?",
        )
        .bind(eventId)
        .first<Record<string, unknown>>();
      const formats = parseArray<Record<string, unknown>>(
        settings?.formatsJson,
      ).map((format) =>
        format.id === id
          ? { ...format, name: input.name ?? format.name }
          : format,
      );
      await db
        .prepare(
          `INSERT INTO event_program_settings(event_id,formats_json) VALUES(?,?)
           ON CONFLICT(event_id) DO UPDATE SET formats_json=excluded.formats_json,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(eventId, JSON.stringify(formats))
        .run();
    }
    const after = { ...before, ...input };
    await auditStatement(db, {
      organizationId: token.organizationId,
      eventId,
      actorUserId: token.createdBy,
      action: `developer_api.metadata_${kind}_updated`,
      entityType: "event_metadata",
      entityId: id,
      before,
      after,
      requestId: context.get("requestId"),
    }).run();
    const version = await metadataVersion(after);
    context.header("etag", `"${version}"`);
    return context.json({
      data: { ...after, version },
      requestId: context.get("requestId"),
    });
  },
);

router.delete("/events/:eventId/metadata/:kind/:id", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "write:metadata");
  const eventId = context.req.param("eventId");
  const kind = context.req.param("kind");
  const id = context.req.param("id");
  if (!["rooms", "tracks", "tags", "formats"].includes(kind))
    return apiError(
      context,
      404,
      "metadata_kind_not_found",
      "Supported kinds are rooms, tracks, tags, and formats.",
    );
  return idempotent(
    context as never,
    "/events/:eventId/metadata/:kind/:id",
    { eventId, kind, id },
    async () => {
      const db = database(context.env);
      await requireEvent(db, token, eventId);
      let changes = 0;
      if (kind === "formats") {
        const settings = await db
          .prepare(
            "SELECT formats_json formatsJson FROM event_program_settings WHERE event_id=?",
          )
          .bind(eventId)
          .first<Record<string, unknown>>();
        const before = parseArray<Record<string, unknown>>(
          settings?.formatsJson,
        );
        const formats = before.filter((format) => format.id !== id);
        changes = before.length - formats.length;
        if (changes)
          await db
            .prepare(
              "UPDATE event_program_settings SET formats_json=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?",
            )
            .bind(JSON.stringify(formats), eventId)
            .run();
      } else {
        const table =
          kind === "rooms"
            ? "rooms"
            : kind === "tracks"
              ? "tracks"
              : "submission_tags";
        const result = await db
          .prepare(`DELETE FROM ${table} WHERE id=? AND event_id=?`)
          .bind(id, eventId)
          .run();
        changes = result.meta.changes;
      }
      if (!changes)
        throw new HttpError(
          404,
          "metadata_not_found",
          "The metadata record was not found in this event.",
        );
      await auditStatement(db, {
        organizationId: token.organizationId,
        eventId,
        actorUserId: token.createdBy,
        action: `developer_api.metadata_${kind}_deleted`,
        entityType: "event_metadata",
        entityId: id,
        before: { id, kind },
        requestId: context.get("requestId"),
      }).run();
      return {
        status: 200,
        body: {
          data: { id, kind, deleted: true },
          requestId: context.get("requestId"),
        },
      };
    },
  );
});

router.get("/events/:eventId/agenda", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:agenda");
  const db = database(context.env);
  await requireEvent(db, token, context.req.param("eventId"));
  const draft = context.req.query("state") === "draft";
  if (draft) requireScope(token, "write:agenda");
  const rows = await db
    .prepare(
      `SELECT a.id,a.submission_id sessionId,a.title,a.description,a.item_type type,a.track_id trackId,
       t.name track,a.room_id roomId,r.name room,a.starts_at startsAt,a.ends_at endsAt,a.status,a.version,
       a.cancelled_at cancelledAt FROM agenda_items a LEFT JOIN tracks t ON t.id=a.track_id
       LEFT JOIN rooms r ON r.id=a.room_id WHERE a.event_id=?
       ${draft ? "" : "AND a.status='published' AND a.cancelled_at IS NULL"}
       ORDER BY COALESCE(a.starts_at,'9999'),a.title,a.id LIMIT 1000`,
    )
    .bind(context.req.param("eventId"))
    .all();
  return context.json({
    data: rows.results,
    requestId: context.get("requestId"),
  });
});

router.post(
  "/events/:eventId/agenda",
  zValidator(
    "json",
    z.object({
      sessionId: z.uuid(),
      roomId: z.uuid().nullable().default(null),
      trackId: z.uuid().nullable().default(null),
      startsAt: z.iso.datetime({ offset: true }),
      endsAt: z.iso.datetime({ offset: true }),
    }),
  ),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:agenda");
    const eventId = context.req.param("eventId");
    const input = context.req.valid("json");
    return idempotent(
      context as never,
      "/events/:eventId/agenda",
      { eventId, ...input },
      async () => {
        const db = database(context.env);
        await requireEvent(db, token, eventId);
        if (input.endsAt <= input.startsAt)
          throw new HttpError(
            400,
            "invalid_time",
            "The end must be after the start.",
          );
        const session = await db
          .prepare(
            `SELECT id,title,abstract FROM submissions
             WHERE id=? AND event_id=? AND api_deleted_at IS NULL AND status='accepted'`,
          )
          .bind(input.sessionId, eventId)
          .first<Record<string, unknown>>();
        if (!session)
          throw new HttpError(
            404,
            "session_not_found",
            "An accepted, accessible session is required.",
          );
        const existing = await db
          .prepare(
            "SELECT id FROM agenda_items WHERE event_id=? AND submission_id=? AND cancelled_at IS NULL",
          )
          .bind(eventId, input.sessionId)
          .first();
        if (existing)
          throw new HttpError(
            409,
            "already_scheduled",
            "The session already has an active agenda placement.",
          );
        if (input.roomId) {
          const room = await db
            .prepare("SELECT id FROM rooms WHERE id=? AND event_id=?")
            .bind(input.roomId, eventId)
            .first();
          if (!room)
            throw new HttpError(
              400,
              "invalid_room",
              "The room does not belong to this event.",
            );
        }
        if (input.trackId) {
          const track = await db
            .prepare("SELECT id FROM tracks WHERE id=? AND event_id=?")
            .bind(input.trackId, eventId)
            .first();
          if (!track)
            throw new HttpError(
              400,
              "invalid_track",
              "The track does not belong to this event.",
            );
        }
        const roomConflict = input.roomId
          ? await db
              .prepare(
                "SELECT id,title FROM agenda_items WHERE event_id=? AND room_id=? AND cancelled_at IS NULL AND starts_at<? AND ends_at>? LIMIT 1",
              )
              .bind(eventId, input.roomId, input.endsAt, input.startsAt)
              .first<Record<string, unknown>>()
          : null;
        const speakerConflict = await db
          .prepare(
            `SELECT other.id,other.title,sp.first_name||' '||sp.last_name speaker
             FROM agenda_items other JOIN session_speakers os ON os.submission_id=other.submission_id
             JOIN session_speakers current ON current.speaker_id=os.speaker_id
             JOIN speaker_profiles sp ON sp.id=os.speaker_id
             WHERE other.event_id=? AND current.submission_id=? AND other.cancelled_at IS NULL
             AND other.starts_at<? AND other.ends_at>? LIMIT 1`,
          )
          .bind(eventId, input.sessionId, input.endsAt, input.startsAt)
          .first<Record<string, unknown>>();
        if (roomConflict || speakerConflict)
          throw new HttpError(
            409,
            "schedule_conflict",
            "Nothing was scheduled because the requested placement conflicts with the current agenda.",
          );
        const id = crypto.randomUUID();
        await db.batch([
          db
            .prepare(
              `INSERT INTO agenda_items
               (id,event_id,submission_id,track_id,room_id,item_type,title,description,starts_at,ends_at,status)
               VALUES(?,?,?,?,?,'session',?,?,?,?,'draft')`,
            )
            .bind(
              id,
              eventId,
              input.sessionId,
              input.trackId,
              input.roomId,
              session.title,
              session.abstract,
              input.startsAt,
              input.endsAt,
            ),
          auditStatement(db, {
            organizationId: token.organizationId,
            eventId,
            actorUserId: token.createdBy,
            action: "developer_api.agenda_item_created",
            entityType: "agenda_item",
            entityId: id,
            after: input,
            requestId: context.get("requestId"),
          }),
        ]);
        await syncAgendaCalendarInvitations(context.env, {
          eventId,
          agendaItemId: id,
          actorUserId: token.createdBy,
          correlationId: context.get("requestId"),
          action: "placement",
        });
        return {
          status: 201,
          body: {
            data: { id, ...input, status: "draft", version: 1 },
            requestId: context.get("requestId"),
          },
        };
      },
    );
  },
);

router.patch(
  "/events/:eventId/agenda/:itemId",
  zValidator(
    "json",
    z.object({
      roomId: z.uuid().nullable(),
      trackId: z.uuid().nullable().optional(),
      startsAt: z.iso.datetime({ offset: true }),
      endsAt: z.iso.datetime({ offset: true }),
    }),
  ),
  async (context) => {
    const token = context.get("apiToken");
    requireScope(token, "write:agenda");
    const db = database(context.env);
    const eventId = context.req.param("eventId");
    await requireEvent(db, token, eventId);
    const item = await db
      .prepare(
        "SELECT id,submission_id submissionId,version,starts_at startsAt FROM agenda_items WHERE id=? AND event_id=? AND cancelled_at IS NULL",
      )
      .bind(context.req.param("itemId"), eventId)
      .first<Record<string, unknown>>();
    if (!item)
      return apiError(
        context,
        404,
        "agenda_item_not_found",
        "Agenda item not found.",
      );
    await requireVersion(context, item.version);
    const input = context.req.valid("json");
    if (input.endsAt <= input.startsAt)
      return apiError(
        context,
        400,
        "invalid_time",
        "The end must be after the start.",
      );
    if (input.roomId) {
      const room = await db
        .prepare("SELECT id FROM rooms WHERE id=? AND event_id=?")
        .bind(input.roomId, eventId)
        .first();
      if (!room)
        return apiError(
          context,
          400,
          "invalid_room",
          "The room does not belong to this event.",
        );
    }
    if (input.trackId) {
      const track = await db
        .prepare("SELECT id FROM tracks WHERE id=? AND event_id=?")
        .bind(input.trackId, eventId)
        .first();
      if (!track)
        return apiError(
          context,
          400,
          "invalid_track",
          "The track does not belong to this event.",
        );
    }
    const roomConflict = input.roomId
      ? await db
          .prepare(
            "SELECT id,title FROM agenda_items WHERE event_id=? AND id!=? AND room_id=? AND cancelled_at IS NULL AND starts_at<? AND ends_at>? LIMIT 1",
          )
          .bind(eventId, item.id, input.roomId, input.endsAt, input.startsAt)
          .first<Record<string, unknown>>()
      : null;
    const speakerConflict = item.submissionId
      ? await db
          .prepare(
            `SELECT other.id,other.title,sp.first_name||' '||sp.last_name speaker
           FROM agenda_items other JOIN session_speakers os ON os.submission_id=other.submission_id
           JOIN session_speakers current ON current.speaker_id=os.speaker_id
           JOIN speaker_profiles sp ON sp.id=os.speaker_id WHERE other.event_id=? AND other.id!=?
           AND current.submission_id=? AND other.cancelled_at IS NULL AND other.starts_at<? AND other.ends_at>? LIMIT 1`,
          )
          .bind(
            eventId,
            item.id,
            item.submissionId,
            input.endsAt,
            input.startsAt,
          )
          .first<Record<string, unknown>>()
      : null;
    if (roomConflict || speakerConflict)
      return apiError(
        context,
        409,
        "schedule_conflict",
        "Nothing was moved because the placement conflicts with the current agenda.",
        {
          room: roomConflict
            ? { id: roomConflict.id, title: roomConflict.title }
            : null,
          speaker: speakerConflict
            ? {
                id: speakerConflict.id,
                title: speakerConflict.title,
                speaker: speakerConflict.speaker,
              }
            : null,
        },
      );
    await db.batch([
      db
        .prepare(
          "UPDATE agenda_items SET room_id=?,track_id=COALESCE(?,track_id),starts_at=?,ends_at=?,status='draft',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(
          input.roomId,
          input.trackId ?? null,
          input.startsAt,
          input.endsAt,
          item.id,
        ),
      auditStatement(db, {
        organizationId: token.organizationId,
        eventId,
        actorUserId: token.createdBy,
        action: "developer_api.agenda_item_moved",
        entityType: "agenda_item",
        entityId: String(item.id),
        before: item,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    await syncAgendaCalendarInvitations(context.env, {
      eventId,
      agendaItemId: String(item.id),
      actorUserId: token.createdBy,
      correlationId: context.get("requestId"),
      action: item.startsAt ? "material_change" : "placement",
    });
    return context.json({
      data: { id: item.id, ...input, version: Number(item.version) + 1 },
      requestId: context.get("requestId"),
    });
  },
);

router.get("/events/:eventId/files", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:content");
  const eventId = context.req.param("eventId");
  const db = database(context.env);
  await requireEvent(db, token, eventId);
  const { limit, page, offset } = pagination(context);
  const rows = await db
    .prepare(
      `SELECT f.id,f.submission_id sessionId,f.purpose,f.status,f.updated_at updatedAt,
       fv.id versionId,fv.filename,fv.content_type contentType,fv.size_bytes sizeBytes,fv.version_number version
       FROM files f LEFT JOIN file_versions fv ON fv.id=f.current_version_id
       WHERE f.event_id=? ORDER BY f.updated_at DESC,f.id LIMIT ? OFFSET ?`,
    )
    .bind(eventId, limit + 1, offset)
    .all<Record<string, unknown>>();
  return context.json({
    data: rows.results.slice(0, limit),
    pagination: { page, limit, hasMore: rows.results.length > limit },
    requestId: context.get("requestId"),
  });
});

router.post("/events/:eventId/files/:fileId/download", async (context) => {
  const token = context.get("apiToken");
  requireScope(token, "read:content");
  const eventId = context.req.param("eventId");
  const db = database(context.env);
  await requireEvent(db, token, eventId);
  const file = await db
    .prepare(
      "SELECT id FROM files WHERE id=? AND event_id=? AND current_version_id IS NOT NULL",
    )
    .bind(context.req.param("fileId"), eventId)
    .first();
  if (!file) return apiError(context, 404, "file_not_found", "File not found.");
  const value = `pl_download_${randomToken(32)}`;
  await db
    .prepare(
      `INSERT INTO api_download_grants
     (id,token_hash,api_token_id,organization_id,event_id,file_id,expires_at)
     VALUES(?,?,?,?,?,?,datetime('now','+10 minutes'))`,
    )
    .bind(
      crypto.randomUUID(),
      await sha256(value),
      token.id,
      token.organizationId,
      eventId,
      context.req.param("fileId"),
    )
    .run();
  return context.json({
    data: {
      url: `${context.env.APP_URL}/api/v1/downloads/${value}`,
      expiresInSeconds: 600,
    },
    requestId: context.get("requestId"),
  });
});

router.get("/downloads/:grant", async (context) => {
  const db = database(context.env);
  const grant = await db
    .prepare(
      `SELECT g.id,fv.r2_key r2Key,fv.filename,fv.content_type contentType
     FROM api_download_grants g JOIN files f ON f.id=g.file_id
     JOIN file_versions fv ON fv.id=f.current_version_id WHERE g.token_hash=?
     AND g.expires_at>CURRENT_TIMESTAMP`,
    )
    .bind(await sha256(context.req.param("grant")))
    .first<Record<string, unknown>>();
  if (!grant || !context.env.FILES)
    return apiError(
      context,
      404,
      "download_not_found",
      "This download link is invalid or expired.",
    );
  const object = await context.env.FILES.get(String(grant.r2Key));
  if (!object)
    return apiError(
      context,
      404,
      "download_not_found",
      "The file is no longer available.",
    );
  await db
    .prepare(
      "UPDATE api_download_grants SET used_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(grant.id)
    .run();
  return new Response(object.body, {
    headers: {
      "content-type": String(grant.contentType),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(grant.filename))}`,
      "cache-control": "private, no-store",
    },
  });
});

async function executeReadQuery(
  db: D1Database,
  token: ApiTokenContext,
  input: z.infer<typeof querySchema>,
) {
  const definitions = {
    events: {
      scope: "read:events" as const,
      table: "events e",
      eventColumn: "e.id",
      organization: "e.organization_id",
      fields: {
        id: "e.id",
        name: "e.name",
        slug: "e.slug",
        timezone: "e.timezone",
        startsAt: "e.starts_at",
        endsAt: "e.ends_at",
        status: "e.status",
      },
    },
    sessions: {
      scope: "read:sessions" as const,
      table: "submissions s JOIN events e ON e.id=s.event_id",
      eventColumn: "s.event_id",
      organization: "e.organization_id",
      fields: {
        id: "s.id",
        eventId: "s.event_id",
        title: "s.title",
        description: "s.abstract",
        format: "s.format",
        status: "s.status",
        updatedAt: "s.updated_at",
      },
    },
    submissions: {
      scope: "read:submissions" as const,
      table: "submissions s JOIN events e ON e.id=s.event_id",
      eventColumn: "s.event_id",
      organization: "e.organization_id",
      fields: {
        id: "s.id",
        eventId: "s.event_id",
        formId: "s.form_id",
        title: "s.title",
        abstract: "s.abstract",
        format: "s.format",
        status: "s.status",
        decisionState: "s.decision_state",
        submittedAt: "s.submitted_at",
        updatedAt: "s.updated_at",
      },
    },
    speakers: {
      scope: "read:speakers" as const,
      table: "speaker_profiles sp",
      eventColumn: "NULL",
      organization: "sp.organization_id",
      fields: {
        id: "sp.id",
        firstName: "sp.first_name",
        lastName: "sp.last_name",
        company: "sp.company",
        jobTitle: "sp.job_title",
      },
    },
    contacts: {
      scope: "read:contacts" as const,
      table: "crm_contacts c",
      eventColumn: "NULL",
      organization: "c.organization_id",
      fields: {
        id: "c.id",
        firstName: "c.first_name",
        lastName: "c.last_name",
        company: "c.company",
        jobTitle: "c.job_title",
        updatedAt: "c.updated_at",
      },
    },
    agenda: {
      scope: "read:agenda" as const,
      table: "agenda_items a JOIN events e ON e.id=a.event_id",
      eventColumn: "a.event_id",
      organization: "e.organization_id",
      fields: {
        id: "a.id",
        eventId: "a.event_id",
        sessionId: "a.submission_id",
        title: "a.title",
        startsAt: "a.starts_at",
        endsAt: "a.ends_at",
        status: "a.status",
      },
    },
  } as const;
  const definition = definitions[input.entity];
  requireScope(token, definition.scope);
  const available = definition.fields as Record<string, string>;
  const selected = input.fields.length ? input.fields : Object.keys(available);
  if (selected.some((field) => !available[field]))
    throw new HttpError(
      400,
      "unknown_query_field",
      "One or more selected fields are not in this entity schema.",
    );
  const clauses = [`${definition.organization}=?`];
  const bindings: unknown[] = [token.organizationId];
  for (const [field, value] of Object.entries(input.filters)) {
    if (!available[field])
      throw new HttpError(
        400,
        "unknown_query_filter",
        `Unknown filter: ${field}.`,
      );
    clauses.push(`${available[field]}=?`);
    bindings.push(value);
  }
  if (definition.eventColumn !== "NULL" && token.eventIds.length) {
    clauses.push(
      `${definition.eventColumn} IN (${token.eventIds.map(() => "?").join(",")})`,
    );
    bindings.push(...token.eventIds);
  } else if (token.eventIds.length && input.entity === "speakers") {
    clauses.push(
      `EXISTS (SELECT 1 FROM session_speakers qss JOIN submissions qs ON qs.id=qss.submission_id
       WHERE qss.speaker_id=sp.id AND qs.event_id IN (${token.eventIds.map(() => "?").join(",")})
       AND qs.api_deleted_at IS NULL)`,
    );
    bindings.push(...token.eventIds);
  } else if (token.eventIds.length && input.entity === "contacts") {
    clauses.push(
      `(EXISTS (SELECT 1 FROM event_speakers qes WHERE qes.speaker_id=c.speaker_profile_id
       AND qes.event_id IN (${token.eventIds.map(() => "?").join(",")}))
       OR EXISTS (SELECT 1 FROM session_speakers qss JOIN submissions qs ON qs.id=qss.submission_id
       WHERE qss.speaker_id=c.speaker_profile_id AND qs.event_id IN (${token.eventIds.map(() => "?").join(",")})
       AND qs.api_deleted_at IS NULL))`,
    );
    bindings.push(...token.eventIds, ...token.eventIds);
  }
  const sortName = input.sort?.replace(/^-/, "") || "id";
  if (!available[sortName])
    throw new HttpError(
      400,
      "unknown_query_sort",
      `Unknown sort field: ${sortName}.`,
    );
  const sql = `SELECT ${selected.map((field) => `${available[field]} AS "${field}"`).join(",")}
    FROM ${definition.table} WHERE ${clauses.join(" AND ")}
    ORDER BY ${available[sortName]} ${input.sort?.startsWith("-") ? "DESC" : "ASC"} LIMIT ?`;
  const rows = await db
    .prepare(sql)
    .bind(...bindings, input.limit)
    .all();
  return { schema: Object.keys(available), data: rows.results };
}

router.post("/query", zValidator("json", querySchema), async (context) => {
  const result = await executeReadQuery(
    database(context.env),
    context.get("apiToken"),
    context.req.valid("json"),
  );
  return context.json({ ...result, requestId: context.get("requestId") });
});

router.get("/query/schema", (context) => {
  return context.json({
    entities: {
      events: [
        "id",
        "name",
        "slug",
        "timezone",
        "startsAt",
        "endsAt",
        "status",
      ],
      sessions: [
        "id",
        "eventId",
        "title",
        "description",
        "format",
        "status",
        "updatedAt",
      ],
      submissions: [
        "id",
        "eventId",
        "formId",
        "title",
        "abstract",
        "format",
        "status",
        "decisionState",
        "submittedAt",
        "updatedAt",
      ],
      speakers: ["id", "firstName", "lastName", "company", "jobTitle"],
      contacts: [
        "id",
        "firstName",
        "lastName",
        "company",
        "jobTitle",
        "updatedAt",
      ],
      agenda: [
        "id",
        "eventId",
        "sessionId",
        "title",
        "startsAt",
        "endsAt",
        "status",
      ],
    },
    privacy: "PII fields are intentionally absent from the query schema.",
    requestId: context.get("requestId"),
  });
});

router.post("/mcp", async (context) => {
  const token = context.get("apiToken");
  const request = (await context.req.json()) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  const response = (
    result?: unknown,
    error?: { code: number; message: string },
  ) =>
    context.json({
      jsonrpc: "2.0",
      id: request.id ?? null,
      ...(error ? { error } : { result }),
    });
  if (request.method === "initialize")
    return response({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "ProgramLoom", version: "1.0.0" },
      capabilities: { tools: {} },
    });
  if (request.method === "tools/list")
    return response({
      tools: [
        {
          name: "list_events",
          description: "List accessible ProgramLoom events.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "query_program",
          description:
            "Run a bounded, read-only query over authorized program records.",
          inputSchema: {
            type: "object",
            required: ["entity"],
            properties: {
              entity: {
                enum: [
                  "events",
                  "submissions",
                  "sessions",
                  "speakers",
                  "contacts",
                  "agenda",
                ],
              },
              fields: { type: "array", items: { type: "string" } },
              filters: { type: "object" },
              sort: { type: "string" },
              limit: { type: "integer", maximum: 100 },
            },
          },
        },
      ],
    });
  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const result =
        name === "list_events"
          ? await executeReadQuery(
              database(context.env),
              token,
              querySchema.parse({ entity: "events", limit: 25 }),
            )
          : name === "query_program"
            ? await executeReadQuery(
                database(context.env),
                token,
                querySchema.parse(args),
              )
            : null;
      if (!result)
        return response(undefined, { code: -32601, message: "Unknown tool." });
      return response({
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
    } catch (error) {
      return response(undefined, {
        code: -32602,
        message: error instanceof Error ? error.message : "Invalid tool input.",
      });
    }
  }
  return response(undefined, { code: -32601, message: "Method not found." });
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "ProgramLoom Developer API",
    version: "1.0.0",
    summary:
      "Manage authorized event, session, speaker, contact, agenda, content, and webhook records.",
    description:
      "A stable, organization-scoped API. Collection responses are paginated. Consequential creates, deletes, restores, and bulk mutations require Idempotency-Key. Updates require If-Match.",
    license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
  },
  servers: [{ url: "https://app.programloom.com/api/v1" }],
  security: [{ accessToken: [] }],
  components: {
    securitySchemes: {
      accessToken: {
        type: "apiKey",
        in: "header",
        name: "x-access-token",
        description:
          "Create an organization token in Workspace settings. The full token is shown once.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "requestId"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
          requestId: { type: "string" },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          hasMore: { type: "boolean" },
        },
      },
    },
  },
  paths: {
    "/events": {
      get: {
        summary: "List accessible events",
        responses: { "200": { description: "Paginated events" } },
      },
      post: {
        summary: "Create an event for an unrestricted organization token",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "201": { description: "Created event" } },
      },
    },
    "/events/{eventId}": {
      get: {
        summary: "Retrieve an event",
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Event" } },
      },
      patch: {
        summary: "Version-update an event",
        parameters: [
          {
            name: "If-Match",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "Updated event" } },
      },
    },
    "/sessions": {
      get: {
        summary: "Search sessions",
        responses: { "200": { description: "Paginated sessions" } },
      },
      post: {
        summary: "Create a session",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "201": { description: "Created session" } },
      },
    },
    "/submissions": {
      get: {
        summary: "Search CFP submissions with token-level PII masking",
        responses: { "200": { description: "Paginated submissions" } },
      },
    },
    "/submissions/{submissionId}": {
      get: {
        summary: "Retrieve an accessible CFP submission",
        responses: { "200": { description: "Submission" } },
      },
    },
    "/sessions/{sessionId}": {
      get: {
        summary: "Retrieve a session",
        responses: { "200": { description: "Session" } },
      },
      patch: {
        summary: "Update a session",
        parameters: [
          {
            name: "If-Match",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Updated session" },
          "412": { description: "Version conflict" },
        },
      },
      delete: {
        summary: "Soft-delete a session",
        responses: { "200": { description: "Deleted state" } },
      },
    },
    "/sessions/bulk": {
      post: {
        summary: "Mutate up to 100 sessions",
        responses: { "200": { description: "Mutation results" } },
      },
    },
    "/sessions/{sessionId}/custom-fields": {
      patch: {
        summary: "Merge authorized session custom-field values",
        responses: { "200": { description: "Updated custom fields" } },
      },
    },
    "/sessions/{sessionId}/restore": {
      post: {
        summary: "Restore a soft-deleted session",
        responses: { "200": { description: "Restored session" } },
      },
    },
    "/events/{eventId}/speakers": {
      get: {
        summary: "Search event speakers",
        responses: { "200": { description: "Paginated speakers" } },
      },
    },
    "/contacts": {
      get: {
        summary: "Search contacts",
        responses: { "200": { description: "Paginated contacts" } },
      },
      post: {
        summary: "Create a contact",
        responses: { "201": { description: "Contact" } },
      },
    },
    "/contacts/{contactId}": {
      get: {
        summary: "Retrieve an accessible contact",
        responses: { "200": { description: "Contact" } },
      },
      patch: {
        summary: "Version-update a contact",
        responses: { "200": { description: "Updated contact" } },
      },
      delete: {
        summary: "Soft-delete a contact",
        responses: { "200": { description: "Deleted state" } },
      },
    },
    "/contacts/{contactId}/restore": {
      post: {
        summary: "Restore a soft-deleted contact",
        responses: { "200": { description: "Restored contact" } },
      },
    },
    "/contacts/{contactId}/sessions": {
      get: {
        summary: "Retrieve a contact's sessions",
        responses: { "200": { description: "Sessions" } },
      },
    },
    "/events/{eventId}/metadata": {
      get: {
        summary: "List rooms, tracks, formats, tags, statuses, and fields",
        responses: { "200": { description: "Event metadata" } },
      },
    },
    "/events/{eventId}/metadata/{kind}": {
      post: {
        summary: "Create a room, track, tag, or format",
        responses: { "201": { description: "Created metadata" } },
      },
    },
    "/events/{eventId}/metadata/{kind}/{id}": {
      patch: {
        summary: "Version-update event metadata",
        responses: { "200": { description: "Updated metadata" } },
      },
      delete: {
        summary: "Delete event metadata",
        responses: { "200": { description: "Deleted metadata" } },
      },
    },
    "/events/{eventId}/agenda": {
      get: {
        summary: "Retrieve published agenda or authorized draft",
        responses: { "200": { description: "Agenda" } },
      },
      post: {
        summary: "Place an accepted session transactionally",
        responses: {
          "201": { description: "Created draft agenda placement" },
          "409": { description: "Room or speaker conflict" },
        },
      },
    },
    "/events/{eventId}/agenda/{itemId}": {
      patch: {
        summary: "Version-move an agenda placement",
        responses: {
          "200": { description: "Moved placement" },
          "409": { description: "Nothing moved because of a conflict" },
        },
      },
    },
    "/events/{eventId}/files": {
      get: {
        summary: "List session files",
        responses: { "200": { description: "Files" } },
      },
    },
    "/events/{eventId}/files/{fileId}/download": {
      post: {
        summary: "Create a short-lived authorized file download",
        responses: { "200": { description: "Expiring download URL" } },
      },
    },
    "/query": {
      post: {
        summary: "Run a bounded read-only structured query",
        responses: { "200": { description: "Query result" } },
      },
    },
    "/query/schema": {
      get: {
        summary: "Discover the bounded structured-query schema",
        responses: { "200": { description: "Query schema" } },
      },
    },
    "/mcp": {
      post: {
        summary: "Remote MCP JSON-RPC endpoint",
        responses: { "200": { description: "MCP response" } },
      },
    },
  },
} as const;

router.get("/openapi.json", (context) => context.json(openApiDocument));
router.get("/docs", (context) =>
  context.json({
    title: "ProgramLoom Developer API",
    version: "v1",
    authentication:
      "Send the token in x-access-token. Never place it in a query string.",
    pagination:
      "Collections default to 25 records and accept limit up to 100 plus a 1-based page.",
    rateLimits:
      "Responses include X-RateLimit-Limit, Remaining, and Reset. Exceeding the limit returns 429.",
    errors: "Errors use { error: { code, message, details? }, requestId }.",
    webhooks:
      "Verify HMAC-SHA256 over `${timestamp}.${rawBody}` using the one-time subscription secret and x-programloom-signature.",
    versioning:
      "Breaking changes require a new URL version. Deprecated v1 behavior receives at least 180 days notice in the changelog.",
    examples: {
      curl: "curl -H 'x-access-token: $PROGRAMLOOM_TOKEN' 'https://app.programloom.com/api/v1/events?limit=25'",
      javascript:
        "const response = await fetch('https://app.programloom.com/api/v1/events', { headers: { 'x-access-token': process.env.PROGRAMLOOM_TOKEN } });",
      python:
        "requests.get('https://app.programloom.com/api/v1/events', headers={'x-access-token': os.environ['PROGRAMLOOM_TOKEN']})",
    },
    links: {
      openapi: "/api/v1/openapi.json",
      collection: "/api/v1/collection.json",
      changelog: "/api/v1/changelog",
    },
  }),
);
router.get("/changelog", (context) =>
  context.json({
    policy:
      "Breaking changes ship in a new major URL version with at least 180 days deprecation notice.",
    releases: [
      {
        version: "1.0.0",
        date: "2026-08-11",
        changes: [
          "Initial stable REST API, signed webhooks, structured query API, and remote MCP endpoint.",
        ],
      },
    ],
  }),
);
router.get("/collection.json", (context) =>
  context.json({
    info: {
      name: "ProgramLoom v1",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: "https://app.programloom.com/api/v1" },
      { key: "token", value: "" },
      { key: "eventId", value: "" },
      { key: "sessionId", value: "" },
      { key: "contactId", value: "" },
    ],
    auth: {
      type: "apikey",
      apikey: [
        { key: "key", value: "x-access-token", type: "string" },
        { key: "value", value: "{{token}}", type: "string" },
        { key: "in", value: "header", type: "string" },
      ],
    },
    item: [
      {
        name: "List events",
        request: { method: "GET", url: "{{baseUrl}}/events?limit=25" },
      },
      {
        name: "Search sessions",
        request: {
          method: "GET",
          url: "{{baseUrl}}/sessions?search=engineering&limit=25",
        },
      },
      {
        name: "Search submissions",
        request: {
          method: "GET",
          url: "{{baseUrl}}/submissions?eventId={{eventId}}&limit=25",
        },
      },
      {
        name: "List event speakers",
        request: {
          method: "GET",
          url: "{{baseUrl}}/events/{{eventId}}/speakers?limit=25",
        },
      },
      {
        name: "Search contacts",
        request: { method: "GET", url: "{{baseUrl}}/contacts?limit=25" },
      },
      {
        name: "Contact sessions",
        request: {
          method: "GET",
          url: "{{baseUrl}}/contacts/{{contactId}}/sessions",
        },
      },
      {
        name: "Event metadata",
        request: {
          method: "GET",
          url: "{{baseUrl}}/events/{{eventId}}/metadata",
        },
      },
      {
        name: "List event agenda",
        request: {
          method: "GET",
          url: "{{baseUrl}}/events/{{eventId}}/agenda",
        },
      },
      {
        name: "List event files",
        request: {
          method: "GET",
          url: "{{baseUrl}}/events/{{eventId}}/files?limit=25",
        },
      },
      {
        name: "Structured query",
        request: {
          method: "POST",
          header: [{ key: "Content-Type", value: "application/json" }],
          body: {
            mode: "raw",
            raw: '{"entity":"sessions","fields":["id","eventId","title"],"filters":{"eventId":"{{eventId}}"},"limit":25}',
          },
          url: "{{baseUrl}}/query",
        },
      },
      {
        name: "MCP tools list",
        request: {
          method: "POST",
          header: [{ key: "Content-Type", value: "application/json" }],
          body: {
            mode: "raw",
            raw: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
          },
          url: "{{baseUrl}}/mcp",
        },
      },
    ],
  }),
);

export default router;
