import type { Env } from "../env";
import { auditStatement } from "./audit";
import { database } from "./authz";

export type RoutingSource =
  "form" | "track" | "format" | "tag" | "custom_field";
export type RoutingOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "in"
  | "is_set"
  | "is_not_set";

export type RoutingCondition = {
  id: string;
  source: RoutingSource;
  fieldId: string | null;
  operator: RoutingOperator;
  value: unknown;
  position: number;
};

export type RoutingGroup = {
  id: string;
  position: number;
  conditionOperator: "and" | "or";
  conditions: RoutingCondition[];
};

export type RoutingRule = {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  groupOperator: "and" | "or";
  roundId: string;
  roundName: string;
  reviewersPerSubmission: number;
  ownerUserId: string | null;
  ownerName: string | null;
  groups: RoutingGroup[];
  excludedReviewerIds: string[];
  tagIds: string[];
};

export type RoutingSubmission = {
  id: string;
  title: string;
  formId: string;
  formName: string;
  format: string | null;
  answers: Record<string, unknown>;
  tracks: string[];
  tags: string[];
  fieldKeys: Record<string, string>;
  speakerEmails: string[];
};

export type RoutingDiagnostic = {
  type: "overlap" | "contradiction" | "unmatched";
  message: string;
  ruleIds?: string[];
  submissionId?: string;
};

export type RoutingPreview = {
  submissions: Array<{
    submissionId: string;
    submissionTitle: string;
    matchedRuleIds: string[];
    selectedRuleId: string | null;
    eligibleReviewerIds: string[];
    excludedReviewerIds: string[];
  }>;
  diagnostics: RoutingDiagnostic[];
};

function scalarValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (value === null || value === undefined) return [];
  if (typeof value === "boolean") return [value ? "true" : "false"];
  if (typeof value === "object") return [JSON.stringify(value)];
  return [String(value).trim().toLowerCase()];
}

export function routingConditionMatches(
  condition: RoutingCondition,
  submission: RoutingSubmission,
) {
  let actual: unknown;
  if (condition.source === "form") actual = submission.formId;
  else if (condition.source === "track") actual = submission.tracks;
  else if (condition.source === "format") actual = submission.format;
  else if (condition.source === "tag") actual = submission.tags;
  else {
    const fieldKey = condition.fieldId
      ? submission.fieldKeys[condition.fieldId]
      : undefined;
    actual = fieldKey ? submission.answers[fieldKey] : undefined;
  }
  const actualValues = scalarValues(actual);
  const expectedValues = scalarValues(condition.value);
  const isSet = actualValues.some((value) => value.length > 0);
  if (condition.operator === "is_set") return isSet;
  if (condition.operator === "is_not_set") return !isSet;
  const equals = actualValues.some((value) => expectedValues.includes(value));
  const contains = actualValues.some((value) =>
    expectedValues.some(
      (expected) => value.includes(expected) || expected.includes(value),
    ),
  );
  if (condition.operator === "equals") return equals;
  if (condition.operator === "not_equals") return !equals;
  if (condition.operator === "contains") return contains;
  if (condition.operator === "not_contains") return !contains;
  return expectedValues.some((value) => actualValues.includes(value));
}

export function routingRuleMatches(
  rule: RoutingRule,
  submission: RoutingSubmission,
) {
  if (!rule.enabled || !rule.groups.length) return false;
  const groupResults = rule.groups.map((group) => {
    if (!group.conditions.length) return false;
    const matches = group.conditions.map((condition) =>
      routingConditionMatches(condition, submission),
    );
    return group.conditionOperator === "and"
      ? matches.every(Boolean)
      : matches.some(Boolean);
  });
  return rule.groupOperator === "and"
    ? groupResults.every(Boolean)
    : groupResults.some(Boolean);
}

