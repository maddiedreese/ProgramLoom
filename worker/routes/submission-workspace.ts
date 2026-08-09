import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { strToU8, zipSync } from "fflate";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, requireEventRole } from "../lib/authz";

const router = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
const organizerRoles = ["owner", "admin"] as const;
const identifier = z.string().trim().min(1).max(100);
const direction = z.enum(["asc", "desc"]);
const emptyFilters = {
  formIds: [],
  statuses: [],
  trackIds: [],
  formats: [],
  reviewerIds: [],
  roundIds: [],
  reviewCompletion: "any" as const,
  decisionStates: [],
  notificationStates: [],
  tagIds: [],
  custom: [],
};

const filterSchema = z.object({
  formIds: z.array(identifier).max(100).default([]),
  statuses: z.array(identifier).max(20).default([]),
  trackIds: z.array(identifier).max(100).default([]),
  formats: z.array(z.string().trim().max(100)).max(100).default([]),
  submitter: z.string().trim().max(160).optional(),
  reviewerIds: z.array(identifier).max(100).default([]),
  roundIds: z.array(identifier).max(100).default([]),
  reviewCompletion: z
    .enum(["any", "complete", "incomplete", "unassigned"])
    .default("any"),
  scoreMin: z.number().finite().optional(),
  scoreMax: z.number().finite().optional(),
  decisionStates: z.array(identifier).max(20).default([]),
  notificationStates: z.array(identifier).max(20).default([]),
  tagIds: z.array(identifier).max(100).default([]),
  submittedFrom: z.string().datetime().optional(),
  submittedTo: z.string().datetime().optional(),
  custom: z
    .array(
      z.object({
        fieldId: identifier,
        operator: z.enum(["equals", "contains", "not_empty", "empty"]),
        value: z
          .union([z.string().max(500), z.number(), z.boolean()])
          .optional(),
      }),
    )
    .max(30)
    .default([]),
});

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  filters: filterSchema.default(emptyFilters),
  sort: z
    .object({ field: identifier, direction })
    .default({ field: "submittedAt", direction: "desc" }),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(10).max(100).default(50),
});

const columnSchema = z.object({
  id: identifier,
  visible: z.boolean(),
  width: z.number().int().min(80).max(800),
});
const viewConfigSchema = z.object({
  columns: z.array(columnSchema).min(1).max(100),
  filters: filterSchema.default(emptyFilters),
  sort: z.object({ field: identifier, direction }),
  pageSize: z.number().int().min(10).max(100).default(50),
});
const createViewSchema = z.object({
  name: z.string().trim().min(1).max(100),
  visibility: z.enum(["personal", "organization"]).default("personal"),
  config: viewConfigSchema,
});
const updateViewSchema = createViewSchema.partial();
const selectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("selected"),
    ids: z.array(identifier).min(1).max(2000),
  }),
  z.object({
    mode: z.literal("filtered"),
    query: querySchema.omit({ page: true, pageSize: true }),
  }),
]);
const bulkActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign_reviewers"),
    roundId: identifier,
    reviewerUserIds: z.array(identifier).min(1).max(50),
  }),
  z
    .object({
      type: z.literal("tags"),
      addTagIds: z.array(identifier).max(100).default([]),
      removeTagIds: z.array(identifier).max(100).default([]),
    })
    .superRefine((value, context) => {
      if (!value.addTagIds.length && !value.removeTagIds.length)
        context.addIssue({
          code: "custom",
          message: "Choose at least one tag change.",
        });
      if (value.addTagIds.some((id) => value.removeTagIds.includes(id)))
        context.addIssue({
          code: "custom",
          message: "A tag cannot be added and removed in the same action.",
        });
    }),
  z.object({
    type: z.literal("decision"),
    state: z.enum([
      "none",
      "acceptance_staged",
      "waitlist_staged",
      "rejection_staged",
    ]),
  }),
  z.object({
    type: z.literal("status"),
    status: z.enum(["pending", "withdrawn"]),
  }),
  z.object({ type: z.literal("communication"), category: identifier }),
  z.object({
    type: z.literal("export"),
    format: z.enum(["csv", "xlsx"]),
    columns: z.array(identifier).min(1).max(100),
  }),
]);
const bulkPreviewSchema = z.object({
  selection: selectionSchema,
  action: bulkActionSchema,
});

type QueryInput = z.infer<typeof querySchema>;
type QueryParts = { where: string; bindings: unknown[]; order: string };

