import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";
import { syncAgendaCalendarInvitations } from "../lib/calendarLifecycle";
import {
  logOperationalEvent,
  notificationStatement,
  safeOperationalError,
} from "../lib/operations";
import { eventManagerNotificationStatement } from "../lib/notifications";

type Variables = { requestId: string };
type AgendaItem = {
  id: string;
  submissionId: string | null;
  roomId: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

const roomSchema = z.object({
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().nonnegative().nullable().optional(),
});
const itemSchema = z.object({
  submissionId: z.string().uuid().nullable().optional(),
  itemType: z.enum(["session", "break", "hold"]).default("session"),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  trackId: z.string().uuid().nullable().optional(),
});
const placementSchema = z.object({
  roomId: z.string().uuid().nullable(),
  trackId: z.string().uuid().nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});
const constraintSchema = z.object({
  constraintType: z.enum([
    "speaker_availability",
    "dependency",
    "track_balance",
    "room_capacity",
  ]),
  subjectId: z.string().trim().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
  severity: z.enum(["warning", "error"]).default("error"),
});
const assistSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(240).default(45),
  apply: z.boolean().default(false),
});

async function eventData(db: D1Database, eventId: string) {
  const [event, tracks, rooms, sessions, items, constraints] =
    await Promise.all([
      db
        .prepare(
          "SELECT e.id,e.name,e.timezone,e.starts_at AS startsAt,e.ends_at AS endsAt,e.status,o.name AS organizationName FROM events e JOIN organizations o ON o.id=e.organization_id WHERE e.id=?",
        )
        .bind(eventId)
        .first(),
      db
        .prepare(
          "SELECT id,name,slug,color,description,position FROM tracks WHERE event_id=? ORDER BY position,name",
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT id,name,capacity,position FROM rooms WHERE event_id=? ORDER BY position,name",
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT s.id,s.title,s.abstract,MIN(st.track_id) AS trackId,GROUP_CONCAT(DISTINCT sp.id) AS speakerIds,GROUP_CONCAT(DISTINCT sp.first_name||' '||sp.last_name) AS speakerNames FROM submissions s LEFT JOIN submission_tracks st ON st.submission_id=s.id LEFT JOIN session_speakers ss ON ss.submission_id=s.id LEFT JOIN speaker_profiles sp ON sp.id=ss.speaker_id WHERE s.event_id=? AND s.status='accepted' GROUP BY s.id ORDER BY s.title`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT a.id,a.submission_id AS submissionId,a.track_id AS trackId,a.room_id AS roomId,a.item_type AS itemType,a.title,a.description,a.starts_at AS startsAt,a.ends_at AS endsAt,a.status,a.version,r.name AS roomName,t.name AS trackName FROM agenda_items a LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN tracks t ON t.id=a.track_id WHERE a.event_id=? ORDER BY COALESCE(a.starts_at,'9999'),a.title`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT id,constraint_type AS constraintType,subject_id AS subjectId,config_json AS configJson,severity FROM schedule_constraints WHERE event_id=? ORDER BY created_at",
        )
        .bind(eventId)
        .all(),
    ]);
  return {
    event,
    tracks: tracks.results,
    rooms: rooms.results,
    sessions: sessions.results.map((session: Record<string, unknown>) => ({
      ...session,
      speakerIds: session.speakerIds
        ? String(session.speakerIds).split(",")
        : [],
      speakerNames: session.speakerNames
        ? String(session.speakerNames).split(",")
        : [],
    })),
    items: items.results,
    constraints: constraints.results.map(
      (constraint: Record<string, unknown>) => ({
        ...constraint,
        config: JSON.parse(String(constraint.configJson)),
        configJson: undefined,
      }),
    ),
  };
}

