import { Hono } from "hono";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";

const router = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
const organizerRoles = ["owner", "admin"] as const;

type IssueRow = {
  category: string;
  entityType: string;
  entityId: string;
  title: string;
  detail: string;
  severity: "blocking" | "warning" | "info";
  status: string;
  deadline: string | null;
  occurredAt: string;
  actionUrl: string;
  trackId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
};

export const issuesSql = `
  SELECT 'submissions_new' category,'submission' entityType,s.id entityId,s.title title,
    CASE WHEN s.status='draft' THEN 'Draft proposal' ELSE 'New proposal awaiting triage' END detail,
    CASE WHEN s.status='draft' THEN 'info' ELSE 'warning' END severity,s.status status,
    NULL deadline,COALESCE(s.submitted_at,s.created_at) occurredAt,
    '/app/events/'||s.event_id||'/submissions?submission='||s.id actionUrl,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1) trackId
  FROM submissions s WHERE s.event_id=?1 AND (s.status='draft' OR (s.status='pending' AND s.organizer_seen_at IS NULL))
  UNION ALL
  SELECT 'reviewer_assignment','submission',s.id,s.title,'No active reviewer assignment','blocking',s.status,
    NULL,COALESCE(s.submitted_at,s.created_at),'/app/events/'||s.event_id||'/reviews?submission='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM submissions s WHERE s.event_id=?1 AND s.status='pending' AND NOT EXISTS (
    SELECT 1 FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id
    WHERE ra.submission_id=s.id AND rr.event_id=s.event_id AND ra.recused_at IS NULL)
  UNION ALL
  SELECT 'reviews_incomplete','review_assignment',ra.id,s.title,
    rr.name||' · review incomplete','blocking','incomplete',rr.closes_at,ra.created_at,
    '/app/events/'||s.event_id||'/reviews?round='||rr.id||'&submission='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id JOIN submissions s ON s.id=ra.submission_id
  WHERE rr.event_id=?1 AND rr.status IN ('open','closed') AND ra.completed_at IS NULL AND ra.recused_at IS NULL
  UNION ALL
  SELECT 'review_conflicts','review_conflict',rc.id,s.title,rc.reason,'blocking',rc.status,NULL,rc.created_at,
    '/app/events/'||rc.event_id||'/reviews?submission='||rc.submission_id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=rc.submission_id ORDER BY track_id LIMIT 1)
  FROM review_conflicts rc JOIN submissions s ON s.id=rc.submission_id WHERE rc.event_id=?1 AND rc.status='unresolved'
  UNION ALL
  SELECT 'decisions_pending','submission',s.id,s.title,'Completed review awaits an organizer decision','blocking',s.decision_state,
    NULL,s.updated_at,'/app/events/'||s.event_id||'/submissions?submission='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM submissions s WHERE s.event_id=?1 AND s.status='pending' AND s.decision_state='none' AND EXISTS (
    SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.completed_at IS NOT NULL)
  UNION ALL
  SELECT 'decisions_uncommunicated','submission',s.id,s.title,'Decision staged but not communicated','blocking',s.decision_state,
    NULL,COALESCE(s.decision_staged_at,s.updated_at),'/app/events/'||s.event_id||'/communications?compose=1&category='||
      CASE s.decision_state WHEN 'acceptance_staged' THEN 'decision_acceptance' WHEN 'waitlist_staged' THEN 'decision_waitlist' ELSE 'decision_rejection' END||'&entity='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM submissions s LEFT JOIN communication_messages cm ON cm.id=s.decision_message_id
  WHERE s.event_id=?1 AND s.decision_state IN ('acceptance_staged','waitlist_staged','rejection_staged')
    AND (cm.id IS NULL OR cm.status NOT IN ('sent','delivered'))
  UNION ALL
  SELECT 'deliveries','communication_message',cm.id,cm.subject,
    CASE WHEN cm.status IN ('failed','bounced') THEN 'Delivery needs intervention' ELSE 'Delivery has not completed' END,
    CASE WHEN cm.status IN ('failed','bounced') THEN 'blocking' ELSE 'warning' END,cm.status,cm.scheduled_for,cm.created_at,
    '/app/events/'||cm.event_id||'/communications?message='||cm.id,NULL
  FROM communication_messages cm WHERE cm.event_id=?1 AND cm.status IN ('prepared','queued','processing','failed','bounced')
  UNION ALL
  SELECT 'portal_access','speaker',sp.id,TRIM(sp.first_name||' '||sp.last_name),'Accepted speaker has no active portal access',
    'blocking',sp.portal_status,NULL,sp.updated_at,'/app/events/'||?1||'/speakers?speaker='||sp.id,
    (SELECT st.track_id FROM session_speakers ss2 JOIN submissions s2 ON s2.id=ss2.submission_id
      JOIN submission_tracks st ON st.submission_id=s2.id
      WHERE ss2.speaker_id=sp.id AND s2.event_id=?1 ORDER BY st.track_id LIMIT 1)
  FROM speaker_profiles sp
  WHERE (sp.user_id IS NULL OR sp.portal_status NOT IN ('active','complete')) AND EXISTS (
    SELECT 1 FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id
    WHERE ss.speaker_id=sp.id AND s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted')
  UNION ALL
  SELECT 'onboarding','speaker_task',ot.id||':'||sta.speaker_id,ot.title,
    TRIM(sp.first_name||' '||sp.last_name)||' · '||CASE WHEN ot.due_at<CURRENT_TIMESTAMP THEN 'overdue' ELSE 'incomplete' END,
    CASE WHEN ot.due_at<CURRENT_TIMESTAMP THEN 'blocking' ELSE 'warning' END,sta.status,ot.due_at,sta.updated_at,
    '/app/events/'||ot.event_id||'/speakers?speaker='||sp.id,NULL
  FROM speaker_task_assignments sta JOIN onboarding_tasks ot ON ot.id=sta.task_id JOIN speaker_profiles sp ON sp.id=sta.speaker_id
  WHERE ot.event_id=?1 AND sta.status!='complete'
  UNION ALL
  SELECT 'assets','speaker',sp.id,TRIM(sp.first_name||' '||sp.last_name),'Accepted speaker is missing a headshot','warning','missing',NULL,sp.updated_at,
    '/app/events/'||?1||'/content?speaker='||sp.id,NULL
  FROM speaker_profiles sp WHERE sp.headshot_key IS NULL AND EXISTS (
    SELECT 1 FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id
    WHERE ss.speaker_id=sp.id AND s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted')
  UNION ALL
  SELECT 'assets','file',f.id,COALESCE(f.purpose,'Requested file'),
    CASE WHEN f.status='needs_changes' THEN 'File was returned for changes' ELSE 'Requested file is missing or incomplete' END,
    CASE WHEN f.status='needs_changes' THEN 'blocking' ELSE 'warning' END,f.status,ot.due_at,f.updated_at,
    '/app/events/'||f.event_id||'/content?file='||f.id,NULL
  FROM files f LEFT JOIN onboarding_tasks ot ON ot.id=f.task_id WHERE f.event_id=?1 AND f.status IN ('pending','needs_changes')
  UNION ALL
  SELECT 'content_review','submission',s.id,s.title,'Session content awaits review or approval','warning',COALESCE(scs.status,'draft'),
    NULL,COALESCE(scs.updated_at,s.updated_at),'/app/events/'||s.event_id||'/content?submission='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM submissions s LEFT JOIN session_content_state scs ON scs.submission_id=s.id
  WHERE s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted' AND COALESCE(scs.status,'draft')!='approved'
  UNION ALL
  SELECT 'public_exclusions','submission',s.id,s.title,'Accepted session is excluded from public surfaces until content is approved',
    'warning',COALESCE(scs.status,'draft'),NULL,s.updated_at,'/app/events/'||s.event_id||'/content?submission='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM submissions s LEFT JOIN session_content_state scs ON scs.submission_id=s.id
  WHERE s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted' AND COALESCE(scs.status,'draft')!='approved'
  UNION ALL
  SELECT 'agenda_missing','submission',s.id,s.title,'Accepted session has no agenda placement','blocking','unplaced',NULL,s.updated_at,
    '/app/events/'||s.event_id||'/agenda?submission='||s.id,
    (SELECT track_id FROM submission_tracks WHERE submission_id=s.id ORDER BY track_id LIMIT 1)
  FROM submissions s WHERE s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted' AND NOT EXISTS (
    SELECT 1 FROM agenda_items ai WHERE ai.event_id=s.event_id AND ai.submission_id=s.id AND ai.starts_at IS NOT NULL)
  UNION ALL
  SELECT 'schedule_conflicts','schedule_conflict',scr.id,ai.title,scr.summary,'blocking',scr.status,
    scr.attempted_starts_at,scr.created_at,'/app/events/'||scr.event_id||'/agenda?item='||scr.agenda_item_id,ai.track_id
  FROM schedule_conflict_records scr JOIN agenda_items ai ON ai.id=scr.agenda_item_id WHERE scr.event_id=?1 AND scr.status='open'
  UNION ALL
  SELECT 'agenda_unpublished','agenda_item',ai.id,ai.title,'Agenda change has not been published','warning',ai.status,
    ai.starts_at,ai.updated_at,'/app/events/'||ai.event_id||'/agenda?item='||ai.id,ai.track_id
  FROM agenda_items ai WHERE ai.event_id=?1 AND ai.cancelled_at IS NULL AND ai.status!='published'
  UNION ALL
  SELECT 'queue_failures','operational_job',oj.id,oj.job_kind,'Queue job needs intervention',
    CASE WHEN oj.status='exhausted' THEN 'blocking' ELSE 'warning' END,oj.status,oj.available_at,oj.updated_at,
    '/app/events/'||oj.event_id||'/control-room?category=queue_failures',NULL
  FROM operational_jobs oj WHERE oj.event_id=?1 AND oj.status IN ('retrying','exhausted')
  UNION ALL
  SELECT 'airtable_sync','integration_outbox',io.id,io.entity_type,'Airtable change is waiting to synchronize',
    CASE WHEN io.last_error IS NOT NULL THEN 'blocking' ELSE 'warning' END,
    CASE WHEN io.last_error IS NOT NULL THEN 'failed' ELSE 'pending' END,io.available_at,io.created_at,
    '/app/events/'||io.event_id||'/control-room?category=airtable_sync',NULL
  FROM integration_outbox io WHERE io.event_id=?1 AND io.integration='airtable' AND io.completed_at IS NULL
  UNION ALL
  SELECT 'airtable_sync','integration_conflict',ic.id,ic.entity_type,'Airtable reconciliation conflict',
    'blocking',ic.status,NULL,ic.created_at,'/app/events/'||ic.event_id||'/control-room?category=airtable_sync',NULL
  FROM integration_conflicts ic WHERE ic.event_id=?1 AND ic.status='open'
  UNION ALL
  SELECT 'integration_failures','integration_incident',ii.id,ii.integration,ii.summary,ii.severity,ii.status,
    NULL,ii.last_seen_at,'/app/events/'||ii.event_id||'/control-room?category=integration_failures',NULL
  FROM integration_incidents ii WHERE ii.event_id=?1 AND ii.status IN ('open','acknowledged')
`;

