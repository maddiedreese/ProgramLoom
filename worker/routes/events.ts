import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import { database, HttpError, normalizeSlug, requireEventRole } from "../lib/authz";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const organizerRoles = ["owner", "admin"] as const;

const trackSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().max(64).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#315c45"),
  description: z.string().trim().max(1000).optional(),
});

const formShape = {
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(64).optional(),
  description: z.string().trim().max(5000).optional(),
  opensAt: z.iso.datetime({ offset: true }).nullable().optional(),
  closesAt: z.iso.datetime({ offset: true }).nullable().optional(),
  editClosesAt: z.iso.datetime({ offset: true }).nullable().optional(),
  allowDrafts: z.boolean().default(true),
  submissionLimit: z.number().int().min(1).max(100).nullable().optional(),
  confirmationSubject: z.string().trim().max(180).optional(),
  confirmationBody: z.string().trim().max(10000).optional(),
};
function refineDeadlines(value: { opensAt?: string | null; closesAt?: string | null; editClosesAt?: string | null }, context: z.RefinementCtx) {
  if (value.opensAt && value.closesAt && value.opensAt >= value.closesAt) context.addIssue({ code: "custom", path: ["closesAt"], message: "The close time must be after the open time." });
  if (value.closesAt && value.editClosesAt && value.closesAt > value.editClosesAt) context.addIssue({ code: "custom", path: ["editClosesAt"], message: "The edit deadline cannot be before the submission deadline." });
}
const formSchema = z.object(formShape).superRefine(refineDeadlines);

const formPatchSchema = z.object(formShape).partial().extend({ published: z.boolean().optional() }).superRefine(refineDeadlines);
const fieldTypes = ["text", "textarea", "number", "email", "url", "select", "multiselect", "checkbox", "date", "file"] as const;
const fieldShape = {
  section: z.enum(["welcome", "session", "speaker", "custom"]),
  fieldType: z.enum(fieldTypes),
  fieldKey: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  placeholder: z.string().trim().max(240).optional(),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  validation: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  position: z.number().int().min(0).max(1000).optional(),
};
const fieldSchema = z.object(fieldShape).superRefine((value, context) => {
  if (["select", "multiselect"].includes(value.fieldType) && (!value.options || value.options.length < 1)) context.addIssue({ code: "custom", path: ["options"], message: "Select fields need at least one option." });
});
const fieldPatchSchema = z.object(fieldShape).partial().superRefine((value, context) => {
  if (value.fieldType && ["select", "multiselect"].includes(value.fieldType) && value.options !== undefined && value.options.length < 1) context.addIssue({ code: "custom", path: ["options"], message: "Select fields need at least one option." });
});

const conditionSchema = z.object({
  sourceFieldId: z.string().uuid(),
  operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "is_checked"]),
  compareValue: z.unknown().optional(),
  targetFieldId: z.string().uuid(),
  action: z.enum(["show", "hide", "require"]),
}).refine((value) => value.sourceFieldId !== value.targetFieldId, { message: "A field cannot control itself.", path: ["targetFieldId"] });
const submissionStatusSchema = z.object({ status: z.enum(["pending", "accepted_queue", "accepted", "decline_queue", "declined", "withdrawn"]) });

function formSelect() {
  return `SELECT f.id, f.event_id AS eventId, f.name, f.slug, f.description,
                 f.opens_at AS opensAt, f.closes_at AS closesAt, f.edit_closes_at AS editClosesAt,
                 f.allow_drafts AS allowDrafts, f.submission_limit AS submissionLimit,
                 f.confirmation_subject AS confirmationSubject, f.confirmation_body AS confirmationBody,
                 f.published_at AS publishedAt, f.created_at AS createdAt, f.updated_at AS updatedAt,
                 COUNT(ff.id) AS fieldCount
          FROM cfp_forms f LEFT JOIN form_fields ff ON ff.form_id = f.id`;
}