export function contradictoryRuleConditions(rule: RoutingRule) {
  const contradictions: string[] = [];
  for (const group of rule.groups) {
    if (group.conditionOperator !== "and") continue;
    const equalsBySource = new Map<string, Set<string>>();
    const notEqualsBySource = new Map<string, Set<string>>();
    for (const condition of group.conditions) {
      const key = `${condition.source}:${condition.fieldId ?? ""}`;
      const target =
        condition.operator === "equals"
          ? equalsBySource
          : condition.operator === "not_equals"
            ? notEqualsBySource
            : null;
      if (!target) continue;
      const values = target.get(key) ?? new Set<string>();
      for (const value of scalarValues(condition.value)) values.add(value);
      target.set(key, values);
    }
    for (const [key, values] of equalsBySource)
      if (values.size > 1)
        contradictions.push(
          `${rule.name} requires conflicting values for ${key.replace(":", " ").trim()}.`,
        );
    for (const [key, equals] of equalsBySource) {
      const excluded = notEqualsBySource.get(key);
      if (excluded && [...equals].some((value) => excluded.has(value)))
        contradictions.push(
          `${rule.name} both requires and excludes the same value for ${key.replace(":", " ").trim()}.`,
        );
    }
  }
  return contradictions;
}

export async function loadRoutingRules(
  db: D1Database,
  eventId: string,
): Promise<RoutingRule[]> {
  const [rulesResult, groupsResult, conditionsResult, excluded, tags] =
    await Promise.all([
      db
        .prepare(
          `SELECT r.id,r.event_id eventId,r.name,r.description,r.priority,r.enabled,
                  r.group_operator groupOperator,r.round_id roundId,rr.name roundName,
                  r.reviewers_per_submission reviewersPerSubmission,r.owner_user_id ownerUserId,u.name ownerName
           FROM review_routing_rules r JOIN review_rounds rr ON rr.id=r.round_id
           LEFT JOIN users u ON u.id=r.owner_user_id
           WHERE r.event_id=? ORDER BY r.priority,r.id`,
        )
        .bind(eventId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT g.id,g.rule_id ruleId,g.position,g.condition_operator conditionOperator
           FROM review_routing_condition_groups g JOIN review_routing_rules r ON r.id=g.rule_id
           WHERE r.event_id=? ORDER BY r.priority,g.position,g.id`,
        )
        .bind(eventId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT c.id,g.rule_id ruleId,c.group_id groupId,c.source,c.field_id fieldId,c.operator,c.value_json valueJson,c.position
           FROM review_routing_conditions c JOIN review_routing_condition_groups g ON g.id=c.group_id
           JOIN review_routing_rules r ON r.id=g.rule_id WHERE r.event_id=?
           ORDER BY r.priority,g.position,c.position,c.id`,
        )
        .bind(eventId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT x.rule_id ruleId,x.reviewer_user_id reviewerUserId FROM review_routing_excluded_reviewers x
           JOIN review_routing_rules r ON r.id=x.rule_id WHERE r.event_id=? ORDER BY x.reviewer_user_id`,
        )
        .bind(eventId)
        .all<{ ruleId: string; reviewerUserId: string }>(),
      db
        .prepare(
          `SELECT x.rule_id ruleId,x.tag_id tagId FROM review_routing_rule_tags x
           JOIN review_routing_rules r ON r.id=x.rule_id WHERE r.event_id=? ORDER BY x.tag_id`,
        )
        .bind(eventId)
        .all<{ ruleId: string; tagId: string }>(),
    ]);
  return rulesResult.results.map((row) => {
    const ruleGroups = groupsResult.results
      .filter((group) => group.ruleId === row.id)
      .map((group) => ({
        id: String(group.id),
        position: Number(group.position),
        conditionOperator: String(group.conditionOperator) as "and" | "or",
        conditions: conditionsResult.results
          .filter((condition) => condition.groupId === group.id)
          .map((condition) => ({
            id: String(condition.id),
            source: String(condition.source) as RoutingSource,
            fieldId: condition.fieldId ? String(condition.fieldId) : null,
            operator: String(condition.operator) as RoutingOperator,
            value: condition.valueJson
              ? JSON.parse(String(condition.valueJson))
              : null,
            position: Number(condition.position),
          })),
      }));
    return {
      id: String(row.id),
      eventId: String(row.eventId),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      priority: Number(row.priority),
      enabled: Boolean(row.enabled),
      groupOperator: String(row.groupOperator) as "and" | "or",
      roundId: String(row.roundId),
      roundName: String(row.roundName),
      reviewersPerSubmission: Number(row.reviewersPerSubmission),
      ownerUserId: row.ownerUserId ? String(row.ownerUserId) : null,
      ownerName: row.ownerName ? String(row.ownerName) : null,
      groups: ruleGroups,
      excludedReviewerIds: excluded.results
        .filter((item) => item.ruleId === row.id)
        .map((item) => item.reviewerUserId),
      tagIds: tags.results
        .filter((item) => item.ruleId === row.id)
        .map((item) => item.tagId),
    };
  });
}

export async function loadRoutingSubmissions(
  db: D1Database,
  eventId: string,
  submissionIds?: string[],
): Promise<RoutingSubmission[]> {
  const selected = submissionIds?.length
    ? ` AND s.id IN (${submissionIds.map(() => "?").join(",")})`
    : "";
  const rows = await db
    .prepare(
      `SELECT s.id,s.title,s.form_id formId,f.name formName,s.format,s.answers_json answersJson,
              GROUP_CONCAT(DISTINCT st.track_id) trackIds,
              GROUP_CONCAT(DISTINCT sta.tag_id) tagIds,
              GROUP_CONCAT(DISTINCT LOWER(p.email)) speakerEmails
       FROM submissions s JOIN cfp_forms f ON f.id=s.form_id
       LEFT JOIN submission_tracks st ON st.submission_id=s.id
       LEFT JOIN submission_tag_assignments sta ON sta.submission_id=s.id
       LEFT JOIN submission_people p ON p.submission_id=s.id
       WHERE s.event_id=? AND s.status NOT IN ('draft','withdrawn')${selected}
       GROUP BY s.id ORDER BY s.submitted_at,s.id`,
    )
    .bind(eventId, ...(submissionIds ?? []))
    .all<Record<string, unknown>>();
  const fields = await db
    .prepare(
      `SELECT ff.id,ff.field_key fieldKey FROM form_fields ff
       JOIN cfp_forms f ON f.id=ff.form_id WHERE f.event_id=?`,
    )
    .bind(eventId)
    .all<{ id: string; fieldKey: string }>();
  const fieldKeys = Object.fromEntries(
    fields.results.map((field) => [field.id, field.fieldKey]),
  );
  return rows.results.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    formId: String(row.formId),
    formName: String(row.formName),
    format: row.format ? String(row.format) : null,
    answers: JSON.parse(String(row.answersJson ?? "{}")),
    tracks: row.trackIds ? String(row.trackIds).split(",") : [],
    tags: row.tagIds ? String(row.tagIds).split(",") : [],
    fieldKeys,
    speakerEmails: row.speakerEmails
      ? String(row.speakerEmails).split(",")
      : [],
  }));
}

async function eligibleReviewers(
  db: D1Database,
  eventId: string,
  rule: RoutingRule,
  submission: RoutingSubmission,
) {
  const pool = await db
    .prepare(
      `SELECT p.reviewer_user_id reviewerUserId,p.capacity,u.email,
              COUNT(CASE WHEN a.id IS NOT NULL AND a.recused_at IS NULL THEN 1 END) assignmentCount
       FROM review_round_reviewers p JOIN users u ON u.id=p.reviewer_user_id
       LEFT JOIN review_assignments a ON a.round_id=p.round_id AND a.reviewer_user_id=p.reviewer_user_id
       WHERE p.round_id=? GROUP BY p.reviewer_user_id,p.capacity,u.email ORDER BY assignmentCount,p.reviewer_user_id`,
    )
    .bind(rule.roundId)
    .all<{
      reviewerUserId: string;
      capacity: number;
      email: string;
      assignmentCount: number;
    }>();
  const unresolved = await db
    .prepare(
      `SELECT reviewer_user_id reviewerUserId FROM review_conflicts
       WHERE event_id=? AND submission_id=? AND status='unresolved'`,
    )
    .bind(eventId, submission.id)
    .all<{ reviewerUserId: string }>();
  const recused = await db
    .prepare(
      `SELECT reviewer_user_id reviewerUserId FROM review_assignments
       WHERE round_id=? AND submission_id=? AND recused_at IS NOT NULL`,
    )
    .bind(rule.roundId, submission.id)
    .all<{ reviewerUserId: string }>();
  const blocked = new Set([
    ...rule.excludedReviewerIds,
    ...unresolved.results.map((item) => item.reviewerUserId),
    ...recused.results.map((item) => item.reviewerUserId),
  ]);
  return pool.results.map((reviewer) => {
    const conflict =
      blocked.has(reviewer.reviewerUserId) ||
      submission.speakerEmails.includes(reviewer.email.toLowerCase());
    const overCapacity =
      Number(reviewer.assignmentCount) >= Number(reviewer.capacity);
    return { ...reviewer, conflict, overCapacity };
  });
}

export async function previewReviewRouting(
  db: D1Database,
  eventId: string,
  submissionIds?: string[],
): Promise<RoutingPreview> {
  const [rules, submissions] = await Promise.all([
    loadRoutingRules(db, eventId),
    loadRoutingSubmissions(db, eventId, submissionIds),
  ]);
  const diagnostics: RoutingDiagnostic[] = rules.flatMap((rule) =>
    contradictoryRuleConditions(rule).map((message) => ({
      type: "contradiction" as const,
      message,
      ruleIds: [rule.id],
    })),
  );
  const previews = [];
  for (const submission of submissions) {
    const matches = rules.filter((rule) =>
      routingRuleMatches(rule, submission),
    );
    if (!matches.length)
      diagnostics.push({
        type: "unmatched",
        submissionId: submission.id,
        message: `${submission.formName} proposal ${submission.id} has no matching route.`,
      });
    if (matches.length > 1)
      diagnostics.push({
        type: "overlap",
        submissionId: submission.id,
        ruleIds: matches.map((rule) => rule.id),
        message: `${matches.length} rules match; ${matches[0].name} wins by priority.`,
      });
    const selected = matches[0] ?? null;
    const reviewers = selected
      ? await eligibleReviewers(db, eventId, selected, submission)
      : [];
    previews.push({
      submissionId: submission.id,
      submissionTitle: submission.title,
      matchedRuleIds: matches.map((rule) => rule.id),
      selectedRuleId: selected?.id ?? null,
      eligibleReviewerIds: reviewers
        .filter((reviewer) => !reviewer.conflict && !reviewer.overCapacity)
        .map((reviewer) => reviewer.reviewerUserId),
      excludedReviewerIds: reviewers
        .filter((reviewer) => reviewer.conflict || reviewer.overCapacity)
        .map((reviewer) => reviewer.reviewerUserId),
    });
  }
  return { submissions: previews, diagnostics };
}

export async function runReviewRouting(
  env: Env,
  input: {
    organizationId: string;
    eventId: string;
    triggerType: "submission" | "manual";
    actorUserId?: string;
    submissionIds?: string[];
    requestId?: string;
  },
) {
  const db = database(env);
  const runId = crypto.randomUUID();
  const eventOwner = await db
    .prepare("SELECT created_by createdBy FROM events WHERE id=?")
    .bind(input.eventId)
    .first<{ createdBy: string }>();
  const assignmentActorId = input.actorUserId ?? eventOwner?.createdBy;
  if (!assignmentActorId)
    throw new Error("The event owner is unavailable for routing attribution.");
  const [rules, submissions] = await Promise.all([
    loadRoutingRules(db, input.eventId),
    loadRoutingSubmissions(db, input.eventId, input.submissionIds),
  ]);
  await db
    .prepare(
      `INSERT INTO review_routing_runs
       (id,organization_id,event_id,trigger_type,requested_by,submission_count)
       VALUES(?,?,?,?,?,?)`,
    )
    .bind(
      runId,
      input.organizationId,
      input.eventId,
      input.triggerType,
      input.actorUserId ?? null,
      submissions.length,
    )
    .run();
  let matchedCount = 0;
  let assignmentCount = 0;
  let conflictCount = 0;
  let capacityCount = 0;
  let unmatchedCount = 0;
  try {
    for (const submission of submissions) {
      const rule = rules.find((candidate) =>
        routingRuleMatches(candidate, submission),
      );
      if (!rule) {
        unmatchedCount += 1;
        await db.batch([
          db
            .prepare(
              `INSERT INTO review_routing_results
               (id,run_id,submission_id,outcome,detail) VALUES(?,?,?,'unmatched',?)`,
            )
            .bind(
              crypto.randomUUID(),
              runId,
              submission.id,
              "No enabled routing rule matched this proposal.",
            ),
          db
            .prepare(
              `INSERT INTO submission_routing_state
               (submission_id,event_id,status,last_run_id,last_routed_at,updated_at)
               VALUES(?,?,'unmatched',?,?,?)
               ON CONFLICT(submission_id) DO UPDATE SET matched_rule_id=NULL,round_id=NULL,status='unmatched',
                 assignment_count=0,required_assignment_count=0,last_run_id=excluded.last_run_id,
                 last_routed_at=excluded.last_routed_at,updated_at=excluded.updated_at`,
            )
            .bind(
              submission.id,
              input.eventId,
              runId,
              new Date().toISOString(),
              new Date().toISOString(),
            ),
          auditStatement(db, {
            organizationId: input.organizationId,
            eventId: input.eventId,
            actorUserId: input.actorUserId,
            action: "review_routing.unmatched",
            entityType: "submission",
            entityId: submission.id,
            after: { runId, triggerType: input.triggerType },
            requestId: input.requestId,
          }),
        ]);
        continue;
      }
      matchedCount += 1;
      const existing = await db
        .prepare(
          `SELECT reviewer_user_id reviewerUserId FROM review_assignments
           WHERE round_id=? AND submission_id=? AND recused_at IS NULL`,
        )
        .bind(rule.roundId, submission.id)
        .all<{ reviewerUserId: string }>();
      const current = new Set(
        existing.results.map((item) => item.reviewerUserId),
      );
      const reviewers = await eligibleReviewers(
        db,
        input.eventId,
        rule,
        submission,
      );
      const needed = Math.max(0, rule.reviewersPerSubmission - current.size);
      const selected = reviewers
        .filter(
          (reviewer) =>
            !current.has(reviewer.reviewerUserId) &&
            !reviewer.conflict &&
            !reviewer.overCapacity,
        )
        .slice(0, needed);
      conflictCount += reviewers.filter(
        (reviewer) =>
          !current.has(reviewer.reviewerUserId) && reviewer.conflict,
      ).length;
      capacityCount += reviewers.filter(
        (reviewer) =>
          !current.has(reviewer.reviewerUserId) && reviewer.overCapacity,
      ).length;
      const statements: D1PreparedStatement[] = [];
      for (const reviewerUserId of current)
        statements.push(
          db
            .prepare(
              `INSERT INTO review_routing_results
               (id,run_id,submission_id,rule_id,round_id,outcome,reviewer_user_id,detail)
               VALUES(?,?,?,?,?,'already_assigned',?,'Kept the existing assignment; no duplicate was created.')`,
            )
            .bind(
              crypto.randomUUID(),
              runId,
              submission.id,
              rule.id,
              rule.roundId,
              reviewerUserId,
            ),
        );
      for (const reviewer of reviewers.filter(
        (candidate) =>
          !current.has(candidate.reviewerUserId) &&
          (candidate.conflict || candidate.overCapacity),
      ))
        statements.push(
          db
            .prepare(
              `INSERT INTO review_routing_results
               (id,run_id,submission_id,rule_id,round_id,outcome,reviewer_user_id,detail)
               VALUES(?,?,?,?,?,?,?,?)`,
            )
            .bind(
              crypto.randomUUID(),
              runId,
              submission.id,
              rule.id,
              rule.roundId,
              reviewer.conflict ? "conflict_skipped" : "capacity_skipped",
              reviewer.reviewerUserId,
              reviewer.conflict
                ? "Skipped because of a conflict, recusal, self-review boundary, or explicit exclusion."
                : "Skipped because the reviewer reached capacity.",
            ),
        );
      for (const reviewer of selected) {
        const assignmentId = crypto.randomUUID();
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO review_assignments
               (id,round_id,submission_id,reviewer_user_id) VALUES(?,?,?,?)`,
            )
            .bind(
              assignmentId,
              rule.roundId,
              submission.id,
              reviewer.reviewerUserId,
            ),
          db
            .prepare(
              `INSERT INTO review_routing_results
               (id,run_id,submission_id,rule_id,round_id,outcome,reviewer_user_id,detail)
               VALUES(?,?,?,?,?,'assigned',?,?)`,
            )
            .bind(
              crypto.randomUUID(),
              runId,
              submission.id,
              rule.id,
              rule.roundId,
              reviewer.reviewerUserId,
              `Assigned by ${rule.name}.`,
            ),
          auditStatement(db, {
            organizationId: input.organizationId,
            eventId: input.eventId,
            actorUserId: input.actorUserId,
            action: "review_routing.assignment_created",
            entityType: "review_assignment",
            entityId: assignmentId,
            after: {
              runId,
              ruleId: rule.id,
              roundId: rule.roundId,
              submissionId: submission.id,
              reviewerUserId: reviewer.reviewerUserId,
            },
            requestId: input.requestId,
          }),
        );
      }
      assignmentCount += selected.length;
      for (const tagId of rule.tagIds)
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO submission_tag_assignments
               (submission_id,tag_id,assigned_by) VALUES(?,?,?)`,
            )
            .bind(submission.id, tagId, assignmentActorId),
        );
      if (rule.ownerUserId)
        statements.push(
          db
            .prepare(
              `INSERT INTO submission_owners
               (submission_id,event_id,owner_user_id,assigned_by,source_rule_id)
               VALUES(?,?,?,?,?)
               ON CONFLICT(submission_id) DO UPDATE SET owner_user_id=excluded.owner_user_id,
                 assigned_by=excluded.assigned_by,source_rule_id=excluded.source_rule_id,
                 assigned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`,
            )
            .bind(
              submission.id,
              input.eventId,
              rule.ownerUserId,
              input.actorUserId ?? null,
              rule.id,
            ),
        );
      const total = current.size + selected.length;
      const status =
        total >= rule.reviewersPerSubmission
          ? "assigned"
          : total
            ? "partially_assigned"
            : "matched";
      if (total < rule.reviewersPerSubmission && !selected.length)
        statements.push(
          db
            .prepare(
              `INSERT INTO review_routing_results
               (id,run_id,submission_id,rule_id,round_id,outcome,detail)
               VALUES(?,?,?,?,?,'no_eligible_reviewer','No additional conflict-free reviewer with available capacity was eligible.')`,
            )
            .bind(
              crypto.randomUUID(),
              runId,
              submission.id,
              rule.id,
              rule.roundId,
            ),
        );
      statements.push(
        db
          .prepare(
            `INSERT INTO submission_routing_state
             (submission_id,event_id,matched_rule_id,round_id,status,assignment_count,required_assignment_count,last_run_id,last_routed_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(submission_id) DO UPDATE SET matched_rule_id=excluded.matched_rule_id,
               round_id=excluded.round_id,status=excluded.status,assignment_count=excluded.assignment_count,
               required_assignment_count=excluded.required_assignment_count,last_run_id=excluded.last_run_id,
               last_routed_at=excluded.last_routed_at,updated_at=excluded.updated_at`,
          )
          .bind(
            submission.id,
            input.eventId,
            rule.id,
            rule.roundId,
            status,
            total,
            rule.reviewersPerSubmission,
            runId,
            new Date().toISOString(),
            new Date().toISOString(),
          ),
        auditStatement(db, {
          organizationId: input.organizationId,
          eventId: input.eventId,
          actorUserId: input.actorUserId,
          action: "review_routing.applied",
          entityType: "submission",
          entityId: submission.id,
          after: {
            runId,
            ruleId: rule.id,
            roundId: rule.roundId,
            status,
            assignmentsCreated: selected.length,
            skippedConflictCount: reviewers.filter(
              (reviewer) =>
                !current.has(reviewer.reviewerUserId) && reviewer.conflict,
            ).length,
            skippedCapacityCount: reviewers.filter(
              (reviewer) =>
                !current.has(reviewer.reviewerUserId) && reviewer.overCapacity,
            ).length,
          },
          requestId: input.requestId,
        }),
      );
      if (statements.length) await db.batch(statements);
    }
    await db
      .prepare(
        `UPDATE review_routing_runs SET matched_count=?,assignment_count=?,skipped_conflict_count=?,
         skipped_capacity_count=?,unmatched_count=?,status='completed',completed_at=? WHERE id=?`,
      )
      .bind(
        matchedCount,
        assignmentCount,
        conflictCount,
        capacityCount,
        unmatchedCount,
        new Date().toISOString(),
        runId,
      )
      .run();
  } catch (error) {
    await db
      .prepare(
        `UPDATE review_routing_runs SET status='failed',failure_reason=?,completed_at=? WHERE id=?`,
      )
      .bind(
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Routing failed",
        new Date().toISOString(),
        runId,
      )
      .run();
    throw error;
  }
  return {
    id: runId,
    submissionCount: submissions.length,
    matchedCount,
    assignmentCount,
    skippedConflictCount: conflictCount,
    skippedCapacityCount: capacityCount,
    unmatchedCount,
  };
}
