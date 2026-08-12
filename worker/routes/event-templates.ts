import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { safeOperationalError } from "../lib/operations";
import {
  database,
  HttpError,
  normalizeSlug,
  requireEventRole,
  requireOrganizationRole,
} from "../lib/authz";

type Variables = { requestId: string };
type Row = Record<string, unknown>;
type Configuration = {
  source: { name: string; startsAt: string; endsAt: string; timezone: string };
  event: Row;
  cfp: { forms: Row[]; fields: Row[]; conditions: Row[] };
  review: {
    rounds: Row[];
    scorecards: Row[];
    reviewers: Row[];
    tags: Row[];
    routing: {
      legacy: unknown;
      rules: Row[];
      groups: Row[];
      conditions: Row[];
      excludedReviewers: Row[];
      ruleTags: Row[];
    };
  };
  onboarding: Row[];
  resources: Row[];
  communications: { templates: Row[]; reminderRules: unknown[] };
  roomsTracksLocations: {
    rooms: Row[];
    tracks: Row[];
    locations: unknown[];
    formats: unknown[];
  };
  contentWorkflow: Row;
  widgets: Row[];
  crm: { handoffDefaults: unknown; customFields: Row[] };
};

export const COPY_DOMAINS = [
  "cfp",
  "review",
  "onboarding",
  "resources",
  "communications",
  "roomsTracksLocations",
  "contentWorkflow",
  "widgets",
  "crm",
] as const;
type CopyDomain = (typeof COPY_DOMAINS)[number];

const domainsSchema = z
  .array(z.enum(COPY_DOMAINS))
  .min(1)
  .max(COPY_DOMAINS.length);
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), id: z.string().uuid() }),
  z.object({ kind: z.literal("organization_template"), id: z.string().uuid() }),
  z.object({
    kind: z.literal("starter_template"),
    id: z.enum(["conference", "meetup", "workshop", "community-cfp"]),
  }),
]);
const targetSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z.string().trim().max(64).optional(),
    timezone: z.string().trim().min(1).max(100),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    venueName: z.string().trim().max(160).nullable().optional(),
    websiteUrl: z.url().nullable().optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (new Date(value.endsAt) <= new Date(value.startsAt))
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End time must be after start time.",
      });
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone });
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Choose a valid IANA timezone.",
      });
    }
  });
export const previewSchema = z.object({
  source: sourceSchema,
  domains: domainsSchema,
  target: targetSchema,
});
const createSchema = previewSchema.extend({ confirmPreview: z.literal(true) });
const saveSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(64).optional(),
  description: z.string().trim().max(500).optional(),
  domains: domainsSchema,
});
const editTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().max(64).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const starterDescriptions: Record<string, string> = {
  conference:
    "Multi-track conference with structured review and a complete speaker workflow.",
  meetup:
    "A lightweight recurring meetup program with a short CFP and rapid review.",
  workshop:
    "A facilitated workshop program emphasizing prerequisites, materials, and capacity.",
  "community-cfp":
    "An inclusive community call for proposals with blind review and speaker support.",
};

router.get("/organizations/:organizationId", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
  const templates = await database(context.env)
    .prepare(
      `SELECT id,name,slug,description,version,domains_json domainsJson,source_event_id sourceEventId,
      created_at createdAt,updated_at updatedAt FROM event_templates WHERE organization_id=? ORDER BY updated_at DESC LIMIT 250`,
    )
    .bind(organizationId)
    .all();
  return context.json({
    domains: COPY_DOMAINS,
    templates: templates.results.map((item) => ({
      ...item,
      domains: parseJson(String(item.domainsJson), []),
    })),
    starters: Object.entries(starterDescriptions).map(([id, description]) => ({
      id,
      name: starterName(id),
      description,
    })),
  });
});

router.post(
  "/organizations/:organizationId/preview",
  zValidator("json", previewSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, ["owner", "admin"]);
    const input = context.req.valid("json");
    const configuration = await resolveConfiguration(
      context.env,
      organizationId,
      input.source,
    );
    return context.json({
      preview: makePreview(configuration, input.domains, input.target),
    });
  },
);

router.post(
  "/organizations/:organizationId/events",
  zValidator("json", createSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const slug = normalizeSlug(input.target.slug || input.target.name);
    if (!slug)
      throw new HttpError(
        400,
        "invalid_slug",
        "Choose a name containing letters or numbers.",
      );
    const collision = await db
      .prepare(
        "SELECT id FROM events WHERE organization_id=? AND slug=? COLLATE NOCASE",
      )
      .bind(organizationId, slug)
      .first();
    if (collision)
      throw new HttpError(
        409,
        "slug_taken",
        "That event URL is already in use for this workspace.",
      );

    const configuration = await resolveConfiguration(
      context.env,
      organizationId,
      input.source,
    );
    const preview = makePreview(configuration, input.domains, input.target);
    const operationId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO event_creation_operations
    (id,organization_id,source_kind,source_id,selected_domains_json,translated_deadlines_json,warnings_json,created_by)
    VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(
        operationId,
        organizationId,
        input.source.kind,
        input.source.id,
        JSON.stringify(input.domains),
        JSON.stringify(preview.translatedDeadlines),
        JSON.stringify(preview.warnings),
        user.id,
      )
      .run();
    try {
      const eventId = await materialize(
        db,
        organizationId,
        user.id,
        operationId,
        context.get("requestId"),
        input.source,
        configuration,
        input.domains,
        {
          ...input.target,
          slug,
        },
      );
      await db.batch([
        db
          .prepare(
            "UPDATE event_creation_operations SET target_event_id=?,status='succeeded',completed_at=? WHERE id=?",
          )
          .bind(eventId, new Date().toISOString(), operationId),
        auditStatement(db, {
          organizationId,
          eventId,
          actorUserId: user.id,
          action: "event.configuration_created",
          entityType: "event",
          entityId: eventId,
          after: {
            source: input.source,
            domains: input.domains,
            operationId,
            warnings: preview.warnings,
          },
          requestId: context.get("requestId"),
        }),
      ]);
      const event = await db
        .prepare(
          `SELECT id,organization_id organizationId,name,slug,event_type eventType,timezone,
      starts_at startsAt,ends_at endsAt,venue_name venueName,website_url websiteUrl,status,source_event_id sourceEventId,
      source_template_id sourceTemplateId,creation_operation_id creationOperationId FROM events WHERE id=?`,
        )
        .bind(eventId)
        .first();
      console.log(
        JSON.stringify({
          level: "info",
          service: "event_templates",
          action: "event_created",
          requestId: context.get("requestId"),
          organizationId,
          eventId,
          operationId,
          sourceKind: input.source.kind,
          selectedDomainCount: input.domains.length,
          warningCount: preview.warnings.length,
        }),
      );
      return context.json({ event, preview, operationId }, 201);
    } catch (error) {
      await db.batch([
        db
          .prepare("DELETE FROM events WHERE creation_operation_id=?")
          .bind(operationId),
        db
          .prepare(
            "UPDATE event_creation_operations SET target_event_id=NULL,status='failed',failure_code=?,completed_at=? WHERE id=?",
          )
          .bind(
            error instanceof Error
              ? error.name.slice(0, 100)
              : "creation_failed",
            new Date().toISOString(),
            operationId,
          ),
      ]);
      console.error(
        JSON.stringify({
          level: "error",
          service: "event_templates",
          requestId: context.get("requestId"),
          organizationId,
          operationId,
          message: safeOperationalError(error),
        }),
      );
      throw new HttpError(
        503,
        "event_creation_failed",
        "The event could not be created. All partial records were safely removed.",
      );
    }
  },
);