async function requireForm(context: Parameters<typeof requireEventRole>[0], eventId: string, formId: string) {
  const form = await database(context.env).prepare("SELECT id FROM cfp_forms WHERE id = ? AND event_id = ?").bind(formId, eventId).first();
  if (!form) throw new HttpError(404, "form_not_found", "CFP form not found.");
}

router.get("/:eventId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, ["owner", "admin", "reviewer", "speaker"]);
  const event = await database(context.env).prepare(
    `SELECT e.id, e.organization_id AS organizationId, e.name, e.slug, e.event_type AS eventType,
            e.timezone, e.starts_at AS startsAt, e.ends_at AS endsAt, e.venue_name AS venueName,
            e.website_url AS websiteUrl, e.status, o.name AS organizationName, o.slug AS organizationSlug, o.storage_mode AS storageMode
     FROM events e JOIN organizations o ON o.id = e.organization_id WHERE e.id = ?`,
  ).bind(eventId).first();
  return context.json({ event, role: access.role });
});

router.get("/:eventId/tracks", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, ["owner", "admin", "reviewer", "speaker"]);
  const tracks = await database(context.env).prepare("SELECT id, name, slug, color, description, position FROM tracks WHERE event_id = ? ORDER BY position, name").bind(eventId).all();
  return context.json({ tracks: tracks.results });
});

router.post("/:eventId/tracks", zValidator("json", trackSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const input = context.req.valid("json");
  const slug = normalizeSlug(input.slug || input.name);
  if (!slug) throw new HttpError(400, "invalid_slug", "Choose a track name containing letters or numbers.");
  const db = database(context.env);
  const duplicate = await db.prepare("SELECT id FROM tracks WHERE event_id = ? AND slug = ? COLLATE NOCASE").bind(eventId, slug).first();
  if (duplicate) throw new HttpError(409, "slug_taken", "That track already exists.");
  const id = crypto.randomUUID();
  const position = Number((await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tracks WHERE event_id = ?").bind(eventId).first<{ position: number }>())?.position ?? 0);
  const track = { id, name: input.name, slug, color: input.color, description: input.description ?? null, position };
  await db.batch([
    db.prepare("INSERT INTO tracks (id, event_id, name, slug, color, description, position) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, eventId, input.name, slug, input.color, input.description ?? null, position),
    auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "track.created", entityType: "track", entityId: id, after: track, requestId: context.get("requestId") }),
  ]);
  return context.json({ track }, 201);
});

router.get("/:eventId/forms", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, ["owner", "admin", "reviewer"]);
  const forms = await database(context.env).prepare(`${formSelect()} WHERE f.event_id = ? GROUP BY f.id ORDER BY f.created_at DESC`).bind(eventId).all();
  return context.json({ forms: forms.results });
});

