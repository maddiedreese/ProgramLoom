import type { Env } from "../env";
import { auditStatement } from "./audit";
import {
  calendarMaterialHash,
  calendarUid,
  renderCalendarMessage,
  safeCalendarFilename,
  type CalendarSnapshot,
} from "./calendar";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "./communications";
import { renderSimpleTransactionalEmail } from "./email";
import { domainEventStatement, notificationStatement } from "./operations";

type CalendarAction =
  "placement" | "material_change" | "publication" | "manual" | "cancellation";

type CalendarRecord = {
  id: string;
  speakerId: string;
  uid: string;
  sequence: number;
  state: "active" | "cancelled";
  materialHash: string;
};

type CalendarItem = {
  id: string;
  organizationId: string;
  eventId: string;
  submissionId: string | null;
  eventName: string;
  eventTimezone: string;
  venueName: string | null;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  roomName: string | null;
};

export function calendarCancellationNotificationStatement(
  db: D1Database,
  input: {
    organizationId: string;
    eventId: string;
    recipientUserId: string;
    agendaItemId: string;
    calendarRecordId: string;
    sessionTitle: string;
  },
) {
  return notificationStatement(db, {
    organizationId: input.organizationId,
    eventId: input.eventId,
    recipientUserId: input.recipientUserId,
    category: "agenda",
    notificationType: "agenda.session_cancelled",
    severity: "warning",
    title: "A scheduled session was cancelled",
    body: input.sessionTitle,
    actionUrl: `/app/events/${input.eventId}/speaker`,
    entityType: "calendar_record",
    entityId: input.calendarRecordId,
    coalesceKey: `calendar-cancelled:${input.calendarRecordId}`,
  });
}