router.get("/events/:eventId/meta", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const [forms, fields, tracks, reviewers, rounds, tags, formats] =
    await Promise.all([
      db
        .prepare(
          "SELECT id,name FROM cfp_forms WHERE event_id=? ORDER BY name LIMIT 250",
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT ff.id,ff.form_id formId,ff.field_key fieldKey,ff.label,ff.field_type fieldType,
      ff.searchable,ff.position,f.name formName FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id
      WHERE f.event_id=? ORDER BY f.name,ff.position LIMIT 1000`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT id,name,color FROM tracks WHERE event_id=? ORDER BY position,name LIMIT 250",
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          `SELECT DISTINCT u.id,u.name FROM users u JOIN review_assignments ra ON ra.reviewer_user_id=u.id
      JOIN review_rounds rr ON rr.id=ra.round_id WHERE rr.event_id=? ORDER BY u.name LIMIT 500`,
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT id,name,status,position FROM review_rounds WHERE event_id=? ORDER BY position LIMIT 100",
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT id,name,color FROM submission_tags WHERE event_id=? ORDER BY name LIMIT 500",
        )
        .bind(eventId)
        .all(),
      db
        .prepare(
          "SELECT DISTINCT format FROM submissions WHERE event_id=? AND format IS NOT NULL ORDER BY format LIMIT 250",
        )
        .bind(eventId)
        .all<{ format: string }>(),
    ]);
  return context.json({
    forms: forms.results,
    fields: fields.results.map((field: Record<string, unknown>) => ({
      ...field,
      searchable: Boolean(field.searchable),
    })),
    tracks: tracks.results,
    reviewers: reviewers.results,
    rounds: rounds.results,
    tags: tags.results,
    formats: formats.results.map((row) => row.format),
    builtInColumns: [
      "title",
      "formName",
      "status",
      "tracks",
      "format",
      "submitterName",
      "submitterOrganization",
      "reviewProgress",
      "averageScore",
      "decisionState",
      "notificationState",
      "tags",
      "submittedAt",
      "updatedAt",
    ],
  });
});

router.post(
  "/events/:eventId/query",
  zValidator("json", querySchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    await requireEventRole(context, eventId, [...organizerRoles]);
    const db = database(context.env);
    const input = context.req.valid("json");
    const parts = await buildQuery(db, eventId, input);
    const from = `FROM submissions s JOIN cfp_forms f ON f.id=s.form_id
    LEFT JOIN submission_people primary_person ON primary_person.submission_id=s.id AND primary_person.role='primary'`;
    const count = await db
      .prepare(`SELECT COUNT(*) count ${from} WHERE ${parts.where}`)
      .bind(...parts.bindings)
      .first<{ count: number }>();
    const bindings = [
      ...parts.bindings,
      input.pageSize,
      (input.page - 1) * input.pageSize,
    ];
    const rows = await db
      .prepare(
        `SELECT s.id,s.form_id formId,f.name formName,s.title,s.abstract,s.format,s.status,
      s.decision_state decisionState,s.answers_json answersJson,s.submitted_at submittedAt,s.updated_at updatedAt,
      primary_person.name submitterName,primary_person.email submitterEmail,primary_person.organization submitterOrganization,
      (SELECT COUNT(*) FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.recused_at IS NULL) reviewCount,
      (SELECT COUNT(*) FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.recused_at IS NULL AND ra.completed_at IS NOT NULL) completedReviewCount,
      (SELECT ROUND(AVG(rv.weighted_score),2) FROM reviews rv JOIN review_assignments ra ON ra.id=rv.assignment_id
        WHERE ra.submission_id=s.id AND rv.submitted_at IS NOT NULL) averageScore,
      COALESCE((SELECT GROUP_CONCAT(t.name,' · ') FROM submission_tracks st JOIN tracks t ON t.id=st.track_id WHERE st.submission_id=s.id),'') tracks,
      COALESCE((SELECT GROUP_CONCAT(t.id,',') FROM submission_tracks st JOIN tracks t ON t.id=st.track_id WHERE st.submission_id=s.id),'') trackIds,
      COALESCE((SELECT GROUP_CONCAT(tag.name,' · ') FROM submission_tag_assignments sta JOIN submission_tags tag ON tag.id=sta.tag_id WHERE sta.submission_id=s.id),'') tags,
      COALESCE((SELECT GROUP_CONCAT(tag.id,',') FROM submission_tag_assignments sta JOIN submission_tags tag ON tag.id=sta.tag_id WHERE sta.submission_id=s.id),'') tagIds,
      COALESCE((SELECT cm.status FROM communication_messages cm WHERE cm.id=s.decision_message_id),'not_prepared') notificationState
    ${from} WHERE ${parts.where} ORDER BY ${parts.order},s.id ${input.sort.direction.toUpperCase()}
    LIMIT ?${bindings.length - 1} OFFSET ?${bindings.length}`,
      )
      .bind(...bindings)
      .all<Record<string, unknown>>();
    return context.json({
      submissions: rows.results.map((row) => ({
        ...row,
        answers: JSON.parse(String(row.answersJson ?? "{}")),
        answersJson: undefined,
        trackIds: String(row.trackIds || "")
          .split(",")
          .filter(Boolean),
        tagIds: String(row.tagIds || "")
          .split(",")
          .filter(Boolean),
      })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total: count?.count ?? 0,
      },
    });
  },
);

router.get("/events/:eventId/views", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const views = await db
    .prepare(
      `SELECT sv.id,sv.owner_user_id ownerUserId,u.name ownerName,sv.name,sv.visibility,
      sv.config_json configJson,sv.version,sv.updated_at updatedAt,
      CASE WHEN vd.view_id=sv.id THEN 1 ELSE 0 END isDefault
    FROM submission_saved_views sv JOIN users u ON u.id=sv.owner_user_id
    LEFT JOIN submission_view_defaults vd ON vd.event_id=sv.event_id AND vd.user_id=?
    WHERE sv.event_id=? AND (sv.owner_user_id=? OR sv.visibility='organization')
    ORDER BY isDefault DESC,sv.visibility DESC,sv.name LIMIT 500`,
    )
    .bind(access.user.id, eventId, access.user.id)
    .all<Record<string, unknown>>();
  return context.json({
    views: views.results.map((view) => ({
      ...view,
      config: JSON.parse(String(view.configJson)),
      configJson: undefined,
      isDefault: Boolean(view.isDefault),
      canEdit: view.ownerUserId === access.user.id || access.role === "owner",
    })),
  });
});

router.post(
  "/events/:eventId/views",
  zValidator("json", createViewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const id = crypto.randomUUID();
    const db = database(context.env);
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO submission_saved_views
        (id,organization_id,event_id,owner_user_id,name,visibility,config_json) VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            access.organizationId,
            eventId,
            access.user.id,
            input.name,
            input.visibility,
            JSON.stringify(input.config),
          ),
        auditStatement(db, {
          organizationId: access.organizationId,
          eventId,
          actorUserId: access.user.id,
          action: "submission_view.created",
          entityType: "submission_view",
          entityId: id,
          after: input,
          requestId: context.get("requestId"),
        }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new HttpError(
          409,
          "view_name_exists",
          "You already have a view with this name.",
        );
      throw error;
    }
    return context.json(
      {
        view: {
          id,
          ownerUserId: access.user.id,
          ...input,
          version: 1,
          isDefault: false,
          canEdit: true,
        },
      },
      201,
    );
  },
);

router.patch(
  "/events/:eventId/views/:viewId",
  zValidator("json", updateViewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const viewId = context.req.param("viewId");
    const current = await editableView(
      db,
      eventId,
      viewId,
      access.user.id,
      access.role,
    );
    const input = context.req.valid("json");
    const next = {
      name: input.name ?? current.name,
      visibility: input.visibility ?? current.visibility,
      config: input.config ?? JSON.parse(current.configJson),
    };
    await mutateViewName(() =>
      db.batch([
        db
          .prepare(
            `UPDATE submission_saved_views SET name=?,visibility=?,config_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?`,
          )
          .bind(
            next.name,
            next.visibility,
            JSON.stringify(next.config),
            viewId,
            eventId,
          ),
        auditStatement(db, {
          organizationId: access.organizationId,
          eventId,
          actorUserId: access.user.id,
          action: "submission_view.updated",
          entityType: "submission_view",
          entityId: viewId,
          before: {
            name: current.name,
            visibility: current.visibility,
            config: JSON.parse(current.configJson),
          },
          after: next,
          requestId: context.get("requestId"),
        }),
      ]),
    );
    return context.json({ ok: true });
  },
);

router.post("/events/:eventId/views/:viewId/duplicate", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const source = await visibleView(
    db,
    eventId,
    context.req.param("viewId"),
    access.user.id,
  );
  const body: { name?: string } = await context.req
    .json<{ name?: string }>()
    .catch(() => ({}) as { name?: string });
  const name = (body.name?.trim() || `${source.name} copy`).slice(0, 100);
  const id = crypto.randomUUID();
  await mutateViewName(() =>
    db.batch([
      db
        .prepare(
          `INSERT INTO submission_saved_views(id,organization_id,event_id,owner_user_id,name,visibility,config_json)
      VALUES(?,?,?,?,?,'personal',?)`,
        )
        .bind(
          id,
          access.organizationId,
          eventId,
          access.user.id,
          name,
          source.configJson,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "submission_view.duplicated",
        entityType: "submission_view",
        entityId: id,
        after: { sourceViewId: source.id, name },
        requestId: context.get("requestId"),
      }),
    ]),
  );
  return context.json({ id }, 201);
});

router.put("/events/:eventId/views/:viewId/default", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const view = await visibleView(
    db,
    eventId,
    context.req.param("viewId"),
    access.user.id,
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO submission_view_defaults(event_id,user_id,view_id) VALUES(?,?,?)
      ON CONFLICT(event_id,user_id) DO UPDATE SET view_id=excluded.view_id,updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(eventId, access.user.id, view.id),
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "submission_view.default_changed",
      entityType: "submission_view",
      entityId: view.id,
      after: { default: true },
      requestId: context.get("requestId"),
    }),
  ]);
  return context.json({ ok: true });
});

router.delete("/events/:eventId/views/:viewId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const viewId = context.req.param("viewId");
  const current = await editableView(
    db,
    eventId,
    viewId,
    access.user.id,
    access.role,
  );
  await db.batch([
    db
      .prepare("DELETE FROM submission_saved_views WHERE id=? AND event_id=?")
      .bind(viewId, eventId),
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "submission_view.deleted",
      entityType: "submission_view",
      entityId: viewId,
      before: current,
      requestId: context.get("requestId"),
    }),
  ]);
  return context.body(null, 204);
});

router.post("/events/:eventId/tags", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const input = z
    .object({
      name: z.string().trim().min(1).max(60),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#68756b"),
    })
    .parse(await context.req.json());
  const db = database(context.env);
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO submission_tags(id,organization_id,event_id,name,color,created_by) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          id,
          access.organizationId,
          eventId,
          input.name,
          input.color,
          access.user.id,
        ),
      auditStatement(db, {
        organizationId: access.organizationId,
        eventId,
        actorUserId: access.user.id,
        action: "submission_tag.created",
        entityType: "submission_tag",
        entityId: id,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new HttpError(
        409,
        "tag_exists",
        "A tag with this name already exists.",
      );
    throw error;
  }
  return context.json({ tag: { id, ...input } }, 201);
});

router.post(
  "/events/:eventId/bulk/preview",
  zValidator("json", bulkPreviewSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const resolved = await resolveSelection(db, eventId, input.selection, 10);
    if (!resolved.count)
      throw new HttpError(
        409,
        "empty_selection",
        "No submissions currently match this selection.",
      );
    await validateBulkAction(db, eventId, input.action);
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await db
      .prepare(
        `INSERT INTO submission_bulk_previews
    (id,organization_id,event_id,requested_by,selection_json,action_json,matched_count,sample_json,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        access.organizationId,
        eventId,
        access.user.id,
        JSON.stringify(input.selection),
        JSON.stringify(input.action),
        resolved.count,
        JSON.stringify(resolved.sample),
        expiresAt,
      )
      .run();
    return context.json(
      {
        preview: {
          id,
          count: resolved.count,
          sample: resolved.sample,
          action: input.action,
          expiresAt,
        },
      },
      201,
    );
  },
);

router.post("/events/:eventId/bulk/:previewId/execute", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const body = z
    .object({ confirmed: z.literal(true) })
    .parse(await context.req.json());
  void body;
  const db = database(context.env);
  const preview = await db
    .prepare(
      `SELECT id,selection_json selectionJson,action_json actionJson,matched_count matchedCount,sample_json sampleJson
    FROM submission_bulk_previews WHERE id=? AND event_id=? AND requested_by=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
    )
    .bind(context.req.param("previewId"), eventId, access.user.id)
    .first<{
      id: string;
      selectionJson: string;
      actionJson: string;
      matchedCount: number;
      sampleJson: string;
    }>();
  if (!preview)
    throw new HttpError(
      404,
      "preview_not_found",
      "This bulk preview expired or was already used.",
    );
  const selection = selectionSchema.parse(JSON.parse(preview.selectionJson));
  const action = bulkActionSchema.parse(JSON.parse(preview.actionJson));
  await validateBulkAction(db, eventId, action);
  const maximum = action.type === "export" ? 10000 : 2000;
  const resolved = await resolveSelection(
    db,
    eventId,
    selection,
    10,
    true,
    maximum,
  );
  if (resolved.count !== preview.matchedCount)
    throw new HttpError(
      409,
      "preview_stale",
      "The filtered result changed. Preview the operation again.",
    );
  if (resolved.count > maximum)
    throw new HttpError(
      409,
      "bulk_too_large",
      `This operation currently supports up to ${maximum.toLocaleString()} records at once.`,
    );
  if (action.type === "communication")
    return context.json({
      requiresWorkflow: true,
      url: `/app/events/${eventId}/communications?submissionBulk=${preview.id}&category=${encodeURIComponent(action.category)}`,
    });
  if (action.type === "export")
    return context.json({
      requiresDownload: true,
      url: `/api/submission-workspace/events/${eventId}/bulk/${preview.id}/export`,
    });
  await validateBulkTransitions(db, eventId, resolved.ids, action);
  const before = {
    selection,
    matchedCount: preview.matchedCount,
    sample: JSON.parse(preview.sampleJson),
  };
  const statements = await bulkStatements(
    db,
    eventId,
    resolved.ids,
    action,
    access.user.id,
    access.organizationId,
    context.get("requestId"),
  );
  for (let offset = 0; offset < statements.length; offset += 80)
    await db.batch(statements.slice(offset, offset + 80));
  await db.batch([
    db
      .prepare(
        "UPDATE submission_bulk_previews SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL",
      )
      .bind(preview.id),
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: `submission_bulk.${action.type}`,
      entityType: "submission_bulk",
      entityId: preview.id,
      before,
      after: { action, changedCount: resolved.count },
      requestId: context.get("requestId"),
    }),
  ]);
  return context.json({ ok: true, changedCount: resolved.count });
});

router.get(
  "/events/:eventId/bulk/:previewId/submission-ids",
  async (context) => {
    const eventId = context.req.param("eventId");
    const access = await requireEventRole(context, eventId, [
      ...organizerRoles,
    ]);
    const db = database(context.env);
    const preview = await db
      .prepare(
        `SELECT selection_json selectionJson,action_json actionJson,matched_count matchedCount
       FROM submission_bulk_previews WHERE id=? AND event_id=? AND requested_by=?
         AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
      )
      .bind(context.req.param("previewId"), eventId, access.user.id)
      .first<{
        selectionJson: string;
        actionJson: string;
        matchedCount: number;
      }>();
    if (!preview)
      throw new HttpError(
        404,
        "preview_not_found",
        "This communication preview expired or was already used.",
      );
    const action = bulkActionSchema.parse(JSON.parse(preview.actionJson));
    if (action.type !== "communication")
      throw new HttpError(
        400,
        "not_communication_preview",
        "This preview is not a communication workflow.",
      );
    const selection = selectionSchema.parse(JSON.parse(preview.selectionJson));
    const resolved = await resolveSelection(
      db,
      eventId,
      selection,
      10,
      true,
      2000,
    );
    if (resolved.count !== preview.matchedCount)
      throw new HttpError(
        409,
        "preview_stale",
        "The filtered result changed. Preview the communication again.",
      );
    if (resolved.count > 2000)
      throw new HttpError(
        409,
        "bulk_too_large",
        "This communication workflow supports up to 2,000 proposals at once.",
      );
    return context.json({
      submissionIds: resolved.ids,
      count: resolved.count,
      category: action.category,
    });
  },
);

router.get("/events/:eventId/bulk/:previewId/export", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const preview = await db
    .prepare(
      `SELECT id,selection_json selectionJson,action_json actionJson,matched_count matchedCount
       FROM submission_bulk_previews WHERE id=? AND event_id=? AND requested_by=?
         AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
    )
    .bind(context.req.param("previewId"), eventId, access.user.id)
    .first<{
      id: string;
      selectionJson: string;
      actionJson: string;
      matchedCount: number;
    }>();
  if (!preview)
    throw new HttpError(
      404,
      "preview_not_found",
      "This export preview expired or was already used.",
    );
  const selection = selectionSchema.parse(JSON.parse(preview.selectionJson));
  const action = bulkActionSchema.parse(JSON.parse(preview.actionJson));
  if (action.type !== "export")
    throw new HttpError(
      400,
      "not_export_preview",
      "This preview is not an export.",
    );
  await validateBulkAction(db, eventId, action);
  const resolved = await resolveSelection(
    db,
    eventId,
    selection,
    10,
    true,
    10000,
  );
  if (resolved.count !== preview.matchedCount)
    throw new HttpError(
      409,
      "preview_stale",
      "The filtered result changed. Preview the export again.",
    );
  if (resolved.count > 10000)
    throw new HttpError(
      409,
      "export_too_large",
      "Export up to 10,000 submissions at a time.",
    );
  const exportRows = await loadExportRows(
    db,
    eventId,
    resolved.ids,
    action.columns,
  );
  const headers = action.columns.map((column) =>
    exportColumnLabel(column, exportRows.fields),
  );
  const values = exportRows.rows.map((row) =>
    action.columns.map((column) => exportCell(row, column, exportRows.fields)),
  );
  const bytes =
    action.format === "csv"
      ? strToU8(toCsv([headers, ...values]))
      : toXlsx(headers, values);
  await db.batch([
    db
      .prepare(
        "UPDATE submission_bulk_previews SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL",
      )
      .bind(preview.id),
    auditStatement(db, {
      organizationId: access.organizationId,
      eventId,
      actorUserId: access.user.id,
      action: "submission_bulk.exported",
      entityType: "submission_bulk",
      entityId: preview.id,
      before: { matchedCount: preview.matchedCount },
      after: {
        format: action.format,
        columns: action.columns,
        rowCount: values.length,
      },
      requestId: context.get("requestId"),
    }),
  ]);
  return new Response(bytes, {
    headers: {
      "content-type":
        action.format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="programloom-submissions.${action.format}"`,
      "cache-control": "private, no-store",
    },
  });
});