// Cloudflare's SQLite build intentionally caps compound SELECT terms. Keep
// each live operational query below that cap and merge bounded windows below.
const issueGroups = issuesSql
  .trim()
  .split(/\n\s*UNION ALL\n/)
  .reduce<string[][]>((groups, query, index) => {
    const group = Math.floor(index / 4);
    (groups[group] ??= []).push(query);
    return groups;
  }, []);

function safeFilter(value: string | undefined, max = 80) {
  return value?.trim().slice(0, max) || undefined;
}

router.get("/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const category = safeFilter(context.req.query("category"));
  const trackId = safeFilter(context.req.query("track"));
  const owner = safeFilter(context.req.query("owner"));
  const status = safeFilter(context.req.query("status"));
  const severity = safeFilter(context.req.query("severity"));
  const deadline = safeFilter(context.req.query("deadline"));
  const page = Math.max(1, Number(context.req.query("page") || 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Number(context.req.query("pageSize") || 30) || 30),
  );
  const clauses: string[] = [];
  const bindings: unknown[] = [eventId];
  const add = (sql: string, value: unknown) => {
    bindings.push(value);
    clauses.push(sql.replace("?", `?${bindings.length}`));
  };
  if (category) add("i.category=?", category);
  if (trackId) add("i.trackId=?", trackId);
  if (owner === "unassigned") clauses.push("cro.owner_user_id IS NULL");
  else if (owner) add("cro.owner_user_id=?", owner);
  if (status) add("i.status=?", status);
  if (severity && ["blocking", "warning", "info"].includes(severity))
    add("i.severity=?", severity);
  if (deadline === "overdue")
    clauses.push("i.deadline IS NOT NULL AND i.deadline<CURRENT_TIMESTAMP");
  if (deadline === "upcoming")
    clauses.push("i.deadline IS NOT NULL AND i.deadline>=CURRENT_TIMESTAMP");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM issues i LEFT JOIN control_room_issue_owners cro
    ON cro.event_id=?1 AND cro.category=i.category AND cro.entity_type=i.entityType AND cro.entity_id=i.entityId
    LEFT JOIN users owner_user ON owner_user.id=cro.owner_user_id ${where}`;
  const [event, ownersResult, tracksResult] = await Promise.all([
    db
      .prepare("SELECT id,name FROM events WHERE id=?")
      .bind(eventId)
      .first<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT DISTINCT u.id,u.name FROM users u
      LEFT JOIN organization_members om ON om.user_id=u.id AND om.organization_id=?
      LEFT JOIN event_members em ON em.user_id=u.id AND em.event_id=?
      WHERE om.role IN ('owner','admin') OR em.role IN ('owner','admin') ORDER BY u.name LIMIT 100`,
      )
      .bind(access.organizationId, eventId)
      .all<{ id: string; name: string }>(),
    db
      .prepare(
        "SELECT id,name FROM tracks WHERE event_id=? ORDER BY position,name LIMIT 250",
      )
      .bind(eventId)
      .all<{ id: string; name: string }>(),
  ]);
  if (!event) throw new HttpError(404, "event_not_found", "Event not found.");
  const windowSize = Math.min(1000, page * pageSize);
  const groupResults = await Promise.all(
    issueGroups.map(async (group) => {
      const cte = `WITH issues(category,entityType,entityId,title,detail,severity,status,deadline,occurredAt,actionUrl,trackId) AS (${group.join("\nUNION ALL\n")})`;
      const itemBindings = [...bindings, windowSize];
      const [counts, items] = await Promise.all([
        db
          .prepare(
            `${cte} SELECT i.category,i.severity,COUNT(*) count ${from} GROUP BY i.category,i.severity`,
          )
          .bind(...bindings)
          .all<{
            category: string;
            severity: IssueRow["severity"];
            count: number;
          }>(),
        db
          .prepare(
            `${cte} SELECT i.*,cro.owner_user_id ownerUserId,owner_user.name ownerName ${from}
             ORDER BY CASE i.severity WHEN 'blocking' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               CASE WHEN i.deadline IS NOT NULL AND i.deadline<CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
               COALESCE(i.deadline,i.occurredAt) ASC,i.category ASC,i.entityId ASC
             LIMIT ?${itemBindings.length}`,
          )
          .bind(...itemBindings)
          .all<IssueRow>(),
      ]);
      return { counts: counts.results, items: items.results };
    }),
  );
  const countMap = new Map<string, number>();
  const severityCounts: Record<IssueRow["severity"], number> = {
    blocking: 0,
    warning: 0,
    info: 0,
  };
  for (const row of groupResults.flatMap((result) => result.counts)) {
    countMap.set(row.category, (countMap.get(row.category) ?? 0) + row.count);
    severityCounts[row.severity] += row.count;
  }
  const severityRank = { blocking: 0, warning: 1, info: 2 } as const;
  const now = Date.now();
  const allItems = groupResults
    .flatMap((result) => result.items)
    .sort((left, right) => {
      const severity =
        severityRank[left.severity] - severityRank[right.severity];
      if (severity) return severity;
      const leftOverdue =
        left.deadline && Date.parse(left.deadline) < now ? 0 : 1;
      const rightOverdue =
        right.deadline && Date.parse(right.deadline) < now ? 0 : 1;
      if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
      const leftDate = Date.parse(left.deadline ?? left.occurredAt);
      const rightDate = Date.parse(right.deadline ?? right.occurredAt);
      return (
        leftDate - rightDate ||
        left.category.localeCompare(right.category) ||
        left.entityId.localeCompare(right.entityId)
      );
    });
  const total = [...countMap.values()].reduce((sum, count) => sum + count, 0);
  const items = allItems.slice((page - 1) * pageSize, page * pageSize);
  return context.json({
    event,
    role: access.role,
    counts: Object.fromEntries(countMap),
    severityCounts,
    total,
    items,
    owners: ownersResult.results,
    tracks: tracksResult.results,
    pagination: { page, pageSize, total },
    refreshedAt: new Date().toISOString(),
  });
});