router.post("/:eventId/forms", zValidator("json", formSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const input = context.req.valid("json");
  const slug = normalizeSlug(input.slug || input.name);
  if (!slug) throw new HttpError(400, "invalid_slug", "Choose a form name containing letters or numbers.");
  const db = database(context.env);
  if (await db.prepare("SELECT id FROM cfp_forms WHERE event_id = ? AND slug = ? COLLATE NOCASE").bind(eventId, slug).first()) throw new HttpError(409, "slug_taken", "That form URL is already in use.");
  const id = crypto.randomUUID();
  const form = { id, eventId, name: input.name, slug, description: input.description ?? null, opensAt: input.opensAt ?? null, closesAt: input.closesAt ?? null, editClosesAt: input.editClosesAt ?? null, allowDrafts: input.allowDrafts, submissionLimit: input.submissionLimit ?? null, confirmationSubject: input.confirmationSubject ?? null, confirmationBody: input.confirmationBody ?? null, publishedAt: null, fieldCount: 0 };
  await db.batch([
    db.prepare(`INSERT INTO cfp_forms (id, event_id, name, slug, description, opens_at, closes_at, edit_closes_at, allow_drafts, submission_limit, confirmation_subject, confirmation_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, eventId, input.name, slug, input.description ?? null, input.opensAt ?? null, input.closesAt ?? null, input.editClosesAt ?? null, input.allowDrafts ? 1 : 0, input.submissionLimit ?? null, input.confirmationSubject ?? null, input.confirmationBody ?? null),
    auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "cfp_form.created", entityType: "cfp_form", entityId: id, after: form, requestId: context.get("requestId") }),
  ]);
  return context.json({ form }, 201);
});

router.get("/:eventId/forms/:formId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, ["owner", "admin", "reviewer"]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const db = database(context.env);
  const form = await db.prepare(`${formSelect()} WHERE f.id = ? GROUP BY f.id`).bind(formId).first();
  const fields = await db.prepare(`SELECT id, section, field_type AS fieldType, field_key AS fieldKey, label, description, placeholder, required, options_json AS optionsJson, validation_json AS validationJson, position FROM form_fields WHERE form_id = ? ORDER BY position, id`).bind(formId).all();
  const conditions = await db.prepare(`SELECT id, source_field_id AS sourceFieldId, operator, compare_value_json AS compareValueJson, target_field_id AS targetFieldId, action FROM form_conditions WHERE form_id = ? ORDER BY id`).bind(formId).all();
  return context.json({ form, fields: fields.results.map((field: Record<string, unknown>) => ({ ...field, required: Boolean(field.required), options: field.optionsJson ? JSON.parse(String(field.optionsJson)) : undefined, validation: field.validationJson ? JSON.parse(String(field.validationJson)) : undefined, optionsJson: undefined, validationJson: undefined })), conditions: conditions.results.map((condition: Record<string, unknown>) => ({ ...condition, compareValue: condition.compareValueJson ? JSON.parse(String(condition.compareValueJson)) : undefined, compareValueJson: undefined })) });
});

router.patch("/:eventId/forms/:formId", zValidator("json", formPatchSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const input = context.req.valid("json");
  const db = database(context.env);
  const current = await db.prepare("SELECT name, opens_at AS opensAt, closes_at AS closesAt, edit_closes_at AS editClosesAt FROM cfp_forms WHERE id = ?").bind(formId).first<{ name: string; opensAt: string | null; closesAt: string | null; editClosesAt: string | null }>();
  const effective = {
    opensAt: input.opensAt === undefined ? current?.opensAt : input.opensAt,
    closesAt: input.closesAt === undefined ? current?.closesAt : input.closesAt,
    editClosesAt: input.editClosesAt === undefined ? current?.editClosesAt : input.editClosesAt,
  };
  if (effective.opensAt && effective.closesAt && effective.opensAt >= effective.closesAt) throw new HttpError(400, "invalid_deadline", "The close time must be after the open time.");
  if (effective.closesAt && effective.editClosesAt && effective.closesAt > effective.editClosesAt) throw new HttpError(400, "invalid_edit_deadline", "The edit deadline cannot be before the submission deadline.");
  if (input.published) {
    const count = await db.prepare("SELECT COUNT(*) AS count FROM form_fields WHERE form_id = ?").bind(formId).first<{ count: number }>();
    if (!count?.count) throw new HttpError(400, "form_incomplete", "Add at least one field before publishing.");
    if (effective.closesAt && effective.closesAt <= new Date().toISOString()) throw new HttpError(400, "deadline_passed", "Choose a future submission deadline before publishing.");
  }
  const fields: [string, unknown][] = [];
  const mapping: Record<string, string> = { name: "name", slug: "slug", description: "description", opensAt: "opens_at", closesAt: "closes_at", editClosesAt: "edit_closes_at", allowDrafts: "allow_drafts", submissionLimit: "submission_limit", confirmationSubject: "confirmation_subject", confirmationBody: "confirmation_body" };
  for (const [key, column] of Object.entries(mapping)) if (key in input) fields.push([column, key === "allowDrafts" ? (input.allowDrafts ? 1 : 0) : input[key as keyof typeof input] ?? null]);
  if (input.slug !== undefined) {
    const slug = normalizeSlug(input.slug);
    if (!slug) throw new HttpError(400, "invalid_slug", "Choose a form URL containing letters or numbers.");
    fields.splice(fields.findIndex(([column]) => column === "slug"), 1, ["slug", slug]);
    const duplicate = await db.prepare("SELECT id FROM cfp_forms WHERE event_id = ? AND slug = ? COLLATE NOCASE AND id != ?").bind(eventId, slug, formId).first();
    if (duplicate) throw new HttpError(409, "slug_taken", "That form URL is already in use.");
  }
  if (input.published !== undefined) fields.push(["published_at", input.published ? new Date().toISOString() : null]);
  fields.push(["updated_at", new Date().toISOString()]);
  await db.prepare(`UPDATE cfp_forms SET ${fields.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, value]) => value), formId).run();
  await auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: input.published === true ? "cfp_form.published" : input.published === false ? "cfp_form.unpublished" : "cfp_form.updated", entityType: "cfp_form", entityId: formId, after: input, requestId: context.get("requestId") }).run();
  const form = await db.prepare(`${formSelect()} WHERE f.id = ? GROUP BY f.id`).bind(formId).first();
  return context.json({ form });
});