router.post(
  "/events/:eventId",
  zValidator("json", saveSchema),
  async (context) => {
    const eventId = context.req.param("eventId");
    const { user, organizationId } = await requireEventRole(context, eventId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const slug = normalizeSlug(input.slug || input.name);
    if (!slug)
      throw new HttpError(
        400,
        "invalid_slug",
        "Choose a template name containing letters or numbers.",
      );
    const db = database(context.env);
    const exists = await db
      .prepare(
        "SELECT id FROM event_templates WHERE organization_id=? AND slug=? COLLATE NOCASE",
      )
      .bind(organizationId, slug)
      .first();
    if (exists)
      throw new HttpError(
        409,
        "slug_taken",
        "A template already uses that name.",
      );
    const configuration = await snapshotEvent(db, eventId);
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_templates
      (id,organization_id,source_event_id,name,slug,description,domains_json,configuration_json,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          organizationId,
          eventId,
          input.name,
          slug,
          input.description ?? null,
          JSON.stringify(input.domains),
          JSON.stringify(selectConfiguration(configuration, input.domains)),
          user.id,
          user.id,
        ),
      auditStatement(db, {
        organizationId,
        eventId,
        actorUserId: user.id,
        action: "event_template.created",
        entityType: "event_template",
        entityId: id,
        after: {
          name: input.name,
          slug,
          domains: input.domains,
          sourceEventId: eventId,
        },
        requestId: context.get("requestId"),
      }),
    ]);
    console.log(
      JSON.stringify({
        level: "info",
        service: "event_templates",
        action: "template_created",
        requestId: context.get("requestId"),
        organizationId,
        eventId,
        templateId: id,
        selectedDomainCount: input.domains.length,
      }),
    );
    return context.json(
      {
        template: {
          id,
          name: input.name,
          slug,
          description: input.description ?? null,
          domains: input.domains,
          version: 1,
        },
      },
      201,
    );
  },
);

router.patch(
  "/:templateId",
  zValidator("json", editTemplateSchema),
  async (context) => {
    const templateId = context.req.param("templateId");
    const db = database(context.env);
    const before = await db
      .prepare("SELECT * FROM event_templates WHERE id=?")
      .bind(templateId)
      .first<Row>();
    if (!before)
      throw new HttpError(404, "template_not_found", "Template not found.");
    const organizationId = String(before.organization_id);
    const { user } = await requireOrganizationRole(context, organizationId, [
      "owner",
      "admin",
    ]);
    const input = context.req.valid("json");
    const name = input.name ?? String(before.name);
    const slug = normalizeSlug(
      input.slug || (input.name ? input.name : String(before.slug)),
    );
    const collision = await db
      .prepare(
        "SELECT id FROM event_templates WHERE organization_id=? AND slug=? COLLATE NOCASE AND id<>?",
      )
      .bind(organizationId, slug, templateId)
      .first();
    if (collision)
      throw new HttpError(
        409,
        "slug_taken",
        "A template already uses that name.",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE event_templates SET name=?,slug=?,description=?,version=version+1,updated_by=?,updated_at=? WHERE id=?",
        )
        .bind(
          name,
          slug,
          input.description === undefined
            ? before.description
            : input.description,
          user.id,
          new Date().toISOString(),
          templateId,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "event_template.updated",
        entityType: "event_template",
        entityId: templateId,
        before: {
          name: before.name,
          slug: before.slug,
          description: before.description,
        },
        after: {
          name,
          slug,
          description:
            input.description === undefined
              ? before.description
              : input.description,
        },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ ok: true });
  },
);

router.delete("/:templateId", async (context) => {
  const templateId = context.req.param("templateId");
  const db = database(context.env);
  const item = await db
    .prepare(
      "SELECT organization_id organizationId,name FROM event_templates WHERE id=?",
    )
    .bind(templateId)
    .first<Row>();
  if (!item)
    throw new HttpError(404, "template_not_found", "Template not found.");
  const { user } = await requireOrganizationRole(
    context,
    String(item.organizationId),
    ["owner", "admin"],
  );
  await db.batch([
    auditStatement(db, {
      organizationId: String(item.organizationId),
      actorUserId: user.id,
      action: "event_template.deleted",
      entityType: "event_template",
      entityId: templateId,
      before: { name: item.name },
      requestId: context.get("requestId"),
    }),
    db.prepare("DELETE FROM event_templates WHERE id=?").bind(templateId),
  ]);
  return context.json({ ok: true });
});