router.put(
  "/events/:eventId/issues/:category/:entityType/:entityId/owner",
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const { ownerUserId } = await context.req.json<{
      ownerUserId?: string | null;
    }>();
    const category = context.req.param("category");
    const entityType = context.req.param("entityType");
    const entityId = context.req.param("entityId");
    const db = database(context.env);
    if (ownerUserId) {
      const permitted = await db
        .prepare(
          `SELECT 1 ok FROM users u
      LEFT JOIN organization_members om ON om.user_id=u.id AND om.organization_id=?
      LEFT JOIN event_members em ON em.user_id=u.id AND em.event_id=?
      WHERE u.id=? AND (om.role IN ('owner','admin') OR em.role IN ('owner','admin'))`,
        )
        .bind(access.organizationId, eventId, ownerUserId)
        .first();
      if (!permitted)
        throw new HttpError(
          400,
          "invalid_owner",
          "Select an organizer for this event.",
        );
    }
    const before = await db
      .prepare(
        `SELECT owner_user_id ownerUserId FROM control_room_issue_owners
    WHERE event_id=? AND category=? AND entity_type=? AND entity_id=?`,
      )
      .bind(eventId, category, entityType, entityId)
      .first();
    const statement = ownerUserId
      ? db
          .prepare(
            `INSERT INTO control_room_issue_owners
        (id,organization_id,event_id,category,entity_type,entity_id,owner_user_id,assigned_by)
       VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(event_id,category,entity_type,entity_id)
       DO UPDATE SET owner_user_id=excluded.owner_user_id,assigned_by=excluded.assigned_by,assigned_at=CURRENT_TIMESTAMP`,
          )
          .bind(
            crypto.randomUUID(),
            access.organizationId,
            eventId,
            category,
            entityType,
            entityId,
            ownerUserId,
            access.user.id,
          )
      : db
          .prepare(
            `DELETE FROM control_room_issue_owners WHERE event_id=? AND category=? AND entity_type=? AND entity_id=?`,
          )
          .bind(eventId, category, entityType, entityId);
    await db.batch([
      statement,
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "control_room.owner_changed",
        entityType,
        entityId,
        before,
        after: { category, ownerUserId: ownerUserId ?? null },
        requestId: context.get("requestId"),
      }),
    ]);
    console.info(
      JSON.stringify({
        level: "info",
        service: "control_room",
        operation: "owner_changed",
        requestId: context.get("requestId"),
        eventId,
        category,
        entityType,
        entityId,
      }),
    );
    return context.json({ ok: true });
  },
);