router.delete("/:eventId/forms/:formId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const db = database(context.env);
  const submissionCount = await db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE form_id = ?").bind(formId).first<{ count: number }>();
  if (submissionCount?.count) throw new HttpError(409, "form_has_submissions", "Archive this form instead; forms with submissions cannot be deleted.");
  await db.batch([db.prepare("DELETE FROM cfp_forms WHERE id = ?").bind(formId), auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "cfp_form.deleted", entityType: "cfp_form", entityId: formId, requestId: context.get("requestId") })]);
  return context.body(null, 204);
});

router.post("/:eventId/forms/:formId/fields", zValidator("json", fieldSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const input = context.req.valid("json");
  const fieldKey = normalizeSlug(input.fieldKey).replace(/-/g, "_");
  if (!fieldKey) throw new HttpError(400, "invalid_field_key", "Choose a valid field key.");
  const db = database(context.env);
  if (await db.prepare("SELECT id FROM form_fields WHERE form_id = ? AND field_key = ? COLLATE NOCASE").bind(formId, fieldKey).first()) throw new HttpError(409, "field_key_taken", "That field key is already in use.");
  const id = crypto.randomUUID();
  const position = input.position ?? Number((await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM form_fields WHERE form_id = ?").bind(formId).first<{ position: number }>())?.position ?? 0);
  const field = { id, ...input, fieldKey, description: input.description ?? null, placeholder: input.placeholder ?? null, options: input.options, validation: input.validation, position };
  await db.batch([
    db.prepare(`INSERT INTO form_fields (id, form_id, section, field_type, field_key, label, description, placeholder, required, options_json, validation_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, formId, input.section, input.fieldType, fieldKey, input.label, input.description ?? null, input.placeholder ?? null, input.required ? 1 : 0, input.options ? JSON.stringify(input.options) : null, input.validation ? JSON.stringify(input.validation) : null, position),
    auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "form_field.created", entityType: "form_field", entityId: id, after: field, requestId: context.get("requestId") }),
  ]);
  return context.json({ field }, 201);
});

router.patch("/:eventId/forms/:formId/fields/:fieldId", zValidator("json", fieldPatchSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const fieldId = context.req.param("fieldId");
  const db = database(context.env);
  if (!await db.prepare("SELECT id FROM form_fields WHERE id = ? AND form_id = ?").bind(fieldId, formId).first()) throw new HttpError(404, "field_not_found", "Field not found.");
  const input = context.req.valid("json");
  const mapping: Record<string, string> = { section: "section", fieldType: "field_type", fieldKey: "field_key", label: "label", description: "description", placeholder: "placeholder", required: "required", options: "options_json", validation: "validation_json", position: "position" };
  const fields: [string, unknown][] = [];
  for (const [key, column] of Object.entries(mapping)) if (key in input) {
    let value = input[key as keyof typeof input] ?? null;
    if (key === "required") value = input.required ? 1 : 0;
    if (key === "options" || key === "validation") value = value === null ? null : JSON.stringify(value);
    if (key === "fieldKey") value = normalizeSlug(String(value)).replace(/-/g, "_");
    fields.push([column, value]);
  }
  if (!fields.length) return context.json({ field: { id: fieldId } });
  try { await db.prepare(`UPDATE form_fields SET ${fields.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, value]) => value), fieldId).run(); }
  catch { throw new HttpError(409, "field_key_taken", "That field key is already in use."); }
  await auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "form_field.updated", entityType: "form_field", entityId: fieldId, after: input, requestId: context.get("requestId") }).run();
  return context.json({ field: { id: fieldId, ...input } });
});