async function placementConflicts(
  db: D1Database,
  eventId: string,
  item: AgendaItem,
  roomId: string | null,
  startsAt: string,
  endsAt: string,
) {
  const conflicts: {
    type: "room" | "speaker";
    message: string;
    itemId: string;
  }[] = [];
  const overlapping = await db
    .prepare(
      "SELECT id,title,submission_id AS submissionId,room_id AS roomId FROM agenda_items WHERE event_id=? AND id!=? AND starts_at<? AND ends_at>?",
    )
    .bind(eventId, item.id, endsAt, startsAt)
    .all<{
      id: string;
      title: string;
      submissionId: string | null;
      roomId: string | null;
    }>();
  for (const other of overlapping.results) {
    if (roomId && other.roomId === roomId)
      conflicts.push({
        type: "room",
        message: `${other.title} already uses this room.`,
        itemId: other.id,
      });
    if (item.submissionId && other.submissionId) {
      const shared = await db
        .prepare(
          "SELECT sp.first_name||' '||sp.last_name AS name FROM session_speakers leftSpeaker JOIN session_speakers rightSpeaker ON rightSpeaker.speaker_id=leftSpeaker.speaker_id JOIN speaker_profiles sp ON sp.id=leftSpeaker.speaker_id WHERE leftSpeaker.submission_id=? AND rightSpeaker.submission_id=? LIMIT 1",
        )
        .bind(item.submissionId, other.submissionId)
        .first<{ name: string }>();
      if (shared)
        conflicts.push({
          type: "speaker",
          message: `${shared.name} is already speaking in ${other.title}.`,
          itemId: other.id,
        });
    }
  }
  return conflicts;
}

router.get("/admin/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  return context.json(await eventData(database(context.env), eventId));
});

router.post(
  "/admin/events/:eventId/rooms",
  zValidator("json", roomSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const id = crypto.randomUUID();
    const position = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM rooms WHERE event_id=?",
          )
          .bind(eventId)
          .first<{ position: number }>()
      )?.position ?? 0,
    );
    try {
      await db
        .prepare(
          "INSERT INTO rooms(id,event_id,name,capacity,position) VALUES(?,?,?,?,?)",
        )
        .bind(id, eventId, input.name, input.capacity ?? null, position)
        .run();
    } catch {
      throw new HttpError(
        409,
        "room_exists",
        "A room with that name already exists.",
      );
    }
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "agenda_room.created",
      entityType: "agenda_item",
      entityId: id,
      after: input,
      requestId: context.get("requestId"),
    }).run();
    return context.json({ room: { id, ...input, position } }, 201);
  },
);

router.post(
  "/admin/events/:eventId/items",
  zValidator("json", itemSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    let title = input.title;
    if (input.itemType === "session") {
      if (!input.submissionId)
        throw new HttpError(
          400,
          "submission_required",
          "Choose an accepted session.",
        );
      const session = await db
        .prepare(
          "SELECT title FROM submissions WHERE id=? AND event_id=? AND status='accepted'",
        )
        .bind(input.submissionId, eventId)
        .first<{ title: string }>();
      if (!session)
        throw new HttpError(
          404,
          "session_not_found",
          "Accepted session not found.",
        );
      if (
        await db
          .prepare(
            "SELECT id FROM agenda_items WHERE event_id=? AND submission_id=?",
          )
          .bind(eventId, input.submissionId)
          .first()
      )
        throw new HttpError(
          409,
          "agenda_item_exists",
          "That session is already on the agenda.",
        );
      title = title ?? session.title;
    }
    if (!title) throw new HttpError(400, "title_required", "Add a title.");
    const id = crypto.randomUUID();
    try {
      await db
        .prepare(
          "INSERT INTO agenda_items(id,event_id,submission_id,track_id,item_type,title,description) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.submissionId ?? null,
          input.trackId ?? null,
          input.itemType,
          title,
          input.description ?? null,
        )
        .run();
    } catch {
      throw new HttpError(
        409,
        "agenda_item_exists",
        "That session is already on the agenda.",
      );
    }
    await auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "agenda_item.created",
      entityType: "agenda_item",
      entityId: id,
      after: { ...input, title },
      requestId: context.get("requestId"),
    }).run();
    return context.json(
      { item: { id, ...input, title, status: "draft", version: 1 } },
      201,
    );
  },
);