async function resolveConfiguration(
  env: Env,
  organizationId: string,
  source: z.infer<typeof sourceSchema>,
) {
  const db = database(env);
  if (source.kind === "event") {
    const event = await db
      .prepare("SELECT id FROM events WHERE id=? AND organization_id=?")
      .bind(source.id, organizationId)
      .first();
    if (!event)
      throw new HttpError(404, "source_not_found", "Source event not found.");
    return snapshotEvent(db, source.id);
  }
  if (source.kind === "organization_template") {
    const template = await db
      .prepare(
        "SELECT configuration_json configurationJson FROM event_templates WHERE id=? AND organization_id=?",
      )
      .bind(source.id, organizationId)
      .first<{ configurationJson: string }>();
    if (!template)
      throw new HttpError(404, "source_not_found", "Template not found.");
    return normalizeConfiguration(
      parseJson(
        template.configurationJson,
        emptyConfiguration("Template"),
      ) as Row,
    );
  }
  return starterConfiguration(source.id);
}

async function snapshotEvent(
  db: D1Database,
  eventId: string,
): Promise<Configuration> {
  const event = await db
    .prepare(
      `SELECT id,name,event_type eventType,website_url websiteUrl,venue_name venueName,address,timezone,
    starts_at startsAt,ends_at endsAt,primary_color primaryColor,file_uploads_enabled fileUploadsEnabled FROM events WHERE id=?`,
    )
    .bind(eventId)
    .first<Row>();
  if (!event) throw new HttpError(404, "event_not_found", "Event not found.");
  const all = async (sql: string) =>
    (await db.prepare(sql).bind(eventId).all<Row>()).results;
  const [
    forms,
    fields,
    conditions,
    rounds,
    scorecards,
    reviewPool,
    reviewTags,
    routingRules,
    routingGroups,
    routingConditions,
    routingExcludedReviewers,
    routingRuleTags,
    onboarding,
    resources,
    communications,
    rooms,
    tracks,
    widgets,
    settings,
    crmFields,
  ] = await Promise.all([
    all(
      "SELECT id,name,slug,description,opens_at opensAt,closes_at closesAt,edit_closes_at editClosesAt,allow_drafts allowDrafts,submission_limit submissionLimit,confirmation_subject confirmationSubject,confirmation_body confirmationBody,published_at publishedAt FROM cfp_forms WHERE event_id=? ORDER BY created_at",
    ),
    all(
      "SELECT ff.id,ff.form_id formId,ff.section,ff.field_type fieldType,ff.field_key fieldKey,ff.label,ff.description,ff.placeholder,ff.required,ff.options_json optionsJson,ff.validation_json validationJson,ff.position,ff.searchable FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id WHERE f.event_id=? ORDER BY ff.position",
    ),
    all(
      "SELECT fc.id,fc.form_id formId,fc.source_field_id sourceFieldId,fc.operator,fc.compare_value_json compareValueJson,fc.target_field_id targetFieldId,fc.action FROM form_conditions fc JOIN cfp_forms f ON f.id=fc.form_id WHERE f.event_id=?",
    ),
    all(
      "SELECT id,name,position,is_blind isBlind,opens_at opensAt,closes_at closesAt,status FROM review_rounds WHERE event_id=? ORDER BY position",
    ),
    all(
      "SELECT sf.id,sf.round_id roundId,sf.label,sf.field_type fieldType,sf.options_json optionsJson,sf.min_value minValue,sf.max_value maxValue,sf.weight,sf.required,sf.position FROM scorecard_fields sf JOIN review_rounds rr ON rr.id=sf.round_id WHERE rr.event_id=? ORDER BY sf.position",
    ),
    all(
      "SELECT rrr.round_id roundId,rrr.reviewer_user_id reviewerUserId,rrr.capacity FROM review_round_reviewers rrr JOIN review_rounds rr ON rr.id=rrr.round_id WHERE rr.event_id=? ORDER BY rr.position,rrr.reviewer_user_id",
    ),
    all(
      "SELECT id,name,color FROM submission_tags WHERE event_id=? ORDER BY name,id",
    ),
    all(
      `SELECT id,name,description,priority,enabled,group_operator groupOperator,round_id roundId,
       reviewers_per_submission reviewersPerSubmission,owner_user_id ownerUserId
       FROM review_routing_rules WHERE event_id=? ORDER BY priority,id`,
    ),
    all(
      `SELECT g.id,g.rule_id ruleId,g.position,g.condition_operator conditionOperator
       FROM review_routing_condition_groups g JOIN review_routing_rules r ON r.id=g.rule_id
       WHERE r.event_id=? ORDER BY r.priority,g.position,g.id`,
    ),
    all(
      `SELECT c.id,c.group_id groupId,c.source,c.field_id fieldId,c.operator,c.value_json valueJson,c.position
       FROM review_routing_conditions c JOIN review_routing_condition_groups g ON g.id=c.group_id
       JOIN review_routing_rules r ON r.id=g.rule_id WHERE r.event_id=?
       ORDER BY r.priority,g.position,c.position,c.id`,
    ),
    all(
      `SELECT x.rule_id ruleId,x.reviewer_user_id reviewerUserId
       FROM review_routing_excluded_reviewers x JOIN review_routing_rules r ON r.id=x.rule_id
       WHERE r.event_id=? ORDER BY x.rule_id,x.reviewer_user_id`,
    ),
    all(
      `SELECT x.rule_id ruleId,x.tag_id tagId FROM review_routing_rule_tags x
       JOIN review_routing_rules r ON r.id=x.rule_id WHERE r.event_id=? ORDER BY x.rule_id,x.tag_id`,
    ),
    all(
      "SELECT id,title,description,task_type taskType,due_at dueAt,position FROM onboarding_tasks WHERE event_id=? ORDER BY position",
    ),
    all(
      "SELECT id,title,body_html bodyHtml,position,published_at publishedAt FROM resources WHERE event_id=? ORDER BY position",
    ),
    all(
      "SELECT id,category,name,subject,body_html bodyHtml,body_text bodyText,merge_fields_json mergeFieldsJson,enabled,version FROM communication_templates WHERE event_id=? ORDER BY category,name",
    ),
    all(
      "SELECT id,name,capacity,position FROM rooms WHERE event_id=? ORDER BY position",
    ),
    all(
      "SELECT id,name,slug,color,description,position FROM tracks WHERE event_id=? ORDER BY position",
    ),
    all(
      "SELECT id,name,widget_type widgetType,config_json configJson FROM widget_configs WHERE event_id=? ORDER BY created_at",
    ),
    all(
      "SELECT reviewer_routing_json reviewerRoutingJson,reminder_rules_json reminderRulesJson,locations_json locationsJson,formats_json formatsJson,content_workflow_json contentWorkflowJson,crm_handoff_defaults_json crmHandoffDefaultsJson FROM event_program_settings WHERE event_id=?",
    ),
    all(
      "SELECT id,name,field_type fieldType,options_json optionsJson,position FROM crm_fields WHERE organization_id=(SELECT organization_id FROM events WHERE id=?) ORDER BY position",
    ),
  ]);
  const settingsRow = settings[0] ?? {};
  return {
    source: {
      name: String(event.name),
      startsAt: String(event.startsAt),
      endsAt: String(event.endsAt),
      timezone: String(event.timezone),
    },
    event,
    cfp: { forms, fields, conditions },
    review: {
      rounds,
      scorecards,
      reviewers: reviewPool,
      tags: reviewTags,
      routing: {
        legacy: parseJson(String(settingsRow.reviewerRoutingJson ?? "{}"), {}),
        rules: routingRules,
        groups: routingGroups,
        conditions: routingConditions,
        excludedReviewers: routingExcludedReviewers,
        ruleTags: routingRuleTags,
      },
    },
    onboarding,
    resources,
    communications: {
      templates: communications,
      reminderRules: parseJson(
        String(settingsRow.reminderRulesJson ?? "[]"),
        [],
      ) as unknown[],
    },
    roomsTracksLocations: {
      rooms,
      tracks,
      locations: parseJson(String(settingsRow.locationsJson ?? "[]"), []),
      formats: parseJson(String(settingsRow.formatsJson ?? "[]"), []),
    },
    contentWorkflow: {
      fileUploadsEnabled: event.fileUploadsEnabled,
      ...(parseJson(
        String(settingsRow.contentWorkflowJson ?? "{}"),
        {},
      ) as Row),
    },
    widgets,
    crm: {
      handoffDefaults: parseJson(
        String(settingsRow.crmHandoffDefaultsJson ?? "{}"),
        {},
      ),
      customFields: crmFields,
    },
  };
}