router.delete("/:eventId/forms/:formId/fields/:fieldId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const fieldId = context.req.param("fieldId");
  const db = database(context.env);
  const result = await db.prepare("DELETE FROM form_fields WHERE id = ? AND form_id = ?").bind(fieldId, formId).run();
  if (!result.meta.changes) throw new HttpError(404, "field_not_found", "Field not found.");
  await auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "form_field.deleted", entityType: "form_field", entityId: fieldId, requestId: context.get("requestId") }).run();
  return context.body(null, 204);
});

router.post("/:eventId/forms/:formId/conditions", zValidator("json", conditionSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const input = context.req.valid("json");
  const db = database(context.env);
  const fields = await db.prepare("SELECT COUNT(*) AS count FROM form_fields WHERE form_id = ? AND id IN (?, ?)").bind(formId, input.sourceFieldId, input.targetFieldId).first<{ count: number }>();
  if (fields?.count !== 2) throw new HttpError(400, "invalid_condition_fields", "Both conditional fields must belong to this form.");
  const id = crypto.randomUUID();
  const condition = { id, ...input };
  await db.batch([
    db.prepare("INSERT INTO form_conditions (id, form_id, source_field_id, operator, compare_value_json, target_field_id, action) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, formId, input.sourceFieldId, input.operator, input.compareValue === undefined ? null : JSON.stringify(input.compareValue), input.targetFieldId, input.action),
    auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "form_condition.created", entityType: "form_condition", entityId: id, after: condition, requestId: context.get("requestId") }),
  ]);
  return context.json({ condition }, 201);
});

router.delete("/:eventId/forms/:formId/conditions/:conditionId", async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const formId = context.req.param("formId");
  await requireForm(context, eventId, formId);
  const conditionId = context.req.param("conditionId");
  const db = database(context.env);
  const result = await db.prepare("DELETE FROM form_conditions WHERE id = ? AND form_id = ?").bind(conditionId, formId).run();
  if (!result.meta.changes) throw new HttpError(404, "condition_not_found", "Condition not found.");
  await auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "form_condition.deleted", entityType: "form_condition", entityId: conditionId, requestId: context.get("requestId") }).run();
  return context.body(null, 204);
});