router.patch(
  "/admin/events/:eventId/items/:itemId",
  zValidator("json", placementSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const item = await db
      .prepare(
        "SELECT id,submission_id AS submissionId,room_id AS roomId,starts_at AS startsAt,ends_at AS endsAt FROM agenda_items WHERE id=? AND event_id=?",
      )
      .bind(context.req.param("itemId"), eventId)
      .first<AgendaItem>();
    if (!item)
      throw new HttpError(
        404,
        "agenda_item_not_found",
        "Agenda item not found.",
      );
    if ((input.startsAt === null) !== (input.endsAt === null))
      throw new HttpError(
        400,
        "incomplete_placement",
        "A placement needs both a start and end, or both must be cleared. A room may be assigned later.",
      );
    if (input.startsAt && input.endsAt) {
      if (input.endsAt <= input.startsAt)
        throw new HttpError(
          400,
          "invalid_time",
          "The end must be after the start.",
        );
      if (
        input.roomId &&
        !(await db
          .prepare("SELECT id FROM rooms WHERE id=? AND event_id=?")
          .bind(input.roomId, eventId)
          .first())
      )
        throw new HttpError(
          400,
          "invalid_room",
          "Choose a room from this event.",
        );
      const conflicts = await placementConflicts(
        db,
        eventId,
        item,
        input.roomId,
        input.startsAt,
        input.endsAt,
      );
      if (conflicts.length) {
        const conflictStatements: D1PreparedStatement[] = [];
        for (const conflict of conflicts) {
          const existingConflict = await db
            .prepare(
              `SELECT id FROM schedule_conflict_records WHERE agenda_item_id=?
               AND conflicting_item_id=? AND conflict_type=? AND status='open'`,
            )
            .bind(item.id, conflict.itemId, conflict.type)
            .first<{ id: string }>();
          const conflictId = existingConflict?.id ?? crypto.randomUUID();
          conflictStatements.push(
            db
              .prepare(
                `INSERT INTO schedule_conflict_records
                  (id,organization_id,event_id,agenda_item_id,conflicting_item_id,
                   conflict_type,summary,attempted_room_id,attempted_starts_at,attempted_ends_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(agenda_item_id,conflicting_item_id,conflict_type,status)
                 DO UPDATE SET summary=excluded.summary,attempted_room_id=excluded.attempted_room_id,
                   attempted_starts_at=excluded.attempted_starts_at,
                   attempted_ends_at=excluded.attempted_ends_at,created_at=CURRENT_TIMESTAMP`,
              )
              .bind(
                conflictId,
                access.organizationId,
                eventId,
                item.id,
                conflict.itemId,
                conflict.type,
                conflict.message,
                input.roomId,
                input.startsAt,
                input.endsAt,
              ),
            auditStatement(db, {
              organizationId: access.organizationId,
              eventId,
              actorUserId: access.user.id,
              action: "schedule_conflict.detected",
              entityType: "schedule_conflict",
              entityId: conflictId,
              after: {
                agendaItemId: item.id,
                conflictingItemId: conflict.itemId,
                conflictType: conflict.type,
              },
              requestId: context.get("requestId"),
            }),
            eventManagerNotificationStatement(db, {
              organizationId: access.organizationId,
              eventId,
              category: "agenda",
              notificationType: "agenda.conflict_introduced",
              severity: "blocking",
              title: "A scheduling conflict was introduced",
              body: conflict.message,
              actionUrl: `/app/events/${eventId}/control-room?category=schedule_conflicts`,
              entityType: "schedule_conflict",
              entityId: conflictId,
              coalesceKey: `schedule-conflict:${conflictId}`,
            }),
          );
        }
        await db.batch(conflictStatements);
      }
      if (conflicts.length)
        return context.json(
          {
            error: {
              code: "schedule_conflict",
              message: "Resolve scheduling conflicts before placing this item.",
            },
            conflicts,
          },
          409,
        );
    }
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
      db
        .prepare(
          `UPDATE schedule_conflict_records SET status='resolved',resolved_by=?,
             resolved_at=CURRENT_TIMESTAMP
           WHERE event_id=? AND status='open' AND (agenda_item_id=? OR conflicting_item_id=?)`,
        )
        .bind(access.user.id, eventId, item.id, item.id),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: input.startsAt ? "agenda_item.placed" : "agenda_item.cleared",
        entityType: "agenda_item",
        entityId: item.id,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    let calendar;
    let calendarError: string | undefined;
    try {
      calendar = await syncAgendaCalendarInvitations(context.env, {
        eventId,
        agendaItemId: item.id,
        actorUserId: access.user.id,
        correlationId: context.get("requestId"),
        action: input.startsAt
          ? item.startsAt
            ? "material_change"
            : "placement"
          : "cancellation",
      });
    } catch (error) {
      calendarError =
        "The agenda changed, but calendar delivery needs organizer attention.";
      logOperationalEvent("error", {
        operation: "calendar_agenda_sync_failed",
        requestId: context.get("requestId"),
        eventId,
        entityType: "agenda_item",
        entityId: item.id,
        message: safeOperationalError(error),
      });
    }
    return context.json({
      item: { id: item.id, ...input },
      calendar,
      calendarError,
    });
  },
);