export function selectConfiguration(
  configuration: Configuration,
  domains: CopyDomain[],
): Configuration {
  const empty = emptyConfiguration(configuration.source.name);
  return {
    ...empty,
    source: configuration.source,
    event: configuration.event,
    ...Object.fromEntries(
      domains.map((domain) => [domain, configuration[domain]]),
    ),
  } as Configuration;
}

export function makePreview(
  configuration: Configuration,
  domains: CopyDomain[],
  target: z.infer<typeof targetSchema>,
) {
  const counts: Record<string, number> = {};
  for (const domain of domains)
    counts[domain] = domainCount(configuration, domain);
  const translatedDeadlines: Array<{
    domain: string;
    label: string;
    from: string;
    to: string;
  }> = [];
  const warnings: string[] = [];
  const sourceStart = Date.parse(configuration.source.startsAt);
  const targetStart = Date.parse(target.startsAt);
  const collect = (domain: string, label: string, value: unknown) => {
    if (!value) return;
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed) || !Number.isFinite(sourceStart))
      warnings.push(`${label} could not be translated and will be left unset.`);
    else
      translatedDeadlines.push({
        domain,
        label,
        from: String(value),
        to: new Date(parsed + targetStart - sourceStart).toISOString(),
      });
  };
  if (domains.includes("cfp"))
    for (const form of configuration.cfp.forms) {
      collect("cfp", `${String(form.name)} opens`, form.opensAt);
      collect("cfp", `${String(form.name)} closes`, form.closesAt);
      collect("cfp", `${String(form.name)} editing closes`, form.editClosesAt);
    }
  if (domains.includes("review"))
    for (const round of configuration.review.rounds) {
      collect("review", `${String(round.name)} opens`, round.opensAt);
      collect("review", `${String(round.name)} closes`, round.closesAt);
    }
  if (domains.includes("onboarding"))
    for (const task of configuration.onboarding)
      collect("onboarding", String(task.title), task.dueAt);
  return {
    sourceName: configuration.source.name,
    target,
    domains: domains.map((id) => ({ id, count: counts[id] })),
    totalRecords: Object.values(counts).reduce((sum, value) => sum + value, 0),
    translatedDeadlines,
    warnings,
    excluded: [
      "Submissions, reviews, scores, and decisions",
      "Speakers, contacts, notes, and logistics",
      "Files and uploads",
      "Communications and provider history",
      "Calendar records",
      "Audit events",
      "Airtable external IDs",
      "Integration credentials and secrets",
    ],
  };
}

function domainCount(configuration: Configuration, domain: CopyDomain) {
  const value = configuration[domain];
  if (Array.isArray(value)) return value.length;
  if (domain === "cfp")
    return (
      configuration.cfp.forms.length +
      configuration.cfp.fields.length +
      configuration.cfp.conditions.length
    );
  if (domain === "review")
    return (
      configuration.review.rounds.length +
      configuration.review.scorecards.length +
      configuration.review.reviewers.length +
      configuration.review.tags.length +
      configuration.review.routing.rules.length +
      configuration.review.routing.groups.length +
      configuration.review.routing.conditions.length +
      (objectSize(configuration.review.routing.legacy) ? 1 : 0)
    );
  if (domain === "communications")
    return (
      configuration.communications.templates.length +
      configuration.communications.reminderRules.length
    );
  if (domain === "crm")
    return (
      configuration.crm.customFields.length +
      (objectSize(configuration.crm.handoffDefaults) ? 1 : 0)
    );
  if (domain === "roomsTracksLocations")
    return (
      configuration.roomsTracksLocations.rooms.length +
      configuration.roomsTracksLocations.tracks.length +
      configuration.roomsTracksLocations.locations.length +
      configuration.roomsTracksLocations.formats.length
    );
  return Object.keys(value as object).length ? 1 : 0;
}