export async function syncAgendaCalendarInvitations(
  env: Env,
  input: {
    eventId: string;
    agendaItemId: string;
    actorUserId: string;
    correlationId: string;
    action: CalendarAction;
    explicitReschedule?: boolean;
    speakerId?: string;
  },
) {
  if (!env.DB || !env.FILES)
    throw new Error("Calendar delivery storage is unavailable.");
  const db = env.DB;
  const item = await db
    .prepare(
      `SELECT a.id,a.event_id AS eventId,a.submission_id AS submissionId,a.title,
              a.description,a.starts_at AS startsAt,a.ends_at AS endsAt,a.status,
              e.organization_id AS organizationId,e.name AS eventName,
              e.timezone AS eventTimezone,e.venue_name AS venueName,r.name AS roomName
       FROM agenda_items a JOIN events e ON e.id=a.event_id
       LEFT JOIN rooms r ON r.id=a.room_id
       WHERE a.id=? AND a.event_id=?`,
    )
    .bind(input.agendaItemId, input.eventId)
    .first<CalendarItem>();
  if (!item) throw new Error("Agenda item not found for calendar delivery.");

  const settings = await ensureCalendarSettings(
    db,
    env,
    item,
    input.actorUserId,
  );
  const cancel = input.action === "cancellation";
  const automaticAllowed =
    cancel ||
    input.action === "manual" ||
    (input.action === "publication" &&
      settings.deliveryRule === "on_publication") ||
    (["placement", "material_change"].includes(input.action) &&
      settings.deliveryRule === "on_placement" &&
      settings.sendUpdatesAutomatically);
  if (!automaticAllowed)
    return {
      created: 0,
      updated: 0,
      cancelled: 0,
      skipped: 1,
      explicitRescheduleRequired: 0,
    };
  if ((!item.startsAt || !item.endsAt) && !cancel)
    return {
      created: 0,
      updated: 0,
      cancelled: 0,
      skipped: 1,
      explicitRescheduleRequired: 0,
    };

  const speakers = item.submissionId
    ? await db
        .prepare(
          `SELECT sp.id,sp.user_id AS userId,sp.email,sp.first_name||' '||sp.last_name AS name
           FROM session_speakers ss JOIN speaker_profiles sp ON sp.id=ss.speaker_id
           WHERE ss.submission_id=? AND (? IS NULL OR sp.id=?) ORDER BY sp.id LIMIT 50`,
        )
        .bind(
          item.submissionId,
          input.speakerId ?? null,
          input.speakerId ?? null,
        )
        .all<{ id: string; userId: string | null; email: string; name: string }>()
    : {
        results: [] as Array<{
          id: string;
          userId: string | null;
          email: string;
          name: string;
        }>,
      };
  if (input.speakerId && !speakers.results.length)
    throw new Error("The selected speaker is not assigned to this session.");
  const summary = {
    created: 0,
    updated: 0,
    cancelled: 0,
    skipped: 0,
    explicitRescheduleRequired: 0,
  };
  for (const speaker of speakers.results) {
    const existing = await db
      .prepare(
        `SELECT id,speaker_id AS speakerId,uid,sequence,state,material_hash AS materialHash
         FROM calendar_records WHERE agenda_item_id=? AND speaker_id=?`,
      )
      .bind(item.id, speaker.id)
      .first<CalendarRecord>();
    if (cancel && (!existing || existing.state === "cancelled")) {
      summary.skipped += 1;
      continue;
    }
    if (
      !cancel &&
      existing?.state === "cancelled" &&
      !input.explicitReschedule
    ) {
      summary.explicitRescheduleRequired += 1;
      continue;
    }
    const recordId = existing?.id ?? crypto.randomUUID();
    const uid = existing?.uid ?? calendarUid(item.id);
    const method = cancel ? "CANCEL" : "REQUEST";
    const previousSnapshot =
      cancel && existing
        ? await db
            .prepare(
              `SELECT snapshot_json AS snapshotJson FROM calendar_revisions
               WHERE calendar_record_id=? ORDER BY created_at DESC,id DESC LIMIT 1`,
            )
            .bind(existing.id)
            .first<{ snapshotJson: string }>()
        : null;
    const previous = previousSnapshot
      ? (JSON.parse(previousSnapshot.snapshotJson) as CalendarSnapshot)
      : null;
    const material = {
      uid,
      eventName: previous?.eventName ?? item.eventName,
      eventTimezone: previous?.eventTimezone ?? item.eventTimezone,
      sessionTitle: previous?.sessionTitle ?? item.title,
      description: previous?.description ?? item.description ?? "",
      startsAt: previous?.startsAt ?? item.startsAt ?? new Date().toISOString(),
      endsAt:
        previous?.endsAt ??
        item.endsAt ??
        item.startsAt ??
        new Date().toISOString(),
      roomName: previous?.roomName ?? item.roomName,
      venueName: previous?.venueName ?? item.venueName,
      organizerName: settings.organizerName,
      organizerEmail: settings.organizerEmail,
      attendeeName: speaker.name,
      attendeeEmail: speaker.email,
    };
    const materialHash = await calendarMaterialHash(material);
    if (
      !cancel &&
      existing?.state === "active" &&
      existing.materialHash === materialHash
    ) {
      summary.skipped += 1;
      continue;
    }
    const sequence = existing ? existing.sequence + 1 : 0;
    const createdAt = new Date().toISOString();
    const snapshot: CalendarSnapshot = {
      ...material,
      sequence,
      method,
      createdAt,
    };
    const ics = renderCalendarMessage(snapshot);
    const revisionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const r2Key = `calendar/${item.organizationId}/${item.eventId}/${recordId}/${revisionId}.ics`;
    await env.FILES.put(r2Key, ics, {
      httpMetadata: {
        contentType: `text/calendar; method=${method}; charset=UTF-8`,
      },
      customMetadata: {
        calendarRecordId: recordId,
        sequence: String(sequence),
        method,
      },
    });
    const email = renderSimpleTransactionalEmail({
      recipientName: speaker.name,
      paragraphs: [
        cancel
          ? `${item.title} has been cancelled or removed from the ${item.eventName} program.`
          : `${item.title} has ${existing ? "an updated" : "a new"} calendar invitation for ${item.eventName}.`,
        cancel
          ? "The attached cancellation keeps your calendar in sync."
          : "Open the attached invitation in your calendar. Future changes will update the same event.",
      ],
    });
    try {
      await db.batch([
        prepareCommunicationStatement(db, {
          id: messageId,
          organizationId: item.organizationId,
          eventId: item.eventId,
          category: cancel
            ? "calendar_cancellation"
            : existing
              ? "calendar_update"
              : "calendar_invitation",
          recipientEmail: speaker.email,
          recipientName: speaker.name,
          subject: cancel
            ? `Cancelled: ${item.title}`
            : existing
              ? `Updated: ${item.title}`
              : `Invitation: ${item.title}`,
          bodyHtml: email.html,
          bodyText: email.text,
          entityType: "calendar_record",
          entityId: recordId,
          attachmentManifest: [
            {
              key: r2Key,
              filename: safeCalendarFilename(item.title),
              contentType: `text/calendar; method=${method}; charset=UTF-8`,
            },
          ],
          metadata: {
            calendarRecordId: recordId,
            revisionId,
            sequence,
            method,
          },
          idempotencyKey: `calendar/${recordId}/${sequence}/${method}`,
          preparedBy: input.actorUserId,
          correlationId: input.correlationId,
        }),
        db
          .prepare(
            `INSERT INTO calendar_records
              (id,organization_id,event_id,agenda_item_id,submission_id,speaker_id,
               attendee_email,attendee_name,uid,sequence,state,material_hash,
               last_revision_id,last_message_id,cancelled_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(agenda_item_id,speaker_id) DO UPDATE SET
               attendee_email=excluded.attendee_email,attendee_name=excluded.attendee_name,
               sequence=excluded.sequence,state=excluded.state,
               material_hash=excluded.material_hash,last_revision_id=excluded.last_revision_id,
               last_message_id=excluded.last_message_id,cancelled_at=excluded.cancelled_at,
               updated_at=CURRENT_TIMESTAMP`,
          )
          .bind(
            recordId,
            item.organizationId,
            item.eventId,
            item.id,
            item.submissionId,
            speaker.id,
            speaker.email,
            speaker.name,
            uid,
            sequence,
            cancel ? "cancelled" : "active",
            materialHash,
            revisionId,
            messageId,
            cancel ? createdAt : null,
          ),
        db
          .prepare(
            `INSERT INTO calendar_revisions
              (id,calendar_record_id,message_id,sequence,method,reason,snapshot_json,
               ics_r2_key,material_hash,created_by)
             VALUES(?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            revisionId,
            recordId,
            messageId,
            sequence,
            method,
            input.action,
            JSON.stringify(snapshot),
            r2Key,
            materialHash,
            input.actorUserId,
          ),
        domainEventStatement(db, {
          organizationId: item.organizationId,
          eventId: item.eventId,
          eventType: cancel
            ? "calendar.cancelled"
            : existing
              ? "calendar.updated"
              : "calendar.created",
          entityType: "calendar_record",
          entityId: recordId,
          actorUserId: input.actorUserId,
          payload: { agendaItemId: item.id, sequence, messageId },
          correlationId: input.correlationId,
        }),
        auditStatement(db, {
          organizationId: item.organizationId,
          eventId: item.eventId,
          actorUserId: input.actorUserId,
          action: cancel
            ? "calendar.cancelled"
            : existing
              ? "calendar.updated"
              : "calendar.created",
          entityType: "calendar_record",
          entityId: recordId,
          before: existing ?? undefined,
          after: {
            agendaItemId: item.id,
            sequence,
            state: cancel ? "cancelled" : "active",
            revisionId,
            messageId,
          },
          requestId: input.correlationId,
        }),
        ...(cancel && speaker.userId
          ? [
              calendarCancellationNotificationStatement(db, {
                organizationId: item.organizationId,
                eventId: item.eventId,
                recipientUserId: speaker.userId,
                agendaItemId: item.id,
                calendarRecordId: recordId,
                sessionTitle: item.title,
              }),
            ]
          : []),
      ]);
    } catch (error) {
      await env.FILES.delete(r2Key);
      throw error;
    }
    try {
      await enqueueCommunication(env, messageId, input.correlationId);
    } catch {
      // The message remains prepared and visible for safe organizer retry.
    }
    if (cancel) summary.cancelled += 1;
    else if (existing) summary.updated += 1;
    else summary.created += 1;
  }
  return summary;
}

async function ensureCalendarSettings(
  db: D1Database,
  env: Env,
  item: CalendarItem,
  actorUserId: string,
) {
  const current = await db
    .prepare(
      `SELECT delivery_rule AS deliveryRule,organizer_name AS organizerName,
              organizer_email AS organizerEmail,
              send_updates_automatically AS sendUpdatesAutomatically
       FROM event_calendar_settings WHERE event_id=?`,
    )
    .bind(item.eventId)
    .first<{
      deliveryRule: "on_placement" | "on_publication" | "manual";
      organizerName: string;
      organizerEmail: string;
      sendUpdatesAutomatically: number;
    }>();
  if (current)
    return {
      ...current,
      sendUpdatesAutomatically: Boolean(current.sendUpdatesAutomatically),
    };
  const organizerEmail =
    extractAddress(env.EMAIL_REPLY_TO ?? env.EMAIL_FROM) ??
    "notifications@mail.programloom.com";
  await db
    .prepare(
      `INSERT INTO event_calendar_settings
        (event_id,organization_id,delivery_rule,organizer_name,organizer_email,
         send_updates_automatically,created_by,updated_by)
       VALUES(?,?,'on_placement',?,?,1,?,?)`,
    )
    .bind(
      item.eventId,
      item.organizationId,
      "ProgramLoom",
      organizerEmail,
      actorUserId,
      actorUserId,
    )
    .run();
  return {
    deliveryRule: "on_placement" as const,
    organizerName: "ProgramLoom",
    organizerEmail,
    sendUpdatesAutomatically: true,
  };
}

function extractAddress(value?: string) {
  if (!value) return undefined;
  const angle = value.match(/<([^>]+)>/);
  return (angle?.[1] ?? value).trim().toLowerCase();
}