router.post(
  "/admin/events/:eventId/constraints",
  zValidator("json", constraintSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO schedule_constraints(id,event_id,constraint_type,subject_id,config_json,severity) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.constraintType,
          input.subjectId,
          JSON.stringify(input.config),
          input.severity,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "schedule_constraint.created",
        entityType: "agenda_item",
        entityId: id,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ constraint: { id, ...input } }, 201);
  },
);

router.post(
  "/admin/events/:eventId/assist",
  zValidator("json", assistSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const data = await eventData(db, eventId);
    if (!data.rooms.length)
      throw new HttpError(
        400,
        "rooms_required",
        "Add at least one room before assisted scheduling.",
      );
    const unscheduled = data.items.filter(
      (item: Record<string, unknown>) => !item.startsAt,
    ) as unknown as AgendaItem[];
    const duration = input.durationMinutes * 60_000;
    let cursor = new Date(input.startsAt).getTime();
    const limit = new Date(input.endsAt).getTime();
    const placements: {
      itemId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
    }[] = [];
    const remaining = [...unscheduled];
    const speakersBySubmission = new Map(
      data.sessions.map((session: Record<string, unknown>) => [
        String(session.id),
        new Set((session.speakerIds as string[]) ?? []),
      ]),
    );
    const scheduled = data.items.filter(
      (item: Record<string, unknown>) => item.startsAt && item.endsAt,
    ) as unknown as AgendaItem[];
    while (remaining.length && cursor + duration <= limit) {
      const slotStart = new Date(cursor).toISOString();
      const slotEnd = new Date(cursor + duration).toISOString();
      const slotSpeakers = new Set<string>();
      for (const room of data.rooms as { id: string }[]) {
        const roomBusy = scheduled.some(
          (item) =>
            item.roomId === room.id &&
            item.startsAt! < slotEnd &&
            item.endsAt! > slotStart,
        );
        if (roomBusy) continue;
        const candidateIndex = remaining.findIndex((item) => {
          const speakers = item.submissionId
            ? (speakersBySubmission.get(item.submissionId) ?? new Set<string>())
            : new Set<string>();
          if ([...speakers].some((speakerId) => slotSpeakers.has(speakerId)))
            return false;
          return !scheduled.some((scheduledItem) => {
            if (
              scheduledItem.startsAt! >= slotEnd ||
              scheduledItem.endsAt! <= slotStart ||
              !scheduledItem.submissionId
            )
              return false;
            const scheduledSpeakers =
              speakersBySubmission.get(scheduledItem.submissionId) ??
              new Set<string>();
            return [...speakers].some((speakerId) =>
              scheduledSpeakers.has(speakerId),
            );
          });
        });
        if (candidateIndex < 0) continue;
        const [item] = remaining.splice(candidateIndex, 1);
        placements.push({
          itemId: item.id,
          roomId: room.id,
          startsAt: slotStart,
          endsAt: slotEnd,
        });
        for (const speakerId of item.submissionId
          ? (speakersBySubmission.get(item.submissionId) ?? new Set<string>())
          : [])
          slotSpeakers.add(speakerId);
      }
      cursor += duration;
    }
    if (input.apply && placements.length) {
      await db.batch(
        placements.map((placement) =>
          db
            .prepare(
              "UPDATE agenda_items SET room_id=?,starts_at=?,ends_at=?,status='draft',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?",
            )
            .bind(
              placement.roomId,
              placement.startsAt,
              placement.endsAt,
              placement.itemId,
              eventId,
            ),
        ),
      );
      await auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "agenda.assisted_schedule_applied",
        entityType: "agenda_item",
        entityId: eventId,
        after: { ...input, placements: placements.length },
        requestId: context.get("requestId"),
      }).run();
    }
    let calendarFailures = 0;
    if (input.apply) {
      for (const placement of placements) {
        try {
          await syncAgendaCalendarInvitations(context.env, {
            eventId,
            agendaItemId: placement.itemId,
            actorUserId: access.user.id,
            correlationId: context.get("requestId"),
            action: "placement",
          });
        } catch (error) {
          calendarFailures += 1;
          logOperationalEvent("error", {
            operation: "calendar_assisted_sync_failed",
            requestId: context.get("requestId"),
            eventId,
            entityType: "agenda_item",
            entityId: placement.itemId,
            message: safeOperationalError(error),
          });
        }
      }
    }
    return context.json({
      placements,
      unscheduledCount: unscheduled.length,
      applied: input.apply,
      calendarFailures,
    });
  },
);