async function materialize(
  db: D1Database,
  organizationId: string,
  userId: string,
  operationId: string,
  requestId: string,
  source: z.infer<typeof sourceSchema>,
  configuration: Configuration,
  domains: CopyDomain[],
  target: z.infer<typeof targetSchema> & { slug: string },
) {
  const eventId = crypto.randomUUID();
  const sourceEventId = source.kind === "event" ? source.id : null;
  const sourceTemplateId =
    source.kind === "organization_template" ? source.id : null;
  await db.batch([
    db
      .prepare(
        `INSERT INTO events (id,organization_id,name,slug,event_type,website_url,venue_name,address,timezone,starts_at,ends_at,
      primary_color,file_uploads_enabled,status,created_by,source_event_id,source_template_id,creation_operation_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)`,
      )
      .bind(
        eventId,
        organizationId,
        target.name,
        target.slug,
        String(configuration.event.eventType ?? "conference"),
        target.websiteUrl || null,
        target.venueName ?? configuration.event.venueName ?? null,
        null,
        target.timezone,
        target.startsAt,
        target.endsAt,
        String(configuration.event.primaryColor ?? "#315c45"),
        domains.includes("contentWorkflow")
          ? Number(configuration.contentWorkflow.fileUploadsEnabled ?? 1)
          : 1,
        userId,
        sourceEventId,
        sourceTemplateId,
        operationId,
      ),
    db
      .prepare(
        "INSERT INTO event_members (event_id,user_id,role) VALUES (?,?,'owner')",
      )
      .bind(eventId, userId),
  ]);
  const delta =
    Date.parse(target.startsAt) - Date.parse(configuration.source.startsAt);
  const translate = (value: unknown) =>
    value &&
    Number.isFinite(Date.parse(String(value))) &&
    Number.isFinite(delta)
      ? new Date(Date.parse(String(value)) + delta).toISOString()
      : null;
  const formMap = new Map<string, string>();
  const fieldMap = new Map<string, string>();
  const roundMap = new Map<string, string>();
  const trackMap = new Map<string, string>();
  const tagMap = new Map<string, string>();
  const routingRuleMap = new Map<string, string>();
  const routingGroupMap = new Map<string, string>();
  if (domains.includes("roomsTracksLocations"))
    for (const row of configuration.roomsTracksLocations.tracks)
      trackMap.set(String(row.id), crypto.randomUUID());
  const statements: D1PreparedStatement[] = [];
  const syncEntities: Array<{
    type:
      | "cfp_form"
      | "form_field"
      | "event_program_settings"
      | "crm_field"
      | "review_routing_rule";
    id: string;
  }> = [];
  if (domains.includes("cfp")) {
    for (const row of configuration.cfp.forms) {
      const id = crypto.randomUUID();
      formMap.set(String(row.id), id);
      syncEntities.push({ type: "cfp_form", id });
      statements.push(
        db
          .prepare(
            `INSERT INTO cfp_forms (id,event_id,name,slug,description,opens_at,closes_at,edit_closes_at,allow_drafts,submission_limit,confirmation_subject,confirmation_body,published_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
          )
          .bind(
            id,
            eventId,
            row.name,
            row.slug,
            row.description ?? null,
            translate(row.opensAt),
            translate(row.closesAt),
            translate(row.editClosesAt),
            Number(row.allowDrafts ?? 1),
            row.submissionLimit ?? null,
            row.confirmationSubject ?? null,
            row.confirmationBody ?? null,
          ),
      );
    }
    for (const row of configuration.cfp.fields) {
      const formId = formMap.get(String(row.formId));
      if (!formId) continue;
      const id = crypto.randomUUID();
      fieldMap.set(String(row.id), id);
      syncEntities.push({ type: "form_field", id });
      statements.push(
        db
          .prepare(
            `INSERT INTO form_fields (id,form_id,section,field_type,field_key,label,description,placeholder,required,options_json,validation_json,position,searchable)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            formId,
            row.section,
            row.fieldType,
            row.fieldKey,
            row.label,
            row.description ?? null,
            row.placeholder ?? null,
            Number(row.required ?? 0),
            row.optionsJson ?? null,
            row.validationJson ?? null,
            Number(row.position ?? 0),
            Number(row.searchable ?? 0),
          ),
      );
    }
    for (const row of configuration.cfp.conditions) {
      const formId = formMap.get(String(row.formId));
      const sourceId = fieldMap.get(String(row.sourceFieldId));
      const targetId = fieldMap.get(String(row.targetFieldId));
      if (!formId || !sourceId || !targetId) continue;
      statements.push(
        db
          .prepare(
            "INSERT INTO form_conditions (id,form_id,source_field_id,operator,compare_value_json,target_field_id,action) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            formId,
            sourceId,
            row.operator,
            row.compareValueJson ?? null,
            targetId,
            row.action,
          ),
      );
    }
  }
  if (domains.includes("review")) {
    for (const row of configuration.review.rounds) {
      const id = crypto.randomUUID();
      roundMap.set(String(row.id), id);
      statements.push(
        db
          .prepare(
            "INSERT INTO review_rounds (id,event_id,name,position,is_blind,opens_at,closes_at,status) VALUES (?,?,?,?,?,?,?,'draft')",
          )
          .bind(
            id,
            eventId,
            row.name,
            Number(row.position ?? 0),
            Number(row.isBlind ?? 0),
            translate(row.opensAt),
            translate(row.closesAt),
          ),
      );
    }
    for (const row of configuration.review.scorecards) {
      const roundId = roundMap.get(String(row.roundId));
      if (!roundId) continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO scorecard_fields (id,round_id,label,field_type,options_json,min_value,max_value,weight,required,position) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            roundId,
            row.label,
            row.fieldType,
            row.optionsJson ?? null,
            row.minValue ?? null,
            row.maxValue ?? null,
            Number(row.weight ?? 1),
            Number(row.required ?? 1),
            Number(row.position ?? 0),
          ),
      );
    }
    for (const row of configuration.review.reviewers) {
      const roundId = roundMap.get(String(row.roundId));
      if (!roundId || !row.reviewerUserId) continue;
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO event_members(event_id,user_id,role) VALUES(?,?,'reviewer')",
          )
          .bind(eventId, row.reviewerUserId),
        db
          .prepare(
            "INSERT INTO review_round_reviewers(round_id,reviewer_user_id,capacity) VALUES(?,?,?)",
          )
          .bind(
            roundId,
            row.reviewerUserId,
            Math.max(1, Number(row.capacity ?? 25)),
          ),
      );
    }
    for (const row of configuration.review.tags) {
      const id = crypto.randomUUID();
      tagMap.set(String(row.id), id);
      statements.push(
        db
          .prepare(
            "INSERT INTO submission_tags(id,organization_id,event_id,name,color,created_by) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            id,
            organizationId,
            eventId,
            row.name,
            row.color ?? "#64748b",
            userId,
          ),
      );
    }
    for (const row of configuration.review.routing.rules) {
      const roundId = roundMap.get(String(row.roundId));
      if (!roundId) continue;
      const id = crypto.randomUUID();
      routingRuleMap.set(String(row.id), id);
      syncEntities.push({ type: "review_routing_rule", id });
      statements.push(
        db
          .prepare(
            `INSERT INTO review_routing_rules
             (id,organization_id,event_id,name,description,priority,enabled,group_operator,round_id,
              reviewers_per_submission,owner_user_id,created_by,updated_by)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            organizationId,
            eventId,
            row.name,
            row.description ?? null,
            Number(row.priority ?? 100),
            Number(row.enabled ?? 1),
            row.groupOperator ?? "and",
            roundId,
            Number(row.reviewersPerSubmission ?? 2),
            row.ownerUserId ?? null,
            userId,
            userId,
          ),
      );
    }
    for (const row of configuration.review.routing.groups) {
      const ruleId = routingRuleMap.get(String(row.ruleId));
      if (!ruleId) continue;
      const id = crypto.randomUUID();
      routingGroupMap.set(String(row.id), id);
      statements.push(
        db
          .prepare(
            "INSERT INTO review_routing_condition_groups(id,rule_id,position,condition_operator) VALUES(?,?,?,?)",
          )
          .bind(
            id,
            ruleId,
            Number(row.position ?? 0),
            row.conditionOperator ?? "and",
          ),
      );
    }
    for (const row of configuration.review.routing.conditions) {
      const groupId = routingGroupMap.get(String(row.groupId));
      if (!groupId) continue;
      const source = String(row.source);
      const valueMap =
        source === "form"
          ? formMap
          : source === "track"
            ? trackMap
            : source === "tag"
              ? tagMap
              : undefined;
      const fieldId =
        source === "custom_field"
          ? (fieldMap.get(String(row.fieldId)) ?? null)
          : null;
      statements.push(
        db
          .prepare(
            `INSERT INTO review_routing_conditions
             (id,group_id,source,field_id,operator,value_json,position) VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            groupId,
            source,
            fieldId,
            row.operator,
            remapRoutingValue(row.valueJson, valueMap),
            Number(row.position ?? 0),
          ),
      );
    }
    for (const row of configuration.review.routing.excludedReviewers) {
      const ruleId = routingRuleMap.get(String(row.ruleId));
      if (ruleId && row.reviewerUserId)
        statements.push(
          db
            .prepare(
              "INSERT INTO review_routing_excluded_reviewers(rule_id,reviewer_user_id) VALUES(?,?)",
            )
            .bind(ruleId, row.reviewerUserId),
        );
    }
    for (const row of configuration.review.routing.ruleTags) {
      const ruleId = routingRuleMap.get(String(row.ruleId));
      const tagId = tagMap.get(String(row.tagId));
      if (ruleId && tagId)
        statements.push(
          db
            .prepare(
              "INSERT INTO review_routing_rule_tags(rule_id,tag_id) VALUES(?,?)",
            )
            .bind(ruleId, tagId),
        );
    }
  }
  if (domains.includes("onboarding"))
    for (const row of configuration.onboarding)
      statements.push(
        db
          .prepare(
            "INSERT INTO onboarding_tasks (id,event_id,title,description,task_type,due_at,position) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            eventId,
            row.title,
            row.description ?? null,
            row.taskType,
            translate(row.dueAt),
            Number(row.position ?? 0),
          ),
      );
  if (domains.includes("resources"))
    for (const row of configuration.resources)
      statements.push(
        db
          .prepare(
            "INSERT INTO resources (id,event_id,title,body_html,position,published_at) VALUES (?,?,?,?,?,NULL)",
          )
          .bind(
            crypto.randomUUID(),
            eventId,
            row.title,
            row.bodyHtml,
            Number(row.position ?? 0),
          ),
      );
  if (domains.includes("communications"))
    for (const row of configuration.communications.templates)
      statements.push(
        db
          .prepare(
            `INSERT INTO communication_templates
    (id,organization_id,event_id,category,name,subject,body_html,body_text,merge_fields_json,enabled,version,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            organizationId,
            eventId,
            row.category,
            row.name,
            row.subject,
            row.bodyHtml,
            row.bodyText,
            row.mergeFieldsJson ?? "[]",
            Number(row.enabled ?? 1),
            userId,
            userId,
          ),
      );
  if (domains.includes("roomsTracksLocations")) {
    for (const row of configuration.roomsTracksLocations.rooms)
      statements.push(
        db
          .prepare(
            "INSERT INTO rooms (id,event_id,name,capacity,position) VALUES (?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            eventId,
            row.name,
            row.capacity ?? null,
            Number(row.position ?? 0),
          ),
      );
    for (const row of configuration.roomsTracksLocations.tracks)
      statements.push(
        db
          .prepare(
            "INSERT INTO tracks (id,event_id,name,slug,color,description,position) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            trackMap.get(String(row.id)),
            eventId,
            row.name,
            row.slug,
            row.color,
            row.description ?? null,
            Number(row.position ?? 0),
          ),
      );
  }
  if (domains.includes("widgets"))
    for (const row of configuration.widgets)
      statements.push(
        db
          .prepare(
            "INSERT INTO widget_configs (id,event_id,name,widget_type,public_key,config_json,created_by) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            eventId,
            row.name,
            row.widgetType,
            crypto.randomUUID().replaceAll("-", ""),
            row.configJson ?? "{}",
            userId,
          ),
      );
  if (domains.includes("crm")) {
    const currentFields = await db
      .prepare(
        "SELECT LOWER(name) name FROM crm_fields WHERE organization_id=?",
      )
      .bind(organizationId)
      .all<{ name: string }>();
    const names = new Set(currentFields.results.map((row) => row.name));
    for (const row of configuration.crm.customFields) {
      const name = String(row.name ?? "").trim();
      if (!name || names.has(name.toLowerCase())) continue;
      names.add(name.toLowerCase());
      const id = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            "INSERT INTO crm_fields(id,organization_id,name,field_type,options_json,position) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            id,
            organizationId,
            name,
            row.fieldType,
            row.optionsJson ?? null,
            Number(row.position ?? 0),
          ),
      );
      syncEntities.push({ type: "crm_field", id });
    }
  }
  const locations = domains.includes("roomsTracksLocations")
    ? configuration.roomsTracksLocations.locations
    : [];
  const formats = domains.includes("roomsTracksLocations")
    ? configuration.roomsTracksLocations.formats
    : [];
  const crm = domains.includes("crm") ? configuration.crm : null;
  const workflow = domains.includes("contentWorkflow")
    ? configuration.contentWorkflow
    : {};
  statements.push(
    db
      .prepare(
        `INSERT INTO event_program_settings (event_id,reviewer_routing_json,reminder_rules_json,locations_json,formats_json,content_workflow_json,crm_handoff_defaults_json)
    VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        eventId,
        JSON.stringify(
          domains.includes("review") ? configuration.review.routing.legacy : {},
        ),
        JSON.stringify(
          domains.includes("communications")
            ? configuration.communications.reminderRules
            : [],
        ),
        JSON.stringify(locations),
        JSON.stringify(formats),
        JSON.stringify(workflow),
        JSON.stringify(crm ?? {}),
      ),
  );
  syncEntities.push({ type: "event_program_settings", id: eventId });
  for (let index = 0; index < statements.length; index += 75)
    await db.batch(statements.slice(index, index + 75));
  const syncAudits = syncEntities.map((entity) =>
    auditStatement(db, {
      organizationId,
      eventId,
      actorUserId: userId,
      action: `${entity.type}.created_from_template`,
      entityType: entity.type,
      entityId: entity.id,
      after: { eventId, operationId },
      requestId,
    }),
  );
  for (let index = 0; index < syncAudits.length; index += 75)
    await db.batch(syncAudits.slice(index, index + 75));
  return eventId;
}