router.post(
  "/events/:eventId/issues/:category/:entityType/:entityId/resolve",
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const category = context.req.param("category");
    const entityId = context.req.param("entityId");
    let statement: D1PreparedStatement;
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    if (category === "submissions_new") {
      const submission = await db
        .prepare(
          "SELECT status,organizer_seen_at organizerSeenAt FROM submissions WHERE id=? AND event_id=?",
        )
        .bind(entityId, eventId)
        .first<{ status: string; organizerSeenAt: string | null }>();
      if (submission?.status !== "pending" || submission.organizerSeenAt)
        throw new HttpError(
          400,
          "not_resolvable",
          "Drafts remain visible until they are submitted or withdrawn.",
        );
      statement = db
        .prepare(
          "UPDATE submissions SET organizer_seen_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=? AND status='pending'",
        )
        .bind(entityId, eventId);
      before = submission;
      after = { ...submission, organizerSeenAt: "now" };
    } else if (category === "review_conflicts") {
      const conflict = await db
        .prepare(
          "SELECT status,resolved_by resolvedBy,resolved_at resolvedAt FROM review_conflicts WHERE id=? AND event_id=?",
        )
        .bind(entityId, eventId)
        .first<Record<string, unknown>>();
      if (!conflict || conflict.status !== "unresolved")
        throw new HttpError(404, "issue_not_found", "Open issue not found.");
      statement = db
        .prepare(
          "UPDATE review_conflicts SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=? AND status='unresolved'",
        )
        .bind(access.user.id, entityId, eventId);
      before = conflict;
      after = { status: "resolved", resolvedBy: access.user.id };
    } else if (category === "schedule_conflicts") {
      const conflict = await db
        .prepare(
          "SELECT status,resolved_by resolvedBy,resolved_at resolvedAt FROM schedule_conflict_records WHERE id=? AND event_id=?",
        )
        .bind(entityId, eventId)
        .first<Record<string, unknown>>();
      if (!conflict || conflict.status !== "open")
        throw new HttpError(404, "issue_not_found", "Open issue not found.");
      statement = db
        .prepare(
          "UPDATE schedule_conflict_records SET status='dismissed',resolved_by=?,resolved_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=? AND status='open'",
        )
        .bind(access.user.id, entityId, eventId);
      before = conflict;
      after = { status: "dismissed", resolvedBy: access.user.id };
    } else if (category === "integration_failures") {
      const incident = await db
        .prepare(
          "SELECT status FROM integration_incidents WHERE id=? AND event_id=?",
        )
        .bind(entityId, eventId)
        .first<{ status: string }>();
      if (!incident || incident.status !== "open")
        throw new HttpError(404, "issue_not_found", "Open issue not found.");
      statement = db
        .prepare(
          "UPDATE integration_incidents SET status='acknowledged' WHERE id=? AND event_id=? AND status='open'",
        )
        .bind(entityId, eventId);
      before = incident;
      after = { status: "acknowledged" };
    } else
      throw new HttpError(
        400,
        "not_resolvable",
        "Open the linked workflow to resolve this issue.",
      );
    await db.batch([
      statement,
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "control_room.issue_resolved",
        entityType: context.req.param("entityType"),
        entityId,
        before,
        after: { category, ...after },
        requestId: context.get("requestId"),
      }),
    ]);
    console.info(
      JSON.stringify({
        level: "info",
        service: "control_room",
        operation: "issue_resolved",
        requestId: context.get("requestId"),
        eventId,
        category,
        entityType: context.req.param("entityType"),
        entityId,
      }),
    );
    return context.json({ ok: true });
  },
);

export default router;
