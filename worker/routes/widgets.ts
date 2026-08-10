import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

export function widgetRemovalStatements(
  db: D1Database,
  input: {
    widgetId: string;
    eventId: string;
    organizationId: string;
    actorUserId: string;
    requestId: string;
    before: Record<string, unknown>;
  },
) {
  return [
    db
      .prepare("DELETE FROM widget_configs WHERE id=? AND event_id=?")
      .bind(input.widgetId, input.eventId),
    auditStatement(db, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      action: "widget.deleted",
      entityType: "widget_config",
      entityId: input.widgetId,
      before: input.before,
      requestId: input.requestId,
    }),
  ];
}

const configSchema = z.object({
  name: z.string().trim().min(2).max(120),
  widgetType: z.enum([
    "sessions",
    "speakers",
    "agenda",
    "itinerary",
    "gallery",
  ]),
  config: z.object({
    theme: z.enum(["light", "dark"]).default("light"),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#315c45"),
    showSearch: z.boolean().default(true),
    showFilters: z.boolean().default(true),
    trackIds: z.array(z.string().uuid()).max(100).default([]),
    fields: z
      .array(
        z.enum([
          "title",
          "abstract",
          "speakers",
          "track",
          "room",
          "time",
          "company",
          "bio",
        ]),
      )
      .max(8)
      .default(["title", "speakers", "track", "room", "time"]),
  }),
});

async function widgetData(db: D1Database, eventId: string) {
  const [event, tracks, sessions, speakers, agenda] = await Promise.all([
    db
      .prepare(
        "SELECT e.id,e.name,e.slug,e.timezone,e.starts_at AS startsAt,e.ends_at AS endsAt,e.venue_name AS venueName,e.primary_color AS primaryColor,o.name AS organizationName,o.slug AS organizationSlug FROM events e JOIN organizations o ON o.id=e.organization_id WHERE e.id=?",
      )
      .bind(eventId)
      .first(),
    db
      .prepare(
        "SELECT id,name,slug,color,description FROM tracks WHERE event_id=? ORDER BY position,name",
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        `SELECT s.id,s.title,s.abstract,s.format,s.duration_minutes AS durationMinutes,
                COALESCE(MIN(a.track_id),MIN(st.track_id)) AS trackId,
                GROUP_CONCAT(DISTINCT sp.id) AS speakerIds,
                GROUP_CONCAT(DISTINCT sp.first_name||' '||sp.last_name) AS speakerNames
         FROM submissions s
         JOIN session_content_state cs ON cs.submission_id=s.id AND cs.status='approved'
         LEFT JOIN agenda_items a ON a.submission_id=s.id AND a.cancelled_at IS NULL
         LEFT JOIN submission_tracks st ON st.submission_id=s.id
         LEFT JOIN session_speakers ss ON ss.submission_id=s.id
         LEFT JOIN speaker_profiles sp ON sp.id=ss.speaker_id
         WHERE s.event_id=? AND s.status='accepted'
         GROUP BY s.id ORDER BY s.title`,
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        `SELECT DISTINCT sp.id,sp.first_name AS firstName,sp.last_name AS lastName,sp.pronouns,sp.job_title AS jobTitle,sp.company,sp.bio,sp.headshot_key AS headshotKey,sp.social_json AS socialJson FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id JOIN session_content_state cs ON cs.submission_id=s.id AND cs.status='approved' WHERE s.event_id=? AND s.status='accepted' ORDER BY sp.last_name,sp.first_name`,
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        `SELECT a.id,a.submission_id AS submissionId,a.track_id AS trackId,a.item_type AS itemType,
                CASE WHEN a.submission_id IS NOT NULL THEN s.title ELSE a.title END AS title,
                CASE WHEN a.submission_id IS NOT NULL THEN s.abstract ELSE a.description END AS description,
                a.starts_at AS startsAt,a.ends_at AS endsAt,a.status,r.id AS roomId,r.name AS roomName,t.name AS trackName,t.color AS trackColor
         FROM agenda_items a LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN tracks t ON t.id=a.track_id
         LEFT JOIN submissions s ON s.id=a.submission_id
         LEFT JOIN session_content_state cs ON cs.submission_id=a.submission_id
         WHERE a.event_id=? AND a.status='published' AND a.cancelled_at IS NULL
           AND (a.submission_id IS NULL OR cs.status='approved')
         ORDER BY a.starts_at,title`,
      )
      .bind(eventId)
      .all(),
  ]);
  if (!event)
    throw new HttpError(404, "event_not_found", "Published event not found.");
  return {
    event,
    tracks: tracks.results,
    sessions: sessions.results.map((session: Record<string, unknown>) => ({
      ...session,
      speakerIds: session.speakerIds
        ? String(session.speakerIds).split(",")
        : [],
      speakerNames: session.speakerNames
        ? String(session.speakerNames).split(",")
        : [],
    })),
    speakers: speakers.results.map((speaker: Record<string, unknown>) => ({
      ...speaker,
      social: JSON.parse(String(speaker.socialJson ?? "{}")),
      socialJson: undefined,
      headshotUrl: speaker.headshotKey
        ? `/api/widgets/public/events/${eventId}/speakers/${speaker.id}/headshot`
        : null,
      headshotKey: undefined,
    })),
    agenda: agenda.results,
  };
}