function emptyConfiguration(name: string): Configuration {
  return {
    source: {
      name,
      startsAt: "2030-06-10T16:00:00.000Z",
      endsAt: "2030-06-12T00:00:00.000Z",
      timezone: "America/Los_Angeles",
    },
    event: {
      eventType: "conference",
      primaryColor: "#315c45",
      fileUploadsEnabled: 1,
    },
    cfp: { forms: [], fields: [], conditions: [] },
    review: {
      rounds: [],
      scorecards: [],
      reviewers: [],
      tags: [],
      routing: {
        legacy: {},
        rules: [],
        groups: [],
        conditions: [],
        excludedReviewers: [],
        ruleTags: [],
      },
    },
    onboarding: [],
    resources: [],
    communications: { templates: [], reminderRules: [] },
    roomsTracksLocations: { rooms: [], tracks: [], locations: [], formats: [] },
    contentWorkflow: {},
    widgets: [],
    crm: { handoffDefaults: {}, customFields: [] },
  };
}

function normalizeConfiguration(value: Row): Configuration {
  const source = (value.source ?? {}) as Row;
  const fallback = emptyConfiguration(String(source.name ?? "Template"));
  const review = (value.review ?? {}) as Row;
  const routing = (review.routing ?? {}) as Row;
  const crm = (value.crm ?? {}) as Row;
  const communications = value.communications;
  return {
    ...fallback,
    ...(value as Partial<Configuration>),
    source: { ...fallback.source, ...(source as Configuration["source"]) },
    review: {
      rounds: Array.isArray(review.rounds) ? review.rounds : [],
      scorecards: Array.isArray(review.scorecards) ? review.scorecards : [],
      reviewers: Array.isArray(review.reviewers) ? review.reviewers : [],
      tags: Array.isArray(review.tags) ? review.tags : [],
      routing: {
        legacy:
          routing.legacy ??
          (review.routing && !Array.isArray(review.routing)
            ? review.routing
            : (crm.reviewerRouting ?? {})),
        rules: Array.isArray(routing.rules) ? routing.rules : [],
        groups: Array.isArray(routing.groups) ? routing.groups : [],
        conditions: Array.isArray(routing.conditions) ? routing.conditions : [],
        excludedReviewers: Array.isArray(routing.excludedReviewers)
          ? routing.excludedReviewers
          : [],
        ruleTags: Array.isArray(routing.ruleTags) ? routing.ruleTags : [],
      },
    },
    communications: Array.isArray(communications)
      ? {
          templates: communications,
          reminderRules: Array.isArray(crm.reminderRules)
            ? crm.reminderRules
            : [],
        }
      : {
          templates: Array.isArray((communications as Row)?.templates)
            ? ((communications as Row).templates as Row[])
            : [],
          reminderRules: Array.isArray((communications as Row)?.reminderRules)
            ? ((communications as Row).reminderRules as unknown[])
            : [],
        },
    crm: {
      handoffDefaults: crm.handoffDefaults ?? crm.crmHandoffDefaults ?? {},
      customFields: Array.isArray(crm.customFields)
        ? (crm.customFields as Row[])
        : [],
    },
  };
}