async function resolveSelection(
  db: D1Database,
  eventId: string,
  selection: z.infer<typeof selectionSchema>,
  sampleLimit: number,
  includeIds = false,
  maxIds = 2000,
): Promise<{
  count: number;
  sample: Array<{ id: string; title: string }>;
  ids: string[];
}> {
  if (selection.mode === "selected") {
    const ids = [...new Set(selection.ids)];
    const rows: Array<{ id: string; title: string }> = [];
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      const result = await db
        .prepare(
          `SELECT id,title FROM submissions WHERE event_id=? AND id IN (${chunk.map(() => "?").join(",")}) ORDER BY title,id`,
        )
        .bind(eventId, ...chunk)
        .all<{ id: string; title: string }>();
      rows.push(...result.results);
    }
    if (rows.length !== ids.length)
      throw new HttpError(
        409,
        "selection_changed",
        "One or more selected submissions are no longer available.",
      );
    return {
      count: rows.length,
      sample: rows.slice(0, sampleLimit),
      ids: includeIds ? rows.map((row) => row.id) : [],
    };
  }
  const input = querySchema.parse({
    ...selection.query,
    page: 1,
    pageSize: 10,
  });
  const parts = await buildQuery(db, eventId, input);
  const count = await db
    .prepare(
      `SELECT COUNT(*) count FROM submissions s JOIN cfp_forms f ON f.id=s.form_id
    LEFT JOIN submission_people primary_person ON primary_person.submission_id=s.id AND primary_person.role='primary'
    WHERE ${parts.where}`,
    )
    .bind(...parts.bindings)
    .first<{ count: number }>();
  const limit = includeIds ? maxIds : sampleLimit;
  const bindings = [...parts.bindings, limit];
  const rows = await db
    .prepare(
      `SELECT s.id,s.title FROM submissions s JOIN cfp_forms f ON f.id=s.form_id
    LEFT JOIN submission_people primary_person ON primary_person.submission_id=s.id AND primary_person.role='primary'
    WHERE ${parts.where} ORDER BY ${parts.order},s.id ${input.sort.direction.toUpperCase()} LIMIT ?${bindings.length}`,
    )
    .bind(...bindings)
    .all<{ id: string; title: string }>();
  return {
    count: count?.count ?? 0,
    sample: rows.results.slice(0, sampleLimit),
    ids: includeIds ? rows.results.map((row) => row.id) : [],
  };
}