function publicConfig(row: Record<string, unknown>) {
  return {
    id: row.id,
    publicKey: row.publicKey,
    name: row.name,
    widgetType: row.widgetType,
    config: JSON.parse(String(row.configJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function filterWidgetData(
  data: Awaited<ReturnType<typeof widgetData>>,
  config: ReturnType<typeof publicConfig>,
) {
  const trackIds = (config.config as { trackIds?: string[] }).trackIds ?? [];
  if (!trackIds.length) return data;
  return {
    ...data,
    tracks: data.tracks.filter((track: Record<string, unknown>) =>
      trackIds.includes(String(track.id)),
    ),
    sessions: data.sessions.filter((session: Record<string, unknown>) =>
      trackIds.includes(String(session.trackId)),
    ),
    agenda: data.agenda.filter(
      (item: Record<string, unknown>) =>
        !item.trackId || trackIds.includes(String(item.trackId)),
    ),
  };
}

async function publicWidget(db: D1Database, publicKey: string) {
  const row = await db
    .prepare(
      "SELECT id,event_id AS eventId,public_key AS publicKey,name,widget_type AS widgetType,config_json AS configJson,created_at AS createdAt,updated_at AS updatedAt FROM widget_configs WHERE public_key=?",
    )
    .bind(publicKey)
    .first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "widget_not_found", "Widget not found.");
  const config = publicConfig(row);
  const data = filterWidgetData(
    await widgetData(db, String(row.eventId)),
    config,
  );
  return { config, data };
}

router.get("/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const configs = await db
    .prepare(
      "SELECT id,public_key AS publicKey,name,widget_type AS widgetType,config_json AS configJson,created_at AS createdAt,updated_at AS updatedAt FROM widget_configs WHERE event_id=? ORDER BY created_at DESC",
    )
    .bind(eventId)
    .all();
  const data = await widgetData(db, eventId);
  return context.json({
    event: data.event,
    tracks: data.tracks,
    widgets: configs.results.map(publicConfig),
  });
});

router.post(
  "/admin/events/:eventId",
  zValidator("json", configSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    if (input.config.trackIds.length) {
      const tracks = await db
        .prepare(
          `SELECT COUNT(*) AS count FROM tracks WHERE event_id=? AND id IN (${input.config.trackIds.map(() => "?").join(",")})`,
        )
        .bind(eventId, ...input.config.trackIds)
        .first<{ count: number }>();
      if (tracks?.count !== new Set(input.config.trackIds).size)
        throw new HttpError(
          400,
          "invalid_tracks",
          "Every filter track must belong to this event.",
        );
    }
    const id = crypto.randomUUID();
    const publicKey = `${input.widgetType}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await db.batch([
      db
        .prepare(
          "INSERT INTO widget_configs(id,event_id,name,widget_type,public_key,config_json,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.name,
          input.widgetType,
          publicKey,
          JSON.stringify(input.config),
          access.user.id,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "widget.created",
        entityType: "widget_config",
        entityId: id,
        after: {
          name: input.name,
          widgetType: input.widgetType,
          config: input.config,
        },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ widget: { id, publicKey, ...input } }, 201);
  },
);

router.patch(
  "/admin/events/:eventId/:widgetId",
  zValidator("json", configSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const result = await db
      .prepare(
        "UPDATE widget_configs SET name=?,widget_type=?,config_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?",
      )
      .bind(
        input.name,
        input.widgetType,
        JSON.stringify(input.config),
        context.req.param("widgetId"),
        eventId,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(404, "widget_not_found", "Widget not found.");
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "widget.updated",
      entityType: "widget_config",
      entityId: context.req.param("widgetId"),
      after: input,
      requestId: context.get("requestId"),
    }).run();
    return context.json({
      widget: { id: context.req.param("widgetId"), ...input },
    });
  },
);

router.delete("/admin/events/:eventId/:widgetId", async (context) => {
  const eventId = context.req.param("eventId");
  const widgetId = context.req.param("widgetId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const widget = await db
    .prepare(
      "SELECT id,name,widget_type AS widgetType,public_key AS publicKey,config_json AS configJson FROM widget_configs WHERE id=? AND event_id=?",
    )
    .bind(widgetId, eventId)
    .first<Record<string, unknown>>();
  if (!widget)
    throw new HttpError(404, "widget_not_found", "Widget not found.");
  await db.batch(
    widgetRemovalStatements(db, {
      widgetId,
      eventId,
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      requestId: context.get("requestId"),
      before: {
        name: widget.name,
        widgetType: widget.widgetType,
        publicKey: widget.publicKey,
        config: JSON.parse(String(widget.configJson)),
      },
    }),
  );
  return context.json({ deleted: true, widgetId });
});

router.get("/public/:publicKey", async (context) => {
  const db = database(context.env);
  const { config, data } = await publicWidget(
    db,
    context.req.param("publicKey"),
  );
  return context.json({ widget: config, ...data }, 200, {
    "cache-control": "public, max-age=30, stale-while-revalidate=120",
  });
});

router.get(
  "/public/events/:eventId/speakers/:speakerId/headshot",
  async (context) => {
    if (!context.env.FILES)
      throw new HttpError(
        503,
        "storage_unavailable",
        "Image storage is unavailable.",
      );
    const speaker = await database(context.env)
      .prepare(
        "SELECT sp.headshot_key AS headshotKey FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id WHERE sp.id=? AND s.event_id=? AND s.status='accepted' LIMIT 1",
      )
      .bind(context.req.param("speakerId"), context.req.param("eventId"))
      .first<{ headshotKey: string | null }>();
    if (!speaker?.headshotKey)
      throw new HttpError(404, "headshot_not_found", "Headshot not found.");
    const object = await context.env.FILES.get(speaker.headshotKey);
    if (!object)
      throw new HttpError(404, "headshot_not_found", "Headshot not found.");
    const headers = new Headers({
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  },
);

router.get("/public/:publicKey/feed.json", async (context) => {
  const db = database(context.env);
  const { data } = await publicWidget(db, context.req.param("publicKey"));
  return context.json(data, 200, {
    "cache-control": "public, max-age=30",
  });
});

router.get("/public/:publicKey/feed.xml", async (context) => {
  const db = database(context.env);
  const { data } = await publicWidget(db, context.req.param("publicKey"));
  const escape = (value: unknown) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const items = data.agenda
    .map(
      (item: Record<string, unknown>) =>
        `<item id="${escape(item.id)}"><title>${escape(item.title)}</title><startsAt>${escape(item.startsAt)}</startsAt><endsAt>${escape(item.endsAt)}</endsAt><room>${escape(item.roomName)}</room><track>${escape(item.trackName)}</track></item>`,
    )
    .join("");
  return context.body(
    `<?xml version="1.0" encoding="UTF-8"?><programloom><event id="${escape((data.event as Record<string, unknown>).id)}"><name>${escape((data.event as Record<string, unknown>).name)}</name>${items}</event></programloom>`,
    200,
    {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=30",
    },
  );
});

router.get("/public/:publicKey/agenda.ics", async (context) => {
  const db = database(context.env);
  const { data } = await publicWidget(db, context.req.param("publicKey"));
  const ical = (value: unknown) =>
    String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,")
      .replaceAll("\n", "\\n");
  const stamp = (value: unknown) =>
    new Date(String(value))
      .toISOString()
      .replaceAll("-", "")
      .replaceAll(":", "")
      .replace(/\.\d{3}Z$/, "Z");
  const events = data.agenda
    .filter((item: Record<string, unknown>) => item.startsAt && item.endsAt)
    .map(
      (item: Record<string, unknown>) =>
        `BEGIN:VEVENT\r\nUID:${ical(item.id)}@programloom.com\r\nDTSTAMP:${stamp(new Date())}\r\nDTSTART:${stamp(item.startsAt)}\r\nDTEND:${stamp(item.endsAt)}\r\nSUMMARY:${ical(item.title)}\r\nLOCATION:${ical(item.roomName)}\r\nDESCRIPTION:${ical(item.description)}\r\nEND:VEVENT`,
    )
    .join("\r\n");
  return context.body(
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ProgramLoom//Agenda//EN\r\nCALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR\r\n`,
    200,
    {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${String((data.event as Record<string, unknown>).slug)}-agenda.ics"`,
      "cache-control": "public, max-age=30",
    },
  );
});

export default router;