export function starterConfiguration(id: string): Configuration {
  const config = emptyConfiguration(starterName(id));
  const formId = "starter-form",
    roundId = "starter-round";
  config.event.eventType =
    id === "meetup" ? "meetup" : id === "workshop" ? "workshop" : "conference";
  config.cfp.forms = [
    {
      id: formId,
      name:
        id === "community-cfp"
          ? "Community call for proposals"
          : "Call for proposals",
      slug: "cfp",
      description: starterDescriptions[id],
      opensAt: "2030-04-01T16:00:00.000Z",
      closesAt: "2030-05-01T23:59:00.000Z",
      editClosesAt: "2030-05-03T23:59:00.000Z",
      allowDrafts: 1,
    },
  ];
  const fields =
    id === "workshop"
      ? [
          ["title", "Session title", "text"],
          ["abstract", "Learning outcomes", "textarea"],
          ["prerequisites", "Prerequisites", "textarea"],
          ["capacity", "Ideal capacity", "number"],
        ]
      : [
          ["title", "Session title", "text"],
          ["abstract", "Abstract", "textarea"],
          ["format", "Format", "select"],
          ["speaker_support", "Speaker support requested", "textarea"],
        ];
  config.cfp.fields = fields.map(([key, label, type], position) => ({
    id: `field-${key}`,
    formId,
    section: key === "title" || key === "abstract" ? "session" : "custom",
    fieldType: type,
    fieldKey: key,
    label,
    required: key === "title" || key === "abstract" ? 1 : 0,
    optionsJson:
      key === "format"
        ? JSON.stringify([
            "Talk (30 min)",
            "Workshop (60 min)",
            "Panel (45 min)",
          ])
        : null,
    position,
    searchable: key !== "speaker_support" ? 1 : 0,
  }));
  config.review.rounds = [
    {
      id: roundId,
      name: "Program review",
      position: 0,
      isBlind: id === "community-cfp" ? 1 : 0,
      opensAt: "2030-05-02T16:00:00.000Z",
      closesAt: "2030-05-16T23:59:00.000Z",
    },
  ];
  config.review.scorecards = [
    {
      id: "score-relevance",
      roundId,
      label: "Audience relevance",
      fieldType: "numeric",
      minValue: 1,
      maxValue: 5,
      weight: 1,
      required: 1,
      position: 0,
    },
    {
      id: "score-clarity",
      roundId,
      label: "Clarity",
      fieldType: "numeric",
      minValue: 1,
      maxValue: 5,
      weight: 1,
      required: 1,
      position: 1,
    },
  ];
  config.onboarding = [
    {
      id: "task-profile",
      title: "Complete speaker profile",
      description: "Add bio and current profile details.",
      taskType: "form",
      dueAt: "2030-05-25T23:59:00.000Z",
      position: 0,
    },
    {
      id: "task-headshot",
      title: "Upload headshot",
      taskType: "file_request",
      dueAt: "2030-05-25T23:59:00.000Z",
      position: 1,
    },
    {
      id: "task-slides",
      title: "Upload final slides",
      taskType: "file_request",
      dueAt: "2030-06-08T23:59:00.000Z",
      position: 2,
    },
  ];
  config.resources = [
    {
      id: "resource-guide",
      title: "Speaker guide",
      bodyHtml:
        "<h2>Welcome</h2><p>Use this page for event-specific speaker guidance.</p>",
      position: 0,
    },
  ];
  config.communications = {
    templates: [
      {
        id: "template-reviewer",
        category: "reviewer_invitation",
        name: "Reviewer invitation",
        subject: "Review proposals for {{event.name}}",
        bodyHtml:
          "<p>Hello {{recipient.name}},</p><p>You are invited to review proposals for {{event.name}}.</p>",
        bodyText:
          "Hello {{recipient.name}},\n\nYou are invited to review proposals for {{event.name}}.",
        mergeFieldsJson: JSON.stringify(["recipient.name", "event.name"]),
        enabled: 1,
      },
      {
        id: "template-acceptance",
        category: "decision_acceptance",
        name: "Acceptance decision",
        subject: "Your proposal for {{event.name}}",
        bodyHtml:
          "<p>Hello {{recipient.name}},</p><p>We are delighted to accept {{submission.title}}.</p>",
        bodyText:
          "Hello {{recipient.name}},\n\nWe are delighted to accept {{submission.title}}.",
        mergeFieldsJson: JSON.stringify([
          "recipient.name",
          "event.name",
          "submission.title",
        ]),
        enabled: 1,
      },
      {
        id: "template-speaker",
        category: "speaker_invitation",
        name: "Speaker portal invitation",
        subject: "Your {{event.name}} speaker portal",
        bodyHtml:
          "<p>Hello {{recipient.name}},</p><p>Open your secure speaker portal: {{portal.url}}</p>",
        bodyText:
          "Hello {{recipient.name}},\n\nOpen your secure speaker portal: {{portal.url}}",
        mergeFieldsJson: JSON.stringify([
          "recipient.name",
          "event.name",
          "portal.url",
        ]),
        enabled: 1,
      },
    ],
    reminderRules: [
      {
        category: "reviewer_reminder",
        offsetDays: -3,
        relativeTo: "review_round.closes_at",
        enabled: true,
      },
    ],
  };
  config.roomsTracksLocations = {
    rooms:
      id === "conference"
        ? [
            { id: "room-main", name: "Main stage", capacity: 300, position: 0 },
            {
              id: "room-breakout",
              name: "Breakout room",
              capacity: 80,
              position: 1,
            },
          ]
        : [
            {
              id: "room-main",
              name: "Program room",
              capacity: null,
              position: 0,
            },
          ],
    tracks:
      id === "conference"
        ? [
            {
              id: "track-main",
              name: "Main program",
              slug: "main",
              color: "#315c45",
              position: 0,
            },
            {
              id: "track-community",
              name: "Community",
              slug: "community",
              color: "#6c4aa1",
              position: 1,
            },
          ]
        : [
            {
              id: "track-main",
              name: "General",
              slug: "general",
              color: "#315c45",
              position: 0,
            },
          ],
    locations: [],
    formats:
      id === "workshop"
        ? ["Workshop (60 min)", "Workshop (90 min)"]
        : ["Talk (30 min)", "Panel (45 min)"],
  };
  config.contentWorkflow = { fileUploadsEnabled: 1, requiresApproval: true };
  config.review.routing.legacy = { strategy: "manual" };
  config.crm = {
    handoffDefaults: { createContactOnAcceptance: true },
    customFields: [
      {
        id: "crm-field-speaker-type",
        name: "Speaker type",
        fieldType: "select",
        optionsJson: JSON.stringify(["Community", "Invited", "Sponsor"]),
        position: 0,
      },
    ],
  };
  return config;
}

function starterName(id: string) {
  return id === "community-cfp"
    ? "Community CFP"
    : id.charAt(0).toUpperCase() + id.slice(1);
}
function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function remapRoutingValue(
  valueJson: unknown,
  ids: Map<string, string> | undefined,
) {
  if (!ids || valueJson === null || valueJson === undefined)
    return valueJson ?? null;
  const value =
    typeof valueJson === "string" ? parseJson(valueJson, valueJson) : valueJson;
  const remap = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(remap)
      : typeof item === "string"
        ? (ids.get(item) ?? item)
        : item;
  return JSON.stringify(remap(value));
}

function objectSize(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

export default router;