async function validateBulkAction(
  db: D1Database,
  eventId: string,
  action: z.infer<typeof bulkActionSchema>,
) {
  if (action.type === "assign_reviewers") {
    const round = await db
      .prepare("SELECT 1 ok FROM review_rounds WHERE id=? AND event_id=?")
      .bind(action.roundId, eventId)
      .first();
    if (!round)
      throw new HttpError(
        400,
        "invalid_round",
        "Choose a review round from this event.",
      );
    const reviewers = await db
      .prepare(
        `SELECT COUNT(DISTINCT u.id) count FROM users u JOIN event_members em ON em.user_id=u.id
      WHERE em.event_id=? AND em.role='reviewer' AND u.id IN (${action.reviewerUserIds.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...action.reviewerUserIds)
      .first<{ count: number }>();
    if ((reviewers?.count ?? 0) !== new Set(action.reviewerUserIds).size)
      throw new HttpError(
        400,
        "invalid_reviewers",
        "Every selected reviewer must belong to this event.",
      );
  }
  if (action.type === "tags") {
    const tagIds = [...new Set([...action.addTagIds, ...action.removeTagIds])];
    if (tagIds.length) {
      const tags = await db
        .prepare(
          `SELECT COUNT(*) count FROM submission_tags WHERE event_id=? AND id IN (${tagIds.map(() => "?").join(",")})`,
        )
        .bind(eventId, ...tagIds)
        .first<{ count: number }>();
      if ((tags?.count ?? 0) !== tagIds.length)
        throw new HttpError(
          400,
          "invalid_tags",
          "Every selected tag must belong to this event.",
        );
    }
  }
  if (
    action.type === "communication" &&
    ![
      "submission_confirmation",
      "draft_reminder",
      "deadline_reminder",
      "decision_acceptance",
      "decision_waitlist",
      "decision_rejection",
    ].includes(action.category)
  )
    throw new HttpError(
      400,
      "invalid_category",
      "Choose a submission communication category.",
    );
  if (action.type === "export") {
    const builtIn = new Set([
      "title",
      "formName",
      "status",
      "tracks",
      "format",
      "submitterName",
      "submitterOrganization",
      "reviewProgress",
      "averageScore",
      "decisionState",
      "notificationState",
      "tags",
      "submittedAt",
      "updatedAt",
    ]);
    const customIds = action.columns
      .filter((column) => column.startsWith("field:"))
      .map((column) => column.slice(6));
    if (
      action.columns.some(
        (column) => !builtIn.has(column) && !column.startsWith("field:"),
      ) ||
      customIds.some((id) => !id)
    )
      throw new HttpError(
        400,
        "invalid_export_columns",
        "One or more export columns are not available.",
      );
    if (customIds.length) {
      const fields = await db
        .prepare(
          `SELECT COUNT(DISTINCT ff.id) count FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id
           WHERE f.event_id=? AND ff.id IN (${customIds.map(() => "?").join(",")})`,
        )
        .bind(eventId, ...customIds)
        .first<{ count: number }>();
      if ((fields?.count ?? 0) !== new Set(customIds).size)
        throw new HttpError(
          400,
          "invalid_export_columns",
          "One or more custom export columns are not available for this event.",
        );
    }
  }
}

async function bulkStatements(
  db: D1Database,
  eventId: string,
  ids: string[],
  action: z.infer<typeof bulkActionSchema>,
  actorUserId: string,
  organizationId: string,
  requestId: string,
) {
  const statements: D1PreparedStatement[] = [];
  const beforeById = new Map<
    string,
    { status: string; decisionState: string; tagIds: string[] }
  >();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const rows = await db
      .prepare(
        `SELECT s.id,s.status,s.decision_state decisionState,
         COALESCE((SELECT json_group_array(sta.tag_id) FROM submission_tag_assignments sta WHERE sta.submission_id=s.id),'[]') tagIdsJson
         FROM submissions s WHERE s.event_id=? AND s.id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...chunk)
      .all<{
        id: string;
        status: string;
        decisionState: string;
        tagIdsJson: string;
      }>();
    for (const row of rows.results)
      beforeById.set(row.id, {
        status: row.status,
        decisionState: row.decisionState,
        tagIds: JSON.parse(row.tagIdsJson) as string[],
      });
  }
  if (action.type === "assign_reviewers") {
    for (let offset = 0; offset < ids.length; offset += 70) {
      const chunk = ids.slice(offset, offset + 70);
      const conflicts = await db
        .prepare(
          `SELECT COUNT(*) count FROM submissions s JOIN submission_people p ON p.submission_id=s.id
      JOIN users u ON LOWER(u.email)=LOWER(p.email) WHERE s.event_id=? AND s.id IN (${chunk.map(() => "?").join(",")})
      AND u.id IN (${action.reviewerUserIds.map(() => "?").join(",")})`,
        )
        .bind(eventId, ...chunk, ...action.reviewerUserIds)
        .first<{ count: number }>();
      if ((conflicts?.count ?? 0) > 0)
        throw new HttpError(
          409,
          "reviewer_conflict",
          "The selection contains a reviewer who is also a listed speaker. Resolve conflicts before assigning.",
        );
      for (const reviewerId of action.reviewerUserIds)
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO review_assignments(id,round_id,submission_id,reviewer_user_id)
        SELECT lower(hex(randomblob(16))),?,s.id,? FROM submissions s WHERE s.event_id=? AND s.id IN (${chunk.map(() => "?").join(",")})`,
            )
            .bind(action.roundId, reviewerId, eventId, ...chunk),
        );
    }
  } else if (action.type === "tags") {
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      for (const tagId of action.addTagIds)
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO submission_tag_assignments(submission_id,tag_id,assigned_by)
      SELECT s.id,?,? FROM submissions s WHERE s.event_id=? AND s.id IN (${chunk.map(() => "?").join(",")})`,
            )
            .bind(tagId, actorUserId, eventId, ...chunk),
        );
      for (const tagId of action.removeTagIds)
        statements.push(
          db
            .prepare(
              `DELETE FROM submission_tag_assignments WHERE tag_id=? AND submission_id IN
        (SELECT id FROM submissions WHERE event_id=? AND id IN (${chunk.map(() => "?").join(",")}))`,
            )
            .bind(tagId, eventId, ...chunk),
        );
    }
  } else if (action.type === "decision") {
    const status =
      action.state === "acceptance_staged"
        ? "accepted_queue"
        : action.state === "rejection_staged"
          ? "decline_queue"
          : "pending";
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      statements.push(
        db
          .prepare(
            `INSERT INTO submission_decision_history
              (id,organization_id,event_id,submission_id,from_state,to_state,changed_by,reason)
             SELECT lower(hex(randomblob(16))),?,?,s.id,s.decision_state,?,?,? FROM submissions s
             WHERE s.event_id=? AND s.id IN (${chunk.map(() => "?").join(",")})`,
          )
          .bind(
            organizationId,
            eventId,
            action.state,
            actorUserId,
            "Organizer bulk action",
            eventId,
            ...chunk,
          ),
      );
      statements.push(
        db
          .prepare(
            `UPDATE submissions SET decision_state=?,status=?,decision_staged_at=?,decision_staged_by=?,decision_message_id=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE event_id=? AND status NOT IN ('accepted','declined','withdrawn') AND id IN (${chunk.map(() => "?").join(",")})`,
          )
          .bind(
            action.state,
            status,
            action.state === "none" ? null : new Date().toISOString(),
            action.state === "none" ? null : actorUserId,
            eventId,
            ...chunk,
          ),
      );
    }
  } else if (action.type === "status") {
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      statements.push(
        db
          .prepare(
            `UPDATE submissions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?
      AND status NOT IN ('accepted','declined') AND id IN (${chunk.map(() => "?").join(",")})`,
          )
          .bind(action.status, eventId, ...chunk),
      );
    }
  }
  for (const id of ids) {
    const before = beforeById.get(id) ?? {
      status: "unknown",
      decisionState: "unknown",
      tagIds: [],
    };
    let after: Record<string, unknown> = { ...before };
    if (action.type === "decision") {
      after = {
        ...before,
        decisionState: action.state,
        status:
          action.state === "acceptance_staged"
            ? "accepted_queue"
            : action.state === "rejection_staged"
              ? "decline_queue"
              : "pending",
      };
    } else if (action.type === "status")
      after = { ...before, status: action.status };
    else if (action.type === "tags")
      after = {
        ...before,
        tagIds: [
          ...new Set([
            ...before.tagIds.filter(
              (tagId) => !action.removeTagIds.includes(tagId),
            ),
            ...action.addTagIds,
          ]),
        ],
      };
    else if (action.type === "assign_reviewers")
      after = {
        ...before,
        reviewerAssignment: {
          roundId: action.roundId,
          reviewerUserIds: action.reviewerUserIds,
        },
      };
    statements.push(
      auditStatement(db, {
        organizationId,
        eventId,
        actorUserId,
        action: `submission.bulk_${action.type}`,
        entityType: "submission",
        entityId: id,
        before,
        after,
        requestId,
      }),
    );
  }
  return statements;
}

