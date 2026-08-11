import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";
import {
  loadRoutingRules,
  previewReviewRouting,
  runReviewRouting,
} from "../lib/reviewRouting";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

const conditionSchema = z.object({
  source: z.enum(["form", "track", "format", "tag", "custom_field"]),
  fieldId: z.string().uuid().nullable().optional(),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "in",
    "is_set",
    "is_not_set",
  ]),
  value: z.unknown().optional(),
});
const groupSchema = z.object({
  conditionOperator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(conditionSchema).min(1).max(20),
});
const ruleSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  priority: z.number().int().min(0).max(10000),
  enabled: z.boolean().default(true),
  groupOperator: z.enum(["and", "or"]).default("and"),
  roundId: z.string().uuid(),
  reviewersPerSubmission: z.number().int().min(1).max(20),
  ownerUserId: z.string().uuid().nullable().optional(),
  excludedReviewerIds: z.array(z.string().uuid()).max(100).default([]),
  tagIds: z.array(z.string().uuid()).max(50).default([]),
  groups: z.array(groupSchema).min(1).max(10),
});
const previewSchema = z.object({
  submissionIds: z.array(z.string().uuid()).max(500).optional(),
});

router.get("/events/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const [
    rules,
    preview,
    rounds,
    reviewers,
    forms,
    tracks,
    tags,
    fields,
    owners,
    runs,
  ] = await Promise.all([
    loadRoutingRules(db, eventId),
    previewReviewRouting(db, eventId),
    db
      .prepare(
        "SELECT id,name,status,is_blind isBlind FROM review_rounds WHERE event_id=? ORDER BY position",
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        `SELECT u.id,u.name,u.email FROM users u JOIN event_members em ON em.user_id=u.id
         WHERE em.event_id=? AND em.role='reviewer' ORDER BY u.name COLLATE NOCASE`,
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        "SELECT id,name,slug FROM cfp_forms WHERE event_id=? ORDER BY name",
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        "SELECT id,name,color FROM tracks WHERE event_id=? ORDER BY position,name",
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        "SELECT id,name,color FROM submission_tags WHERE event_id=? ORDER BY name",
      )
      .bind(eventId)
      .all(),
    db
      .prepare(
        `SELECT ff.id,ff.form_id formId,ff.field_key fieldKey,ff.label,ff.field_type fieldType,ff.options_json optionsJson
         FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id WHERE f.event_id=? ORDER BY f.name,ff.position`,
      )
      .bind(eventId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT DISTINCT u.id,u.name,u.email FROM users u
         LEFT JOIN event_members em ON em.user_id=u.id AND em.event_id=?
         LEFT JOIN events e ON e.id=? LEFT JOIN organization_members om ON om.user_id=u.id AND om.organization_id=e.organization_id
         WHERE em.role IN ('owner','admin') OR om.role IN ('owner','admin','member') ORDER BY u.name COLLATE NOCASE`,
      )
      .bind(eventId, eventId)
      .all(),
    db
      .prepare(
        `SELECT id,trigger_type triggerType,submission_count submissionCount,matched_count matchedCount,
                assignment_count assignmentCount,skipped_conflict_count skippedConflictCount,
                skipped_capacity_count skippedCapacityCount,unmatched_count unmatchedCount,status,
                started_at startedAt,completed_at completedAt
         FROM review_routing_runs WHERE event_id=? AND trigger_type<>'preview'
         ORDER BY started_at DESC,id LIMIT 20`,
      )
      .bind(eventId)
      .all(),
  ]);
  return context.json({
    rules,
    preview,
    rounds: rounds.results,
    reviewers: reviewers.results,
    forms: forms.results,
    tracks: tracks.results,
    tags: tags.results,
    fields: fields.results.map((field) => ({
      ...field,
      name: field.label,
      options: field.optionsJson
        ? JSON.parse(String(field.optionsJson))
        : undefined,
      optionsJson: undefined,
    })),
    owners: owners.results,
    runs: runs.results,
  });
});

router.post(
  "/events/:eventId/preview",
  zValidator("json", previewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    return context.json({
      preview: await previewReviewRouting(
        database(context.env),
        eventId,
        context.req.valid("json").submissionIds,
      ),
    });
  },
);

router.post(
  "/events/:eventId/run",
  zValidator("json", previewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const result = await runReviewRouting(context.env, {
      organizationId: access.organizationId,
      eventId,
      triggerType: "manual",
      actorUserId: access.user.id,
      submissionIds: context.req.valid("json").submissionIds,
      requestId: context.get("requestId"),
    });
    return context.json({ result });
  },
);

router.post(
  "/events/:eventId/rules",
  zValidator("json", ruleSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await validateRuleReferences(db, eventId, input);
    const id = crypto.randomUUID();
    await writeRule(db, {
      id,
      eventId,
      organizationId: access.organizationId,
      userId: access.user.id,
      input,
      requestId: context.get("requestId"),
      action: "created",
    });
    return context.json({ ruleId: id }, 201);
  },
);

router.put(
  "/events/:eventId/rules/:ruleId",
  zValidator("json", ruleSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const ruleId = context.req.param("ruleId");
    const db = database(context.env);
    const before = await db
      .prepare("SELECT * FROM review_routing_rules WHERE id=? AND event_id=?")
      .bind(ruleId, eventId)
      .first();
    if (!before)
      throw new HttpError(
        404,
        "routing_rule_not_found",
        "Routing rule not found.",
      );
    const input = context.req.valid("json");
    await validateRuleReferences(db, eventId, input);
    await writeRule(db, {
      id: ruleId,
      eventId,
      organizationId: access.organizationId,
      userId: access.user.id,
      input,
      requestId: context.get("requestId"),
      action: "updated",
      before,
    });
    return context.json({ ruleId });
  },
);

router.delete("/events/:eventId/rules/:ruleId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const ruleId = context.req.param("ruleId");
  const before = await db
    .prepare("SELECT * FROM review_routing_rules WHERE id=? AND event_id=?")
    .bind(ruleId, eventId)
    .first();
  if (!before)
    throw new HttpError(
      404,
      "routing_rule_not_found",
      "Routing rule not found.",
    );
  await db.batch([
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "review_routing_rule.deleted",
      entityType: "review_routing_rule",
      entityId: ruleId,
      before,
      requestId: context.get("requestId"),
    }),
    db
      .prepare("DELETE FROM review_routing_rules WHERE id=? AND event_id=?")
      .bind(ruleId, eventId),
  ]);
  return context.body(null, 204);
});

async function validateRuleReferences(
  db: D1Database,
  eventId: string,
  input: z.infer<typeof ruleSchema>,
) {
  const round = await db
    .prepare("SELECT id FROM review_rounds WHERE id=? AND event_id=?")
    .bind(input.roundId, eventId)
    .first();
  if (!round)
    throw new HttpError(
      400,
      "invalid_round",
      "Choose a review round from this event.",
    );
  const pool = await db
    .prepare(
      "SELECT COUNT(*) count FROM review_round_reviewers WHERE round_id=?",
    )
    .bind(input.roundId)
    .first<{ count: number }>();
  if (!pool?.count)
    throw new HttpError(
      409,
      "reviewer_pool_required",
      "Save an eligible reviewer pool for this round before routing proposals to it.",
    );
  const excluded = [...new Set(input.excludedReviewerIds)];
  if (excluded.length) {
    const valid = await db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) count FROM event_members
         WHERE event_id=? AND role='reviewer' AND user_id IN (${excluded.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...excluded)
      .first<{ count: number }>();
    if (Number(valid?.count) !== excluded.length)
      throw new HttpError(
        400,
        "invalid_exclusions",
        "Every excluded reviewer must belong to this event.",
      );
  }
  if (input.ownerUserId) {
    const owner = await db
      .prepare(
        `SELECT u.id FROM users u LEFT JOIN event_members em ON em.user_id=u.id AND em.event_id=?
         LEFT JOIN events e ON e.id=? LEFT JOIN organization_members om ON om.user_id=u.id AND om.organization_id=e.organization_id
         WHERE u.id=? AND (em.role IN ('owner','admin') OR om.role IN ('owner','admin','member'))`,
      )
      .bind(eventId, eventId, input.ownerUserId)
      .first();
    if (!owner)
      throw new HttpError(
        400,
        "invalid_owner",
        "Choose an owner from this workspace.",
      );
  }
  if (input.tagIds.length) {
    const tags = await db
      .prepare(
        `SELECT COUNT(*) count FROM submission_tags WHERE event_id=? AND id IN (${input.tagIds.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...input.tagIds)
      .first<{ count: number }>();
    if (Number(tags?.count) !== new Set(input.tagIds).size)
      throw new HttpError(
        400,
        "invalid_tags",
        "Every action tag must belong to this event.",
      );
  }
  for (const group of input.groups)
    for (const condition of group.conditions) {
      if (
        !["is_set", "is_not_set"].includes(condition.operator) &&
        (condition.value === undefined ||
          condition.value === null ||
          (typeof condition.value === "string" && !condition.value.trim()))
      )
        throw new HttpError(
          400,
          "condition_value_required",
          "Every comparison condition needs a value.",
        );
      if (condition.source === "custom_field") {
        if (!condition.fieldId)
          throw new HttpError(
            400,
            "field_required",
            "Choose a custom CFP field for this condition.",
          );
        const field = await db
          .prepare(
            `SELECT ff.id FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id
             WHERE ff.id=? AND f.event_id=?`,
          )
          .bind(condition.fieldId, eventId)
          .first();
        if (!field)
          throw new HttpError(
            400,
            "invalid_field",
            "Choose a custom field from this event.",
          );
      } else if (condition.fieldId)
        throw new HttpError(
          400,
          "unexpected_field",
          "Only custom-field conditions may reference a field ID.",
        );
      if (
        ["form", "track", "tag"].includes(condition.source) &&
        !["is_set", "is_not_set"].includes(condition.operator)
      ) {
        const values = (
          Array.isArray(condition.value) ? condition.value : [condition.value]
        ).map(String);
        if (
          !values.length ||
          values.some((value) => !z.string().uuid().safeParse(value).success)
        )
          throw new HttpError(
            400,
            "invalid_condition_value",
            `${condition.source} conditions must use record IDs from this event.`,
          );
        const table =
          condition.source === "form"
            ? "cfp_forms"
            : condition.source === "track"
              ? "tracks"
              : "submission_tags";
        const references = await db
          .prepare(
            `SELECT COUNT(*) count FROM ${table} WHERE event_id=? AND id IN (${values.map(() => "?").join(",")})`,
          )
          .bind(eventId, ...values)
          .first<{ count: number }>();
        if (Number(references?.count) !== new Set(values).size)
          throw new HttpError(
            400,
            "cross_event_condition",
            `Every ${condition.source} condition value must belong to this event.`,
          );
      }
    }
}

async function writeRule(
  db: D1Database,
  args: {
    id: string;
    eventId: string;
    organizationId: string;
    userId: string;
    input: z.infer<typeof ruleSchema>;
    requestId: string;
    action: "created" | "updated";
    before?: unknown;
  },
) {
  const { id, eventId, organizationId, userId, input } = args;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO review_routing_rules
         (id,organization_id,event_id,name,description,priority,enabled,group_operator,round_id,
          reviewers_per_submission,owner_user_id,created_by,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
           priority=excluded.priority,enabled=excluded.enabled,group_operator=excluded.group_operator,
           round_id=excluded.round_id,reviewers_per_submission=excluded.reviewers_per_submission,
           owner_user_id=excluded.owner_user_id,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(
        id,
        organizationId,
        eventId,
        input.name,
        input.description ?? null,
        input.priority,
        input.enabled ? 1 : 0,
        input.groupOperator,
        input.roundId,
        input.reviewersPerSubmission,
        input.ownerUserId ?? null,
        userId,
        userId,
      ),
    db
      .prepare("DELETE FROM review_routing_condition_groups WHERE rule_id=?")
      .bind(id),
    db
      .prepare("DELETE FROM review_routing_excluded_reviewers WHERE rule_id=?")
      .bind(id),
    db.prepare("DELETE FROM review_routing_rule_tags WHERE rule_id=?").bind(id),
  ];
  input.groups.forEach((group, groupIndex) => {
    const groupId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO review_routing_condition_groups
           (id,rule_id,position,condition_operator) VALUES(?,?,?,?)`,
        )
        .bind(groupId, id, groupIndex, group.conditionOperator),
    );
    group.conditions.forEach((condition, conditionIndex) =>
      statements.push(
        db
          .prepare(
            `INSERT INTO review_routing_conditions
             (id,group_id,source,field_id,operator,value_json,position) VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            groupId,
            condition.source,
            condition.fieldId ?? null,
            condition.operator,
            condition.value === undefined
              ? null
              : JSON.stringify(condition.value),
            conditionIndex,
          ),
      ),
    );
  });
  for (const reviewerId of new Set(input.excludedReviewerIds))
    statements.push(
      db
        .prepare(
          "INSERT INTO review_routing_excluded_reviewers(rule_id,reviewer_user_id) VALUES(?,?)",
        )
        .bind(id, reviewerId),
    );
  for (const tagId of new Set(input.tagIds))
    statements.push(
      db
        .prepare(
          "INSERT INTO review_routing_rule_tags(rule_id,tag_id) VALUES(?,?)",
        )
        .bind(id, tagId),
    );
  statements.push(
    auditStatement(db, {
      organizationId,
      eventId,
      actorUserId: userId,
      action: `review_routing_rule.${args.action}`,
      entityType: "review_routing_rule",
      entityId: id,
      before: args.before,
      after: input,
      requestId: args.requestId,
    }),
  );
  await db.batch(statements);
}

export default router;
