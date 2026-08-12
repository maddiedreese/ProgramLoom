import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { database, HttpError, requireUser } from "../lib/authz";

type Variables = { requestId: string };
type Scope = {
  eventId: string;
  eventName: string;
  organizationId: string;
  organizationName: string;
  role: "owner" | "admin" | "member" | "reviewer" | "speaker";
};
type OrganizationScope = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
};
export type SearchResult = {
  type:
    | "event"
    | "cfp_form"
    | "submission"
    | "session"
    | "speaker"
    | "crm_contact"
    | "reviewer"
    | "task"
    | "file"
    | "resource"
    | "saved_view"
    | "communication";
  id: string;
  label: string;
  context: string;
  path: string;
  organizationId: string;
  eventId: string | null;
  rank?: number;
};

const searchSchema = z.object({
  q: z.string().trim().max(100).default(""),
  eventId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const recentSchema = z.object({
  entityType: z.enum([
    "event",
    "cfp_form",
    "submission",
    "session",
    "speaker",
    "crm_contact",
    "reviewer",
    "task",
    "file",
    "resource",
    "saved_view",
    "communication",
  ]),
  entityId: z.string().trim().min(1).max(128),
  eventId: z.string().uuid().nullable(),
  organizationId: z.string().uuid(),
});

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.get("/", zValidator("query", searchSchema), async (context) => {
  const started = Date.now();
  const user = await requireUser(context);
  const input = context.req.valid("query");
  const db = database(context.env);
  const [allScopes, allOrganizations] = await Promise.all([
    authorizedScopes(db, user.id),
    authorizedOrganizations(db, user.id),
  ]);
  let scopes = allScopes;
  if (input.eventId)
    scopes = scopes.filter((scope) => scope.eventId === input.eventId);
  if (input.organizationId)
    scopes = scopes.filter(
      (scope) => scope.organizationId === input.organizationId,
    );
  const organizations = input.organizationId
    ? allOrganizations.filter((item) => item.id === input.organizationId)
    : allOrganizations;
  if (
    (input.eventId && !scopes.length) ||
    (input.organizationId && !scopes.length && !organizations.length)
  )
    throw new HttpError(404, "scope_not_found", "Search scope not found.");

  const results = input.q
    ? await searchEntities(db, user, scopes, organizations, input.q)
    : [];
  const ranked = rankResults(results, input.q).slice(0, input.limit);
  const recent = input.q
    ? []
    : await recentDestinations(db, user, allScopes, allOrganizations);
  const actions = quickActions(
    scopes,
    organizations,
    input.eventId,
    input.organizationId,
  );
  console.log(
    JSON.stringify({
      level: "info",
      service: "organizer_search",
      requestId: context.get("requestId"),
      eventScopeCount: scopes.length,
      resultCount: ranked.length,
      queryLength: input.q.length,
      durationMs: Date.now() - started,
    }),
  );
  return context.json({
    results: ranked,
    recent,
    actions,
    scope: {
      events: allScopes.map((scope) => ({
        id: scope.eventId,
        name: scope.eventName,
        organizationId: scope.organizationId,
        organizationName: scope.organizationName,
        role: scope.role,
      })),
      organizations: allOrganizations,
    },
  });
});

router.post("/recent", zValidator("json", recentSchema), async (context) => {
  const user = await requireUser(context);
  const input = context.req.valid("json");
  const db = database(context.env);
  const [scopes, organizations] = await Promise.all([
    authorizedScopes(db, user.id),
    authorizedOrganizations(db, user.id),
  ]);
  const scoped = scopes.filter(
    (scope) =>
      scope.organizationId === input.organizationId &&
      (!input.eventId || scope.eventId === input.eventId),
  );
  const organization = organizations.filter(
    (item) => item.id === input.organizationId,
  );
  if (
    (input.eventId && !scoped.length) ||
    (!input.eventId && !organization.length)
  )
    throw new HttpError(404, "result_not_found", "Search result not found.");
  const permitted = await resolveEntity(
    db,
    user,
    scoped,
    organization,
    input.entityType,
    input.entityId,
  );
  if (!permitted)
    throw new HttpError(404, "result_not_found", "Search result not found.");
  await db
    .prepare(
      `INSERT INTO search_recent_destinations
       (user_id,organization_id,event_id,entity_type,entity_id,last_accessed_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id,entity_type,entity_id) DO UPDATE SET
         organization_id=excluded.organization_id,event_id=excluded.event_id,last_accessed_at=excluded.last_accessed_at`,
    )
    .bind(
      user.id,
      permitted.organizationId,
      permitted.eventId,
      permitted.type,
      permitted.id,
      new Date().toISOString(),
    )
    .run();
  await db
    .prepare(
      `DELETE FROM search_recent_destinations
       WHERE user_id=? AND rowid NOT IN (
         SELECT rowid FROM search_recent_destinations
         WHERE user_id=? ORDER BY last_accessed_at DESC,entity_type,entity_id LIMIT 20
       )`,
    )
    .bind(user.id, user.id)
    .run();
  return context.json({ ok: true });
});

async function authorizedScopes(db: D1Database, userId: string) {
  const rows = await db
    .prepare(
      `SELECT e.id eventId,e.name eventName,e.organization_id organizationId,o.name organizationName,
       CASE
         WHEN om.role IN ('owner','admin') THEN om.role
         WHEN em.role IS NOT NULL THEN em.role
         ELSE om.role
       END role
       FROM events e JOIN organizations o ON o.id=e.organization_id
       LEFT JOIN organization_members om ON om.organization_id=e.organization_id AND om.user_id=?
       LEFT JOIN event_members em ON em.event_id=e.id AND em.user_id=?
       WHERE om.role IN ('owner','admin','member') OR em.role IN ('owner','admin','reviewer','speaker')
       ORDER BY e.starts_at DESC LIMIT 100`,
    )
    .bind(userId, userId)
    .all<Scope>();
  return rows.results;
}

async function authorizedOrganizations(db: D1Database, userId: string) {
  const rows = await db
    .prepare(
      `SELECT o.id,o.name,om.role FROM organization_members om
       JOIN organizations o ON o.id=om.organization_id
       WHERE om.user_id=? AND om.role IN ('owner','admin','member')
       ORDER BY o.created_at LIMIT 50`,
    )
    .bind(userId)
    .all<OrganizationScope>();
  return rows.results;
}

async function searchEntities(
  db: D1Database,
  user: { id: string; email: string },
  scopes: Scope[],
  organizations: OrganizationScope[],
  query: string,
): Promise<SearchResult[]> {
  const eventIds = unique(scopes.map((scope) => scope.eventId));
  const organizerEvents = unique(
    scopes
      .filter((scope) => ["owner", "admin", "member"].includes(scope.role))
      .map((scope) => scope.eventId),
  );
  const managingEvents = unique(
    scopes
      .filter((scope) => ["owner", "admin"].includes(scope.role))
      .map((scope) => scope.eventId),
  );
  const reviewerEvents = unique(
    scopes
      .filter((scope) => scope.role === "reviewer")
      .map((scope) => scope.eventId),
  );
  const speakerEvents = unique(
    scopes
      .filter((scope) => scope.role === "speaker")
      .map((scope) => scope.eventId),
  );
  const organizerOrganizations = organizations.map((item) => item.id);
  const terms = searchTerms(query);
  const tasks = [
    queryRows(
      db,
      `SELECT e.id,e.name label,o.name context,e.organization_id organizationId,e.id eventId
       FROM events e JOIN organizations o ON o.id=e.organization_id
       WHERE e.id IN (${marks(eventIds)}) AND ${match("e.name", "o.name")}
       ORDER BY e.updated_at DESC LIMIT 30`,
      [...eventIds, ...terms],
      (row) => result("event", row, `/app/events/${row.id}`),
    ),
    organizerEvents.length
      ? queryRows(
          db,
          `SELECT f.id,f.name label,e.name context,e.organization_id organizationId,f.event_id eventId
           FROM cfp_forms f JOIN events e ON e.id=f.event_id
           WHERE f.event_id IN (${marks(organizerEvents)}) AND ${match("f.name", "f.description")}
           ORDER BY f.updated_at DESC LIMIT 30`,
          [...organizerEvents, ...terms],
          (row) =>
            result(
              "cfp_form",
              row,
              `/app/events/${row.eventId}?form=${row.id}`,
            ),
        )
      : Promise.resolve([]),
    searchSubmissions(
      db,
      user.id,
      organizerEvents,
      reviewerEvents,
      speakerEvents,
      terms,
    ),
    searchSessions(
      db,
      user.id,
      organizerEvents,
      reviewerEvents,
      speakerEvents,
      terms,
    ),
    searchSpeakers(db, user.id, managingEvents, speakerEvents, terms),
    organizerOrganizations.length
      ? queryRows(
          db,
          `SELECT c.id,TRIM(c.first_name||' '||c.last_name) label,
           COALESCE(c.company,'CRM contact') context,c.organization_id organizationId,NULL eventId
           FROM crm_contacts c WHERE c.organization_id IN (${marks(organizerOrganizations)})
           AND ${match("TRIM(c.first_name||' '||c.last_name)", "COALESCE(c.company,'')")}
           ORDER BY c.updated_at DESC LIMIT 30`,
          [...organizerOrganizations, ...terms],
          (row) =>
            result(
              "crm_contact",
              row,
              `/app/crm?organization=${row.organizationId}&contact=${row.id}`,
            ),
        )
      : Promise.resolve([]),
    managingEvents.length
      ? queryRows(
          db,
          `SELECT DISTINCT u.id,u.name label,e.name context,e.organization_id organizationId,em.event_id eventId
           FROM event_members em JOIN users u ON u.id=em.user_id JOIN events e ON e.id=em.event_id
           WHERE em.role='reviewer' AND em.event_id IN (${marks(managingEvents)})
           AND ${match("u.name", "e.name")} ORDER BY u.name LIMIT 30`,
          [...managingEvents, ...terms],
          (row) =>
            result(
              "reviewer",
              row,
              `/app/team?organization=${row.organizationId}&eventId=${row.eventId}#member-${row.id}`,
            ),
        )
      : Promise.resolve([]),
    searchTasks(db, user.id, organizerEvents, speakerEvents, terms),
    searchFiles(db, user.id, organizerEvents, speakerEvents, terms),
    queryRows(
      db,
      `SELECT r.id,r.title label,e.name context,e.organization_id organizationId,r.event_id eventId
       FROM resources r JOIN events e ON e.id=r.event_id
       WHERE r.event_id IN (${marks(eventIds)})
       AND (r.event_id IN (${marks(organizerEvents, true)}) OR r.published_at IS NOT NULL)
       AND ${match("r.title", "''")} ORDER BY r.updated_at DESC LIMIT 30`,
      [...eventIds, ...organizerEvents, ...terms],
      (row) =>
        result(
          "resource",
          row,
          `/app/events/${row.eventId}/speakers#resource-${row.id}`,
        ),
    ),
    organizerEvents.length
      ? queryRows(
          db,
          `SELECT v.id,v.name label,e.name context,v.organization_id organizationId,v.event_id eventId
           FROM submission_saved_views v JOIN events e ON e.id=v.event_id
           WHERE v.event_id IN (${marks(organizerEvents)})
           AND (v.owner_user_id=? OR v.visibility='organization') AND ${match("v.name", "e.name")}
           ORDER BY v.updated_at DESC LIMIT 30`,
          [...organizerEvents, user.id, ...terms],
          (row) =>
            result(
              "saved_view",
              row,
              `/app/events/${row.eventId}/submissions?view=${row.id}`,
            ),
        )
      : Promise.resolve([]),
    searchCommunications(
      db,
      user.id,
      user.email,
      managingEvents,
      speakerEvents,
      terms,
    ),
  ];
  const groups = await Promise.all(tasks);
  return deduplicate(groups.flat());
}

async function searchSubmissions(
  db: D1Database,
  userId: string,
  organizerEvents: string[],
  reviewerEvents: string[],
  speakerEvents: string[],
  terms: unknown[],
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (organizerEvents.length) {
    conditions.push(`s.event_id IN (${marks(organizerEvents)})`);
    values.push(...organizerEvents);
  }
  if (reviewerEvents.length) {
    conditions.push(
      `(s.event_id IN (${marks(reviewerEvents)}) AND EXISTS (
        SELECT 1 FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id
        WHERE ra.submission_id=s.id AND ra.reviewer_user_id=? AND rr.event_id=s.event_id))`,
    );
    values.push(...reviewerEvents, userId);
  }
  if (speakerEvents.length) {
    conditions.push(
      `(s.event_id IN (${marks(speakerEvents)}) AND EXISTS (
        SELECT 1 FROM session_speakers ss JOIN speaker_profiles sp ON sp.id=ss.speaker_id
        WHERE ss.submission_id=s.id AND sp.user_id=?))`,
    );
    values.push(...speakerEvents, userId);
  }
  if (!conditions.length) return [];
  return queryRows(
    db,
    `SELECT s.id,s.title label,CASE
       WHEN s.event_id IN (${marks(organizerEvents, true)}) THEN COALESCE(s.format,e.name)
       ELSE e.name END context,e.organization_id organizationId,s.event_id eventId
     FROM submissions s JOIN events e ON e.id=s.event_id
     WHERE (${conditions.join(" OR ")}) AND ${match("s.title", "s.abstract")}
     ORDER BY s.updated_at DESC LIMIT 40`,
    [...organizerEvents, ...values, ...terms],
    (row) =>
      result(
        "submission",
        row,
        `/app/events/${row.eventId}/submissions?submission=${row.id}`,
      ),
  );
}

async function searchSessions(
  db: D1Database,
  userId: string,
  organizerEvents: string[],
  reviewerEvents: string[],
  speakerEvents: string[],
  terms: unknown[],
) {
  const visible = organizerEvents;
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (visible.length) {
    conditions.push(`a.event_id IN (${marks(visible)})`);
    values.push(...visible);
  }
  if (reviewerEvents.length) {
    conditions.push(
      `(a.event_id IN (${marks(reviewerEvents)}) AND a.status='published')`,
    );
    values.push(...reviewerEvents);
  }
  if (speakerEvents.length) {
    conditions.push(
      `(a.event_id IN (${marks(speakerEvents)}) AND EXISTS (
        SELECT 1 FROM session_speakers ss JOIN speaker_profiles sp ON sp.id=ss.speaker_id
        WHERE ss.submission_id=a.submission_id AND sp.user_id=?))`,
    );
    values.push(...speakerEvents, userId);
  }
  if (!conditions.length) return [];
  return queryRows(
    db,
    `SELECT a.id,a.title label,COALESCE(r.name,e.name) context,e.organization_id organizationId,a.event_id eventId
     FROM agenda_items a JOIN events e ON e.id=a.event_id LEFT JOIN rooms r ON r.id=a.room_id
     WHERE (${conditions.join(" OR ")}) AND ${match("a.title", "a.description")}
     ORDER BY a.updated_at DESC LIMIT 30`,
    [...values, ...terms],
    (row) =>
      result(
        "session",
        row,
        `/app/events/${row.eventId}/agenda#agenda-item-${row.id}`,
      ),
  );
}

async function searchSpeakers(
  db: D1Database,
  userId: string,
  managingEvents: string[],
  speakerEvents: string[],
  terms: unknown[],
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (managingEvents.length) {
    conditions.push(`s.event_id IN (${marks(managingEvents)})`);
    values.push(...managingEvents);
  }
  if (speakerEvents.length) {
    conditions.push(
      `(s.event_id IN (${marks(speakerEvents)}) AND sp.user_id=?)`,
    );
    values.push(...speakerEvents, userId);
  }
  if (!conditions.length) return [];
  return queryRows(
    db,
    `SELECT DISTINCT sp.id,TRIM(sp.first_name||' '||sp.last_name) label,
     COALESCE(sp.company,e.name) context,e.organization_id organizationId,s.event_id eventId
     FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id
     JOIN submissions s ON s.id=ss.submission_id JOIN events e ON e.id=s.event_id
     WHERE (${conditions.join(" OR ")})
     AND ${match("TRIM(sp.first_name||' '||sp.last_name)", "COALESCE(sp.company,'')")}
     ORDER BY sp.updated_at DESC LIMIT 30`,
    [...values, ...terms],
    (row) =>
      result(
        "speaker",
        row,
        `/app/events/${row.eventId}/speakers#speaker-${row.id}`,
      ),
  );
}

async function searchTasks(
  db: D1Database,
  userId: string,
  organizerEvents: string[],
  speakerEvents: string[],
  terms: unknown[],
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (organizerEvents.length) {
    conditions.push(`t.event_id IN (${marks(organizerEvents)})`);
    values.push(...organizerEvents);
  }
  if (speakerEvents.length) {
    conditions.push(
      `(t.event_id IN (${marks(speakerEvents)}) AND EXISTS (
        SELECT 1 FROM speaker_task_assignments sta JOIN speaker_profiles sp ON sp.id=sta.speaker_id
        WHERE sta.task_id=t.id AND sp.user_id=?))`,
    );
    values.push(...speakerEvents, userId);
  }
  if (!conditions.length) return [];
  return queryRows(
    db,
    `SELECT t.id,t.title label,e.name context,e.organization_id organizationId,t.event_id eventId
     FROM onboarding_tasks t JOIN events e ON e.id=t.event_id
     WHERE (${conditions.join(" OR ")}) AND ${match("t.title", "t.description")}
     ORDER BY t.due_at DESC LIMIT 30`,
    [...values, ...terms],
    (row) =>
      result("task", row, `/app/events/${row.eventId}/speakers#task-${row.id}`),
  );
}

async function searchFiles(
  db: D1Database,
  userId: string,
  organizerEvents: string[],
  speakerEvents: string[],
  terms: unknown[],
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (organizerEvents.length) {
    conditions.push(`f.event_id IN (${marks(organizerEvents)})`);
    values.push(...organizerEvents);
  }
  if (speakerEvents.length) {
    conditions.push(
      `(f.event_id IN (${marks(speakerEvents)}) AND EXISTS (
        SELECT 1 FROM speaker_profiles sp WHERE sp.id=f.speaker_id AND sp.user_id=?))`,
    );
    values.push(...speakerEvents, userId);
  }
  if (!conditions.length) return [];
  return queryRows(
    db,
    `SELECT f.id,COALESCE((SELECT fv.filename FROM file_versions fv WHERE fv.file_id=f.id ORDER BY fv.version_number DESC LIMIT 1),f.purpose) label,
     f.purpose context,f.organization_id organizationId,f.event_id eventId
     FROM files f WHERE (${conditions.join(" OR ")}) AND ${match("f.purpose", "COALESCE((SELECT fv.filename FROM file_versions fv WHERE fv.file_id=f.id ORDER BY fv.version_number DESC LIMIT 1),'')")}
     ORDER BY f.updated_at DESC LIMIT 30`,
    [...values, ...terms],
    (row) =>
      result("file", row, `/app/events/${row.eventId}/content?file=${row.id}`),
  );
}

async function searchCommunications(
  db: D1Database,
  userId: string,
  email: string,
  managingEvents: string[],
  speakerEvents: string[],
  terms: unknown[],
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (managingEvents.length) {
    conditions.push(`m.event_id IN (${marks(managingEvents)})`);
    values.push(...managingEvents);
  }
  if (speakerEvents.length) {
    conditions.push(
      `(m.event_id IN (${marks(speakerEvents)}) AND (m.recipient_user_id=? OR m.recipient_email=? COLLATE NOCASE))`,
    );
    values.push(...speakerEvents, userId, email);
  }
  if (!conditions.length) return [];
  return queryRows(
    db,
    `SELECT m.id,m.subject label,m.category||' · '||m.status context,m.organization_id organizationId,m.event_id eventId
     FROM communication_messages m WHERE (${conditions.join(" OR ")})
     AND ${match("m.subject", "m.category")} ORDER BY m.created_at DESC LIMIT 30`,
    [...values, ...terms],
    (row) =>
      result(
        "communication",
        row,
        `/app/events/${row.eventId}/communications?message=${row.id}`,
      ),
  );
}

async function recentDestinations(
  db: D1Database,
  user: { id: string; email: string },
  scopes: Scope[],
  organizations: OrganizationScope[],
) {
  const rows = await db
    .prepare(
      `SELECT entity_type entityType,entity_id entityId,organization_id organizationId,event_id eventId
       FROM search_recent_destinations WHERE user_id=? ORDER BY last_accessed_at DESC LIMIT 12`,
    )
    .bind(user.id)
    .all<{
      entityType: SearchResult["type"];
      entityId: string;
      organizationId: string;
      eventId: string | null;
    }>();
  const resolved = await Promise.all(
    rows.results.map((row) =>
      resolveEntity(
        db,
        user,
        scopes.filter(
          (scope) =>
            scope.organizationId === row.organizationId &&
            (!row.eventId || scope.eventId === row.eventId),
        ),
        organizations.filter(
          (organization) => organization.id === row.organizationId,
        ),
        row.entityType,
        row.entityId,
      ),
    ),
  );
  return resolved.filter((item): item is SearchResult => Boolean(item));
}

async function resolveEntity(
  db: D1Database,
  user: { id: string; email: string },
  scopes: Scope[],
  organizations: OrganizationScope[],
  type: SearchResult["type"],
  id: string,
) {
  const eventIds = unique(scopes.map((scope) => scope.eventId));
  const organizerEvents = unique(
    scopes
      .filter((scope) => ["owner", "admin", "member"].includes(scope.role))
      .map((scope) => scope.eventId),
  );
  const managingEvents = unique(
    scopes
      .filter((scope) => ["owner", "admin"].includes(scope.role))
      .map((scope) => scope.eventId),
  );
  const reviewerEvents = unique(
    scopes
      .filter((scope) => scope.role === "reviewer")
      .map((scope) => scope.eventId),
  );
  const speakerEvents = unique(
    scopes
      .filter((scope) => scope.role === "speaker")
      .map((scope) => scope.eventId),
  );
  const organizerOrganizations = organizations.map((item) => item.id);
  const row = async (sql: string, values: unknown[]) =>
    db
      .prepare(sql)
      .bind(...values)
      .first<Record<string, string>>();
  let item: Record<string, string> | null = null;
  if (type === "event") {
    item = await row(
      `SELECT e.id,e.name label,o.name context,e.organization_id organizationId,e.id eventId
       FROM events e JOIN organizations o ON o.id=e.organization_id
       WHERE e.id=? AND e.id IN (${marks(eventIds)})`,
      [id, ...eventIds],
    );
    return item ? result(type, item, `/app/events/${item.id}`) : null;
  }
  if (type === "cfp_form" && organizerEvents.length) {
    item = await row(
      `SELECT f.id,f.name label,e.name context,e.organization_id organizationId,f.event_id eventId
       FROM cfp_forms f JOIN events e ON e.id=f.event_id
       WHERE f.id=? AND f.event_id IN (${marks(organizerEvents)})`,
      [id, ...organizerEvents],
    );
    return item
      ? result(type, item, `/app/events/${item.eventId}?form=${item.id}`)
      : null;
  }
  if (type === "submission") {
    const conditions: string[] = [];
    const values: unknown[] = [id];
    if (organizerEvents.length) {
      conditions.push(`s.event_id IN (${marks(organizerEvents)})`);
      values.push(...organizerEvents);
    }
    if (reviewerEvents.length) {
      conditions.push(
        `(s.event_id IN (${marks(reviewerEvents)}) AND EXISTS (
          SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.reviewer_user_id=?))`,
      );
      values.push(...reviewerEvents, user.id);
    }
    if (speakerEvents.length) {
      conditions.push(
        `(s.event_id IN (${marks(speakerEvents)}) AND EXISTS (
          SELECT 1 FROM session_speakers ss JOIN speaker_profiles sp ON sp.id=ss.speaker_id
          WHERE ss.submission_id=s.id AND sp.user_id=?))`,
      );
      values.push(...speakerEvents, user.id);
    }
    if (!conditions.length) return null;
    item = await row(
      `SELECT s.id,s.title label,e.name context,e.organization_id organizationId,s.event_id eventId
       FROM submissions s JOIN events e ON e.id=s.event_id
       WHERE s.id=? AND (${conditions.join(" OR ")})`,
      values,
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/submissions?submission=${item.id}`,
        )
      : null;
  }
  if (type === "session") {
    const conditions: string[] = [];
    const values: unknown[] = [id];
    if (organizerEvents.length) {
      conditions.push(`a.event_id IN (${marks(organizerEvents)})`);
      values.push(...organizerEvents);
    }
    if (reviewerEvents.length) {
      conditions.push(
        `(a.event_id IN (${marks(reviewerEvents)}) AND a.status='published')`,
      );
      values.push(...reviewerEvents);
    }
    if (speakerEvents.length) {
      conditions.push(
        `(a.event_id IN (${marks(speakerEvents)}) AND EXISTS (
          SELECT 1 FROM session_speakers ss JOIN speaker_profiles sp ON sp.id=ss.speaker_id
          WHERE ss.submission_id=a.submission_id AND sp.user_id=?))`,
      );
      values.push(...speakerEvents, user.id);
    }
    if (!conditions.length) return null;
    item = await row(
      `SELECT a.id,a.title label,COALESCE(r.name,e.name) context,e.organization_id organizationId,a.event_id eventId
       FROM agenda_items a JOIN events e ON e.id=a.event_id LEFT JOIN rooms r ON r.id=a.room_id
       WHERE a.id=? AND (${conditions.join(" OR ")})`,
      values,
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/agenda#agenda-item-${item.id}`,
        )
      : null;
  }
  if (type === "speaker") {
    const conditions: string[] = [];
    const values: unknown[] = [id];
    if (managingEvents.length) {
      conditions.push(`s.event_id IN (${marks(managingEvents)})`);
      values.push(...managingEvents);
    }
    if (speakerEvents.length) {
      conditions.push(
        `(s.event_id IN (${marks(speakerEvents)}) AND sp.user_id=?)`,
      );
      values.push(...speakerEvents, user.id);
    }
    if (!conditions.length) return null;
    item = await row(
      `SELECT DISTINCT sp.id,TRIM(sp.first_name||' '||sp.last_name) label,COALESCE(sp.company,e.name) context,
       e.organization_id organizationId,s.event_id eventId FROM speaker_profiles sp
       JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id
       JOIN events e ON e.id=s.event_id WHERE sp.id=? AND (${conditions.join(" OR ")}) LIMIT 1`,
      values,
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/speakers#speaker-${item.id}`,
        )
      : null;
  }
  if (type === "crm_contact" && organizerOrganizations.length) {
    item = await row(
      `SELECT c.id,TRIM(c.first_name||' '||c.last_name) label,COALESCE(c.company,'CRM contact') context,
       c.organization_id organizationId,NULL eventId FROM crm_contacts c
       WHERE c.id=? AND c.organization_id IN (${marks(organizerOrganizations)})`,
      [id, ...organizerOrganizations],
    );
    return item
      ? result(
          type,
          item,
          `/app/crm?organization=${item.organizationId}&contact=${item.id}`,
        )
      : null;
  }
  if (type === "reviewer" && managingEvents.length) {
    item = await row(
      `SELECT u.id,u.name label,e.name context,e.organization_id organizationId,em.event_id eventId
       FROM event_members em JOIN users u ON u.id=em.user_id JOIN events e ON e.id=em.event_id
       WHERE u.id=? AND em.role='reviewer' AND em.event_id IN (${marks(managingEvents)}) LIMIT 1`,
      [id, ...managingEvents],
    );
    return item
      ? result(
          type,
          item,
          `/app/team?organization=${item.organizationId}&eventId=${item.eventId}#member-${item.id}`,
        )
      : null;
  }
  if (type === "task") {
    const conditions: string[] = [];
    const values: unknown[] = [id];
    if (organizerEvents.length) {
      conditions.push(`t.event_id IN (${marks(organizerEvents)})`);
      values.push(...organizerEvents);
    }
    if (speakerEvents.length) {
      conditions.push(
        `(t.event_id IN (${marks(speakerEvents)}) AND EXISTS (
          SELECT 1 FROM speaker_task_assignments sta JOIN speaker_profiles sp ON sp.id=sta.speaker_id
          WHERE sta.task_id=t.id AND sp.user_id=?))`,
      );
      values.push(...speakerEvents, user.id);
    }
    if (!conditions.length) return null;
    item = await row(
      `SELECT t.id,t.title label,e.name context,e.organization_id organizationId,t.event_id eventId
       FROM onboarding_tasks t JOIN events e ON e.id=t.event_id
       WHERE t.id=? AND (${conditions.join(" OR ")})`,
      values,
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/speakers#task-${item.id}`,
        )
      : null;
  }
  if (type === "file") {
    const conditions: string[] = [];
    const values: unknown[] = [id];
    if (organizerEvents.length) {
      conditions.push(`f.event_id IN (${marks(organizerEvents)})`);
      values.push(...organizerEvents);
    }
    if (speakerEvents.length) {
      conditions.push(
        `(f.event_id IN (${marks(speakerEvents)}) AND EXISTS (
          SELECT 1 FROM speaker_profiles sp WHERE sp.id=f.speaker_id AND sp.user_id=?))`,
      );
      values.push(...speakerEvents, user.id);
    }
    if (!conditions.length) return null;
    item = await row(
      `SELECT f.id,COALESCE((SELECT fv.filename FROM file_versions fv WHERE fv.file_id=f.id ORDER BY fv.version_number DESC LIMIT 1),f.purpose) label,
       f.purpose context,f.organization_id organizationId,f.event_id eventId FROM files f
       WHERE f.id=? AND (${conditions.join(" OR ")})`,
      values,
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/content?file=${item.id}`,
        )
      : null;
  }
  if (type === "resource") {
    item = await row(
      `SELECT r.id,r.title label,e.name context,e.organization_id organizationId,r.event_id eventId
       FROM resources r JOIN events e ON e.id=r.event_id WHERE r.id=?
       AND r.event_id IN (${marks(eventIds)})
       AND (r.event_id IN (${marks(organizerEvents, true)}) OR r.published_at IS NOT NULL)`,
      [id, ...eventIds, ...organizerEvents],
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/speakers#resource-${item.id}`,
        )
      : null;
  }
  if (type === "saved_view" && organizerEvents.length) {
    item = await row(
      `SELECT v.id,v.name label,e.name context,v.organization_id organizationId,v.event_id eventId
       FROM submission_saved_views v JOIN events e ON e.id=v.event_id
       WHERE v.id=? AND v.event_id IN (${marks(organizerEvents)})
       AND (v.owner_user_id=? OR v.visibility='organization')`,
      [id, ...organizerEvents, user.id],
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/submissions?view=${item.id}`,
        )
      : null;
  }
  if (type === "communication") {
    const conditions: string[] = [];
    const values: unknown[] = [id];
    if (managingEvents.length) {
      conditions.push(`m.event_id IN (${marks(managingEvents)})`);
      values.push(...managingEvents);
    }
    if (speakerEvents.length) {
      conditions.push(
        `(m.event_id IN (${marks(speakerEvents)}) AND (m.recipient_user_id=? OR m.recipient_email=? COLLATE NOCASE))`,
      );
      values.push(...speakerEvents, user.id, user.email);
    }
    if (!conditions.length) return null;
    item = await row(
      `SELECT m.id,m.subject label,m.category||' · '||m.status context,m.organization_id organizationId,m.event_id eventId
       FROM communication_messages m WHERE m.id=? AND (${conditions.join(" OR ")})`,
      values,
    );
    return item
      ? result(
          type,
          item,
          `/app/events/${item.eventId}/communications?message=${item.id}`,
        )
      : null;
  }
  return null;
}

function quickActions(
  scopes: Scope[],
  organizations: OrganizationScope[],
  selectedEventId?: string,
  selectedOrganizationId?: string,
) {
  const managing = scopes.filter((scope) =>
    ["owner", "admin"].includes(scope.role),
  );
  const event =
    managing.find((scope) => scope.eventId === selectedEventId) ?? managing[0];
  const organizationId =
    selectedOrganizationId ?? event?.organizationId ?? organizations[0]?.id;
  const actions: Array<{
    id: string;
    label: string;
    context: string;
    path: string;
  }> = [];
  if (organizationId)
    actions.push({
      id: "create_event",
      label: "Create event",
      context: "Open the reviewed event-creation workflow",
      path: `/app?organization=${organizationId}#new-event`,
    });
  if (!event) return actions;
  const base = `/app/events/${event.eventId}`;
  actions.push(
    {
      id: "create_session",
      label: "Create session",
      context: `Choose an accepted session · ${event.eventName}`,
      path: `${base}/agenda#accepted-sessions`,
    },
    {
      id: "open_cfp_builder",
      label: "Open CFP builder",
      context: event.eventName,
      path: base,
    },
    {
      id: "invite_reviewer",
      label: "Invite reviewer",
      context: event.eventName,
      path: `/app/team?organization=${event.organizationId}&eventId=${event.eventId}&invite=reviewer`,
    },
    {
      id: "add_speaker",
      label: "Add speaker",
      context: event.eventName,
      path: `/app/crm?organization=${event.organizationId}&action=add-speaker&eventId=${event.eventId}`,
    },
    {
      id: "send_reminder",
      label: "Send permitted reminder",
      context: "Review recipients before sending",
      path: `${base}/communications?category=deadline_reminder&compose=1`,
    },
    {
      id: "content_queue",
      label: "Open content queue",
      context: event.eventName,
      path: `${base}/content`,
    },
    {
      id: "scheduling_conflicts",
      label: "Open scheduling conflicts",
      context: event.eventName,
      path: `${base}/control-room?category=schedule_conflicts`,
    },
    {
      id: "integration_status",
      label: "Open integration status",
      context: event.organizationName,
      path: `/app?organization=${event.organizationId}#airtable-status`,
    },
  );
  return actions;
}

export function searchTerms(query: string): unknown[] {
  const normalized = query.toLocaleLowerCase();
  const escaped = normalized
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
  const contains = `%${escaped}%`;
  const first = escaped.length >= 3 ? `%${escaped.slice(0, 2)}%` : contains;
  const last = escaped.length >= 3 ? `%${escaped.slice(-2)}%` : contains;
  return [normalized, contains, contains, first, last];
}

function match(label: string, context: string) {
  return `(?='' OR LOWER(${label}) LIKE ? ESCAPE '\\' OR LOWER(${context}) LIKE ? ESCAPE '\\' OR LOWER(${label}) LIKE ? ESCAPE '\\' OR LOWER(${label}) LIKE ? ESCAPE '\\')`;
}

function rankResults(results: SearchResult[], query: string) {
  const q = query.toLocaleLowerCase();
  return results
    .map((item) => ({ ...item, rank: rank(item, q) }))
    .filter((item) => !q || item.rank < 90)
    .sort(
      (a, b) =>
        Number(a.rank) - Number(b.rank) ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    );
}

export function rank(
  item: Pick<SearchResult, "label" | "context">,
  query: string,
) {
  if (!query) return 0;
  const label = item.label.toLocaleLowerCase();
  const context = item.context.toLocaleLowerCase();
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (label.includes(query)) return 3;
  if (context.includes(query)) return 4;
  const distance = Math.min(
    levenshtein(label.slice(0, query.length), query),
    ...label.split(/\s+/).map((word) => levenshtein(word, query)),
  );
  return distance <= Math.max(2, Math.floor(query.length * 0.25))
    ? 5 + distance / 10
    : 99;
}

function levenshtein(left: string, right: string) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1)
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

async function queryRows(
  db: D1Database,
  sql: string,
  values: unknown[],
  map: (row: Record<string, string>) => SearchResult,
) {
  const rows = await db
    .prepare(sql)
    .bind(...values)
    .all<Record<string, string>>();
  return rows.results.map(map);
}

function result(
  type: SearchResult["type"],
  row: Record<string, string>,
  path: string,
): SearchResult {
  return {
    type,
    id: row.id,
    label: row.label || "Untitled",
    context: row.context || "",
    path,
    organizationId: row.organizationId,
    eventId: row.eventId || null,
  };
}

function marks(values: unknown[], allowEmpty = false) {
  if (!values.length) return allowEmpty ? "NULL" : "NULL";
  return values.map(() => "?").join(",");
}
function unique(values: string[]) {
  return [...new Set(values)];
}
function deduplicate(results: SearchResult[]) {
  return [
    ...new Map(
      results.map((item) => [`${item.type}:${item.id}`, item]),
    ).values(),
  ];
}

export default router;