router.post("/admin/events/:eventId/publish", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const missing = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM agenda_items WHERE event_id=? AND (starts_at IS NULL OR ends_at IS NULL OR room_id IS NULL)",
    )
    .bind(eventId)
    .first<{ count: number }>();
  const total = await db
    .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE event_id=?")
    .bind(eventId)
    .first<{ count: number }>();
  if (!total?.count)
    throw new HttpError(
      400,
      "agenda_empty",
      "Add at least one item before publishing.",
    );
  if (missing?.count)
    throw new HttpError(
      409,
      "agenda_incomplete",
      "Schedule every agenda item before publishing.",
    );
  const roomConflict = await db
    .prepare(
      "SELECT leftItem.id FROM agenda_items leftItem JOIN agenda_items rightItem ON rightItem.event_id=leftItem.event_id AND rightItem.id>leftItem.id AND rightItem.room_id=leftItem.room_id AND rightItem.starts_at<leftItem.ends_at AND rightItem.ends_at>leftItem.starts_at WHERE leftItem.event_id=? LIMIT 1",
    )
    .bind(eventId)
    .first();
  const speakerConflict = await db
    .prepare(
      "SELECT leftItem.id FROM agenda_items leftItem JOIN agenda_items rightItem ON rightItem.event_id=leftItem.event_id AND rightItem.id>leftItem.id AND rightItem.starts_at<leftItem.ends_at AND rightItem.ends_at>leftItem.starts_at JOIN session_speakers leftSpeaker ON leftSpeaker.submission_id=leftItem.submission_id JOIN session_speakers rightSpeaker ON rightSpeaker.submission_id=rightItem.submission_id AND rightSpeaker.speaker_id=leftSpeaker.speaker_id WHERE leftItem.event_id=? LIMIT 1",
    )
    .bind(eventId)
    .first();
  if (roomConflict || speakerConflict)
    throw new HttpError(
      409,
      "agenda_conflicts",
      "Resolve every room and speaker conflict before publishing.",
    );
  const speakerUsers = await db
    .prepare(
      `SELECT DISTINCT sp.user_id userId FROM agenda_items a
       JOIN session_speakers ss ON ss.submission_id=a.submission_id
       JOIN speaker_profiles sp ON sp.id=ss.speaker_id
       WHERE a.event_id=? AND sp.user_id IS NOT NULL LIMIT 500`,
    )
    .bind(eventId)
    .all<{ userId: string }>();
  await db.batch([
    db
      .prepare(
        "UPDATE agenda_items SET status='published',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE event_id=?",
      )
      .bind(eventId),
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "agenda.published",
      entityType: "agenda_item",
      entityId: eventId,
      after: { itemCount: total.count },
      requestId: context.get("requestId"),
    }),
    ...speakerUsers.results.map((speaker) =>
      notificationStatement(db, {
        organizationId: access.organizationId,
        eventId,
        recipientUserId: speaker.userId,
        category: "agenda",
        notificationType: "agenda.published",
        severity: "info",
        title: "The event agenda was published",
        body: "Open the agenda to review your current session schedule.",
        actionUrl: `/app/events/${eventId}/speaker`,
        entityType: "event",
        entityId: eventId,
        coalesceKey: `agenda-published:${eventId}`,
      }),
    ),
  ]);
  const items = await db
    .prepare(
      "SELECT id FROM agenda_items WHERE event_id=? ORDER BY id LIMIT 1000",
    )
    .bind(eventId)
    .all<{ id: string }>();
  let calendarFailures = 0;
  for (const item of items.results) {
    try {
      await syncAgendaCalendarInvitations(context.env, {
        eventId,
        agendaItemId: item.id,
        actorUserId: access.user.id,
        correlationId: context.get("requestId"),
        action: "publication",
      });
    } catch (error) {
      calendarFailures += 1;
      logOperationalEvent("error", {
        operation: "calendar_publication_sync_failed",
        requestId: context.get("requestId"),
        eventId,
        entityType: "agenda_item",
        entityId: item.id,
        message: safeOperationalError(error),
      });
    }
  }
  return context.json({ published: total.count, calendarFailures });
});

export default router;