router.get("/:eventId/submissions", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const status = context.req.query("status");
  const formId = context.req.query("formId");
  const query = context.req.query("query")?.trim();
  const clauses = ["s.event_id = ?"];
  const values: unknown[] = [eventId];
  if (status && status !== "all") { clauses.push("s.status = ?"); values.push(status); }
  if (formId) { clauses.push("s.form_id = ?"); values.push(formId); }
  if (query) { clauses.push("(s.title LIKE ? OR p.name LIKE ? OR p.email LIKE ?)"); const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`; values.push(pattern, pattern, pattern); }
  const submissions = await database(context.env).prepare(
    `SELECT s.id, s.form_id AS formId, f.name AS formName, s.title, s.abstract, s.status,
            s.submitted_at AS submittedAt, s.updated_at AS updatedAt,
            p.name AS submitterName, p.email AS submitterEmail, p.organization AS submitterOrganization,
            COUNT(DISTINCT ra.id) AS reviewCount, COUNT(DISTINCT CASE WHEN r.submitted_at IS NOT NULL THEN r.id END) AS completedReviewCount,
            ROUND(AVG(CASE WHEN r.submitted_at IS NOT NULL THEN r.weighted_score END), 2) AS averageScore
     FROM submissions s JOIN cfp_forms f ON f.id = s.form_id
     LEFT JOIN submission_people p ON p.submission_id = s.id AND p.role = 'primary'
     LEFT JOIN review_assignments ra ON ra.submission_id = s.id AND ra.recused_at IS NULL
     LEFT JOIN reviews r ON r.assignment_id = ra.id
     WHERE ${clauses.join(" AND ")}
     GROUP BY s.id ORDER BY COALESCE(s.submitted_at, s.updated_at) DESC`,
  ).bind(...values).all();
  const counts = await database(context.env).prepare("SELECT status, COUNT(*) AS count FROM submissions WHERE event_id = ? GROUP BY status").bind(eventId).all();
  return context.json({ submissions: submissions.results, counts: Object.fromEntries(counts.results.map((row: Record<string, unknown>) => [String(row.status), Number(row.count)])) });
});

router.get("/:eventId/submissions/:submissionId", async (context) => {
  const eventId = context.req.param("eventId");
  await requireEventRole(context, eventId, [...organizerRoles]);
  const db = database(context.env);
  const submission = await db.prepare(
    `SELECT s.id, s.form_id AS formId, f.name AS formName, s.title, s.abstract, s.format,
            s.duration_minutes AS durationMinutes, s.status, s.answers_json AS answersJson,
            s.submitted_at AS submittedAt, s.created_at AS createdAt, s.updated_at AS updatedAt
     FROM submissions s JOIN cfp_forms f ON f.id = s.form_id WHERE s.id = ? AND s.event_id = ?`,
  ).bind(context.req.param("submissionId"), eventId).first<Record<string, unknown>>();
  if (!submission) throw new HttpError(404, "submission_not_found", "Submission not found.");
  const people = await db.prepare("SELECT id, email, name, role, organization, position FROM submission_people WHERE submission_id = ? ORDER BY position, id").bind(submission.id).all();
  const fields = await db.prepare("SELECT field_key AS fieldKey, label, field_type AS fieldType, section, position FROM form_fields WHERE form_id = ? ORDER BY position, id").bind(submission.formId).all();
  const history = await db.prepare("SELECT action, after_json AS afterJson, created_at AS createdAt FROM audit_events WHERE event_id = ? AND entity_type = 'submission' AND entity_id = ? ORDER BY created_at DESC").bind(eventId, submission.id).all();
  return context.json({ submission: { ...submission, answers: JSON.parse(String(submission.answersJson)), answersJson: undefined }, people: people.results, fields: fields.results, history: history.results.map((item: Record<string, unknown>) => ({ ...item, after: item.afterJson ? JSON.parse(String(item.afterJson)) : undefined, afterJson: undefined })) });
});

router.patch("/:eventId/submissions/:submissionId/status", zValidator("json", submissionStatusSchema), async (context) => {
  const eventId = context.req.param("eventId");
  const access = await requireEventRole(context, eventId, [...organizerRoles]);
  const submissionId = context.req.param("submissionId");
  const { status } = context.req.valid("json");
  const db = database(context.env);
  const current = await db.prepare("SELECT status FROM submissions WHERE id = ? AND event_id = ?").bind(submissionId, eventId).first<{ status: string }>();
  if (!current) throw new HttpError(404, "submission_not_found", "Submission not found.");
  if (current.status === status) return context.json({ submission: { id: submissionId, status } });
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, submissionId),
    auditStatement(db, { organizationId: access.organizationId, eventId, actorUserId: access.user.id, action: "submission.status_changed", entityType: "submission", entityId: submissionId, after: { from: current.status, to: status }, requestId: context.get("requestId") }),
  ]);
  return context.json({ submission: { id: submissionId, status, updatedAt: now } });
});

export default router;