async function validateBulkTransitions(
  db: D1Database,
  eventId: string,
  ids: string[],
  action: z.infer<typeof bulkActionSchema>,
) {
  if (action.type !== "decision" && action.type !== "status") return;
  let invalid = 0;
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const condition =
      action.type === "decision"
        ? "status IN ('accepted','declined','withdrawn') OR decision_state=?"
        : "status IN ('accepted','declined') OR status=?";
    const target = action.type === "decision" ? action.state : action.status;
    const row = await db
      .prepare(
        `SELECT COUNT(*) count FROM submissions WHERE event_id=? AND id IN (${chunk.map(() => "?").join(",")}) AND (${condition})`,
      )
      .bind(eventId, ...chunk, target)
      .first<{ count: number }>();
    invalid += row?.count ?? 0;
  }
  if (invalid)
    throw new HttpError(
      409,
      "invalid_bulk_transition",
      `${invalid} selected ${invalid === 1 ? "proposal is" : "proposals are"} already final or already in the requested state. Refine the selection and preview again.`,
    );
}

async function buildQuery(
  db: D1Database,
  eventId: string,
  input: QueryInput,
): Promise<QueryParts> {
  const clauses = ["s.event_id=?1"];
  const bindings: unknown[] = [eventId];
  const bind = (value: unknown) => {
    bindings.push(value);
    return `?${bindings.length}`;
  };
  const inClause = (column: string, values: string[]) => {
    if (values.length)
      clauses.push(`${column} IN (${values.map(bind).join(",")})`);
  };
  inClause("s.form_id", input.filters.formIds);
  inClause("s.status", input.filters.statuses);
  inClause("s.format", input.filters.formats);
  inClause("s.decision_state", input.filters.decisionStates);
  if (input.filters.trackIds.length)
    clauses.push(
      `EXISTS(SELECT 1 FROM submission_tracks st WHERE st.submission_id=s.id AND st.track_id IN (${input.filters.trackIds.map(bind).join(",")}))`,
    );
  if (input.filters.reviewerIds.length)
    clauses.push(
      `EXISTS(SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.reviewer_user_id IN (${input.filters.reviewerIds.map(bind).join(",")}) AND ra.recused_at IS NULL)`,
    );
  if (input.filters.roundIds.length)
    clauses.push(
      `EXISTS(SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.round_id IN (${input.filters.roundIds.map(bind).join(",")}) AND ra.recused_at IS NULL)`,
    );
  if (input.filters.reviewCompletion === "complete")
    clauses.push(
      "EXISTS(SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.completed_at IS NOT NULL AND ra.recused_at IS NULL)",
    );
  if (input.filters.reviewCompletion === "incomplete")
    clauses.push(
      "EXISTS(SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.completed_at IS NULL AND ra.recused_at IS NULL)",
    );
  if (input.filters.reviewCompletion === "unassigned")
    clauses.push(
      "NOT EXISTS(SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.recused_at IS NULL)",
    );
  if (input.filters.scoreMin !== undefined)
    clauses.push(
      `(SELECT AVG(rv.weighted_score) FROM reviews rv JOIN review_assignments ra ON ra.id=rv.assignment_id WHERE ra.submission_id=s.id AND rv.submitted_at IS NOT NULL)>=${bind(input.filters.scoreMin)}`,
    );
  if (input.filters.scoreMax !== undefined)
    clauses.push(
      `(SELECT AVG(rv.weighted_score) FROM reviews rv JOIN review_assignments ra ON ra.id=rv.assignment_id WHERE ra.submission_id=s.id AND rv.submitted_at IS NOT NULL)<=${bind(input.filters.scoreMax)}`,
    );
  if (input.filters.notificationStates.length)
    clauses.push(
      `COALESCE((SELECT cm.status FROM communication_messages cm WHERE cm.id=s.decision_message_id),'not_prepared') IN (${input.filters.notificationStates.map(bind).join(",")})`,
    );
  if (input.filters.tagIds.length)
    clauses.push(
      `EXISTS(SELECT 1 FROM submission_tag_assignments sta WHERE sta.submission_id=s.id AND sta.tag_id IN (${input.filters.tagIds.map(bind).join(",")}))`,
    );
  if (input.filters.submittedFrom)
    clauses.push(`s.submitted_at>=${bind(input.filters.submittedFrom)}`);
  if (input.filters.submittedTo)
    clauses.push(`s.submitted_at<=${bind(input.filters.submittedTo)}`);
  if (input.filters.submitter) {
    const pattern = `%${escapeLike(input.filters.submitter)}%`;
    clauses.push(
      `(primary_person.name LIKE ${bind(pattern)} ESCAPE '\\' OR primary_person.email LIKE ${bind(pattern)} ESCAPE '\\' OR primary_person.organization LIKE ${bind(pattern)} ESCAPE '\\')`,
    );
  }
  if (input.search) {
    const pattern = `%${escapeLike(input.search)}%`;
    clauses.push(
      `(s.title LIKE ${bind(pattern)} ESCAPE '\\' OR s.abstract LIKE ${bind(pattern)} ESCAPE '\\' OR EXISTS(SELECT 1 FROM submission_people person WHERE person.submission_id=s.id AND (person.name LIKE ${bind(pattern)} ESCAPE '\\' OR person.organization LIKE ${bind(pattern)} ESCAPE '\\')) OR EXISTS(SELECT 1 FROM form_fields ff WHERE ff.form_id=s.form_id AND ff.searchable=1 AND CAST(json_extract(s.answers_json,'$."'||REPLACE(ff.field_key,'"','\\"')||'"') AS TEXT) LIKE ${bind(pattern)} ESCAPE '\\'))`,
    );
  }
  if (input.filters.custom.length) {
    const ids = input.filters.custom.map((item) => item.fieldId);
    const fields = await db
      .prepare(
        `SELECT ff.id,ff.field_key fieldKey FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id WHERE f.event_id=? AND ff.id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...ids)
      .all<{ id: string; fieldKey: string }>();
    const map = new Map(
      fields.results.map((field) => [field.id, field.fieldKey]),
    );
    if (map.size !== new Set(ids).size)
      throw new HttpError(
        400,
        "invalid_custom_filter",
        "A custom filter is not available for this event.",
      );
    for (const custom of input.filters.custom) {
      const path = `$."${map.get(custom.fieldId)!.replaceAll('"', '\\"')}"`;
      const expression = `json_extract(s.answers_json,${bind(path)})`;
      if (custom.operator === "empty") clauses.push(`${expression} IS NULL`);
      else if (custom.operator === "not_empty")
        clauses.push(`${expression} IS NOT NULL`);
      else if (custom.operator === "equals")
        clauses.push(
          `CAST(${expression} AS TEXT)=${bind(String(custom.value ?? ""))}`,
        );
      else
        clauses.push(
          `CAST(${expression} AS TEXT) LIKE ${bind(`%${escapeLike(String(custom.value ?? ""))}%`)} ESCAPE '\\'`,
        );
    }
  }
  const sortMap: Record<string, string> = {
    title: "s.title COLLATE NOCASE",
    formName: "f.name COLLATE NOCASE",
    status: "s.status",
    format: "s.format",
    submitterName: "primary_person.name COLLATE NOCASE",
    averageScore:
      "(SELECT AVG(rv.weighted_score) FROM reviews rv JOIN review_assignments ra ON ra.id=rv.assignment_id WHERE ra.submission_id=s.id AND rv.submitted_at IS NOT NULL)",
    reviewProgress:
      "(SELECT COUNT(*) FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.completed_at IS NOT NULL)",
    decisionState: "s.decision_state",
    notificationState:
      "COALESCE((SELECT cm.status FROM communication_messages cm WHERE cm.id=s.decision_message_id),'not_prepared')",
    submittedAt: "COALESCE(s.submitted_at,s.created_at)",
    updatedAt: "s.updated_at",
  };
  return {
    where: clauses.join(" AND "),
    bindings,
    order: sortMap[input.sort.field] ?? sortMap.submittedAt,
  };
}

async function visibleView(
  db: D1Database,
  eventId: string,
  viewId: string,
  userId: string,
) {
  const view = await db
    .prepare(
      `SELECT id,owner_user_id ownerUserId,name,visibility,config_json configJson FROM submission_saved_views
    WHERE id=? AND event_id=? AND (owner_user_id=? OR visibility='organization')`,
    )
    .bind(viewId, eventId, userId)
    .first<{
      id: string;
      ownerUserId: string;
      name: string;
      visibility: string;
      configJson: string;
    }>();
  if (!view)
    throw new HttpError(404, "view_not_found", "Saved view not found.");
  return view;
}
async function editableView(
  db: D1Database,
  eventId: string,
  viewId: string,
  userId: string,
  role: string,
) {
  const view = await visibleView(db, eventId, viewId, userId);
  if (view.ownerUserId !== userId && role !== "owner")
    throw new HttpError(
      403,
      "permission_denied",
      "Only the view owner can change this view.",
    );
  return view;
}

async function mutateViewName(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new HttpError(
        409,
        "view_name_exists",
        "You already have a view with this name.",
      );
    throw error;
  }
}

type ExportField = { id: string; fieldKey: string; label: string };
type ExportRow = Record<string, unknown> & { answers: Record<string, unknown> };

async function loadExportRows(
  db: D1Database,
  eventId: string,
  ids: string[],
  columns: string[],
): Promise<{ fields: Map<string, ExportField>; rows: ExportRow[] }> {
  const customIds = [
    ...new Set(
      columns
        .filter((column) => column.startsWith("field:"))
        .map((column) => column.slice(6)),
    ),
  ];
  const fields = new Map<string, ExportField>();
  if (customIds.length) {
    const result = await db
      .prepare(
        `SELECT ff.id,ff.field_key fieldKey,ff.label FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id
         WHERE f.event_id=? AND ff.id IN (${customIds.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...customIds)
      .all<ExportField>();
    for (const field of result.results) fields.set(field.id, field);
  }

  const rowById = new Map<string, ExportRow>();
  for (let offset = 0; offset < ids.length; offset += 75) {
    const chunk = ids.slice(offset, offset + 75);
    const result = await db
      .prepare(
        `SELECT s.id,s.title,s.status,s.format,s.decision_state decisionState,s.answers_json answersJson,
         s.submitted_at submittedAt,s.updated_at updatedAt,f.name formName,
         primary_person.name submitterName,primary_person.organization submitterOrganization,
         (SELECT COUNT(*) FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.recused_at IS NULL) reviewCount,
         (SELECT COUNT(*) FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.recused_at IS NULL AND ra.completed_at IS NOT NULL) completedReviewCount,
         (SELECT ROUND(AVG(rv.weighted_score),2) FROM reviews rv JOIN review_assignments ra ON ra.id=rv.assignment_id
           WHERE ra.submission_id=s.id AND rv.submitted_at IS NOT NULL) averageScore,
         COALESCE((SELECT GROUP_CONCAT(t.name,' · ') FROM submission_tracks st JOIN tracks t ON t.id=st.track_id WHERE st.submission_id=s.id),'') tracks,
         COALESCE((SELECT GROUP_CONCAT(tag.name,' · ') FROM submission_tag_assignments sta JOIN submission_tags tag ON tag.id=sta.tag_id WHERE sta.submission_id=s.id),'') tags,
         COALESCE((SELECT cm.status FROM communication_messages cm WHERE cm.id=s.decision_message_id),'not_prepared') notificationState
         FROM submissions s JOIN cfp_forms f ON f.id=s.form_id
         LEFT JOIN submission_people primary_person ON primary_person.submission_id=s.id AND primary_person.role='primary'
         WHERE s.event_id=? AND s.id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(eventId, ...chunk)
      .all<Record<string, unknown>>();
    for (const row of result.results) {
      let answers: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(row.answersJson ?? "{}"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          answers = parsed as Record<string, unknown>;
      } catch {
        // A malformed historical answer must not break an otherwise valid export.
      }
      rowById.set(String(row.id), { ...row, answers });
    }
  }
  return {
    fields,
    rows: ids
      .map((id) => rowById.get(id))
      .filter((row): row is ExportRow => Boolean(row)),
  };
}

const exportLabels: Record<string, string> = {
  title: "Title",
  formName: "Form",
  status: "Status",
  tracks: "Tracks",
  format: "Format",
  submitterName: "Submitter",
  submitterOrganization: "Organization",
  reviewProgress: "Review progress",
  averageScore: "Average score",
  decisionState: "Decision state",
  notificationState: "Notification state",
  tags: "Tags",
  submittedAt: "Submitted at",
  updatedAt: "Updated at",
};

function exportColumnLabel(column: string, fields: Map<string, ExportField>) {
  const raw = column.startsWith("field:")
    ? (fields.get(column.slice(6))?.label ?? "Custom field")
    : (exportLabels[column] ?? column);
  return safeSpreadsheetText(raw);
}

function exportCell(
  row: ExportRow,
  column: string,
  fields: Map<string, ExportField>,
) {
  let value: unknown;
  if (column.startsWith("field:")) {
    const field = fields.get(column.slice(6));
    value = field ? row.answers[field.fieldKey] : "";
  } else if (column === "reviewProgress") {
    value = `${Number(row.completedReviewCount ?? 0)}/${Number(row.reviewCount ?? 0)}`;
  } else {
    value = row[column];
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "object") value = JSON.stringify(value);
  return safeSpreadsheetText(String(value));
}

function safeSpreadsheetText(value: string) {
  const normalized = value.replaceAll("\u0000", "").slice(0, 32767);
  return /^[\t\r\n ]*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

function toCsv(rows: string[][]) {
  return `\uFEFF${rows
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n")}\r\n`;
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function spreadsheetColumn(index: number) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function toXlsx(headers: string[], values: string[][]) {
  const rows = [headers, ...values];
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (cell, columnIndex) =>
              `<c r="${spreadsheetColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Submissions" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    "xl/styles.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  };
  return zipSync(files, { level: 6 });
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export { querySchema, safeSpreadsheetText, viewConfigSchema };
export default router;
