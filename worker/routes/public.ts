import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { database, HttpError } from "../lib/authz";
import { randomToken, sha256 } from "../lib/crypto";
import { sendSubmissionConfirmation } from "../lib/email";
import { verifyTurnstile } from "../lib/turnstile";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const route = "/cfp/:organizationSlug/:eventSlug/:formSlug";

const submissionSchema = z.object({
  submitter: z.object({ name: z.string().trim().min(2).max(160), email: z.email().transform((email) => email.trim().toLowerCase()), organization: z.string().trim().max(160).optional() }),
  answers: z.record(z.string(), z.unknown()),
  action: z.enum(["draft", "submit"]),
  editToken: z.string().min(32).max(200).optional(),
  turnstileToken: z.string().optional(),
}).superRefine((value, context) => {
  if (Object.keys(value.answers).length > 200) context.addIssue({ code: "custom", path: ["answers"], message: "This form contains too many answers." });
  if (JSON.stringify(value.answers).length > 200_000) context.addIssue({ code: "custom", path: ["answers"], message: "The submitted answers are too large." });
});

type FormRecord = {
  id: string; eventId: string; organizationId: string; organizationName: string; eventName: string; eventSlug: string;
  timezone: string; primaryColor: string; name: string; slug: string; description: string | null; opensAt: string | null;
  closesAt: string | null; editClosesAt: string | null; allowDrafts: number; submissionLimit: number | null;
  confirmationSubject: string | null; confirmationBody: string | null; publishedAt: string | null;
};
type FieldRecord = { id: string; section: string; fieldType: string; fieldKey: string; label: string; description: string | null; placeholder: string | null; required: number; optionsJson: string | null; validationJson: string | null; position: number };
type ConditionRecord = { id: string; sourceFieldId: string; operator: string; compareValueJson: string | null; targetFieldId: string; action: "show" | "hide" | "require" };

async function publicForm(db: D1Database, organizationSlug: string, eventSlug: string, formSlug: string): Promise<FormRecord> {
  const form = await db.prepare(
    `SELECT f.id, f.event_id AS eventId, e.organization_id AS organizationId, o.name AS organizationName,
            e.name AS eventName, e.slug AS eventSlug, e.timezone, e.primary_color AS primaryColor,
            f.name, f.slug, f.description, f.opens_at AS opensAt, f.closes_at AS closesAt,
            f.edit_closes_at AS editClosesAt, f.allow_drafts AS allowDrafts, f.submission_limit AS submissionLimit,
            f.confirmation_subject AS confirmationSubject, f.confirmation_body AS confirmationBody, f.published_at AS publishedAt
     FROM cfp_forms f JOIN events e ON e.id = f.event_id JOIN organizations o ON o.id = e.organization_id
     WHERE o.slug = ? COLLATE NOCASE AND e.slug = ? COLLATE NOCASE AND f.slug = ? COLLATE NOCASE`,
  ).bind(organizationSlug, eventSlug, formSlug).first<FormRecord>();
  if (!form || !form.publishedAt) throw new HttpError(404, "cfp_not_found", "This call for proposals is not available.");
  return form;
}

async function formDefinition(db: D1Database, formId: string) {
  const fieldsResult = await db.prepare(`SELECT id, section, field_type AS fieldType, field_key AS fieldKey, label, description, placeholder, required, options_json AS optionsJson, validation_json AS validationJson, position FROM form_fields WHERE form_id = ? ORDER BY position, id`).bind(formId).all<FieldRecord>();
  const conditionsResult = await db.prepare(`SELECT id, source_field_id AS sourceFieldId, operator, compare_value_json AS compareValueJson, target_field_id AS targetFieldId, action FROM form_conditions WHERE form_id = ? ORDER BY id`).bind(formId).all<ConditionRecord>();
  const fields = fieldsResult.results.map((field) => ({ ...field, required: Boolean(field.required), options: field.optionsJson ? JSON.parse(field.optionsJson) : undefined, validation: field.validationJson ? JSON.parse(field.validationJson) : undefined, optionsJson: undefined, validationJson: undefined }));
  const conditions = conditionsResult.results.map((condition) => ({ ...condition, compareValue: condition.compareValueJson ? JSON.parse(condition.compareValueJson) : undefined, compareValueJson: undefined }));
  return { fields, conditions };
}

function availability(form: FormRecord) {
  const now = new Date().toISOString();
  if (form.opensAt && now < form.opensAt) return "upcoming" as const;
  if (form.closesAt && now > form.closesAt) return "closed" as const;
  return "open" as const;
}

export function matches(operator: string, actual: unknown, expected: unknown) {
  if (operator === "is_checked") return actual === true;
  if (operator === "equals") return String(actual ?? "") === String(expected ?? "");
  if (operator === "not_equals") return String(actual ?? "") !== String(expected ?? "");
  if (operator === "contains") return Array.isArray(actual) ? actual.map(String).includes(String(expected)) : String(actual ?? "").includes(String(expected ?? ""));
  if (operator === "greater_than") return Number(actual) > Number(expected);
  if (operator === "less_than") return Number(actual) < Number(expected);
  return false;
}

export function validateAnswers(fields: Awaited<ReturnType<typeof formDefinition>>["fields"], conditions: Awaited<ReturnType<typeof formDefinition>>["conditions"], answers: Record<string, unknown>) {
  const keyById = new Map(fields.map((field) => [field.id, field.fieldKey]));
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const showRules = conditions.filter((condition) => condition.targetFieldId === field.id && condition.action === "show");
    const hiddenByRule = conditions.some((condition) => condition.targetFieldId === field.id && condition.action === "hide" && matches(condition.operator, answers[keyById.get(condition.sourceFieldId) ?? ""], condition.compareValue));
    const visible = !hiddenByRule && (!showRules.length || showRules.some((condition) => matches(condition.operator, answers[keyById.get(condition.sourceFieldId) ?? ""], condition.compareValue)));
    if (!visible) continue;
    const conditionallyRequired = conditions.some((condition) => condition.targetFieldId === field.id && condition.action === "require" && matches(condition.operator, answers[keyById.get(condition.sourceFieldId) ?? ""], condition.compareValue));
    const value = answers[field.fieldKey];
    const missing = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || value === false;
    if ((field.required || conditionallyRequired) && missing) { errors[field.fieldKey] = `${field.label} is required.`; continue; }
    if (missing) continue;
    if (field.fieldType === "email" && !z.email().safeParse(value).success) errors[field.fieldKey] = "Enter a valid email address.";
    if (field.fieldType === "url" && !z.url().safeParse(value).success) errors[field.fieldKey] = "Enter a complete URL.";
    if (field.fieldType === "number" && !Number.isFinite(Number(value))) errors[field.fieldKey] = "Enter a valid number.";
    if (field.fieldType === "select" && field.options && !field.options.includes(String(value))) errors[field.fieldKey] = "Choose one of the available options.";
    if (field.fieldType === "multiselect" && field.options && (!Array.isArray(value) || value.some((item) => !field.options?.includes(String(item))))) errors[field.fieldKey] = "Choose only available options.";
  }
  return errors;
}

router.get(`${route}`, async (context) => {
  const db = database(context.env);
  const form = await publicForm(db, context.req.param("organizationSlug"), context.req.param("eventSlug"), context.req.param("formSlug"));
  const definition = await formDefinition(db, form.id);
  return context.json({ form: { ...form, allowDrafts: Boolean(form.allowDrafts), availability: availability(form) }, ...definition });
});

router.post(`${route}/submissions`, zValidator("json", submissionSchema), async (context) => {
  const db = database(context.env);
  const form = await publicForm(db, context.req.param("organizationSlug"), context.req.param("eventSlug"), context.req.param("formSlug"));
  const input = context.req.valid("json");
  if (!await verifyTurnstile(context.env, input.turnstileToken, context.req.header("cf-connecting-ip"))) throw new HttpError(400, "challenge_failed", "Please complete the security check.");
  if (availability(form) !== "open") throw new HttpError(400, "cfp_closed", form.opensAt && new Date().toISOString() < form.opensAt ? "Submissions are not open yet." : "The submission deadline has passed.");
  if (input.action === "draft" && !form.allowDrafts) throw new HttpError(400, "drafts_disabled", "This form does not allow draft submissions.");
  const definition = await formDefinition(db, form.id);
  if (input.action === "submit") {
    const errors = validateAnswers(definition.fields, definition.conditions, input.answers);
    if (Object.keys(errors).length) return context.json({ error: { code: "validation_failed", message: "Complete the highlighted fields.", fields: errors } }, 400);
  }
  const now = new Date().toISOString();
  let submissionId: string;
  let rawEditToken = input.editToken;
  let previousStatus: string | undefined;
  if (input.editToken) {
    const existing = await db.prepare("SELECT id, status FROM submissions WHERE form_id = ? AND edit_token_hash = ?").bind(form.id, await sha256(input.editToken)).first<{ id: string; status: string }>();
    if (!existing) throw new HttpError(404, "submission_not_found", "This private edit link is invalid.");
    if (["accepted", "declined", "withdrawn"].includes(existing.status)) throw new HttpError(409, "submission_locked", "This submission can no longer be edited.");
    if (form.editClosesAt && now > form.editClosesAt) throw new HttpError(409, "edit_deadline_passed", "The editing deadline has passed.");
    submissionId = existing.id; previousStatus = existing.status;
    if (input.action === "draft" && existing.status !== "draft") throw new HttpError(409, "already_submitted", "Submitted proposals stay in the review queue. Use Update proposal to save changes.");
  } else {
    if (form.submissionLimit) {
      const count = await db.prepare(`SELECT COUNT(DISTINCT s.id) AS count FROM submissions s JOIN submission_people p ON p.submission_id = s.id WHERE s.form_id = ? AND p.email = ? COLLATE NOCASE AND p.role = 'primary' AND s.status != 'withdrawn'`).bind(form.id, input.submitter.email).first<{ count: number }>();
      if ((count?.count ?? 0) >= form.submissionLimit) throw new HttpError(409, "submission_limit_reached", `This form allows ${form.submissionLimit} submission${form.submissionLimit === 1 ? "" : "s"} per person.`);
    }
    submissionId = crypto.randomUUID(); rawEditToken = randomToken();
  }
  const status = input.action === "submit" ? "pending" : "draft";
  const title = String(input.answers.session_title ?? input.answers.title ?? "").trim().slice(0, 300);
  const abstract = String(input.answers.abstract ?? input.answers.session_abstract ?? "").trim();
  if (input.editToken) {
    await db.batch([
      db.prepare("UPDATE submissions SET title = ?, abstract = ?, status = ?, answers_json = ?, submitted_at = CASE WHEN ? = 'pending' THEN COALESCE(submitted_at, ?) ELSE submitted_at END, updated_at = ? WHERE id = ?").bind(title, abstract, status, JSON.stringify(input.answers), status, now, now, submissionId),
      db.prepare("UPDATE submission_people SET email = ?, name = ?, organization = ? WHERE submission_id = ? AND role = 'primary'").bind(input.submitter.email, input.submitter.name, input.submitter.organization ?? null, submissionId),
    ]);
  } else {
    await db.batch([
      db.prepare("INSERT INTO submissions (id, form_id, event_id, edit_token_hash, title, abstract, status, answers_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(submissionId, form.id, form.eventId, await sha256(rawEditToken!), title, abstract, status, JSON.stringify(input.answers), status === "pending" ? now : null),
      db.prepare("INSERT INTO submission_people (id, submission_id, email, name, role, organization) VALUES (?, ?, ?, ?, 'primary', ?)").bind(crypto.randomUUID(), submissionId, input.submitter.email, input.submitter.name, input.submitter.organization ?? null),
    ]);
  }
  await db.prepare(
    `INSERT INTO audit_events (id, organization_id, event_id, action, entity_type, entity_id, after_json, request_id)
     VALUES (?, ?, ?, ?, 'submission', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), form.organizationId, form.eventId, previousStatus ? "submission.updated" : status === "pending" ? "submission.submitted" : "submission.draft_created", submissionId, JSON.stringify({ status, previousStatus, formId: form.id }), context.get("requestId")).run();
  const editLink = `${context.env.MARKETING_URL}/c/${context.req.param("organizationSlug")}/${form.eventSlug}/${form.slug}#edit=${encodeURIComponent(rawEditToken!)}`;
  let emailSent = false;
  if (status === "pending" && previousStatus !== "pending" && context.env.APP_ENV !== "test") {
    const emailId = crypto.randomUUID();
    const idempotencyKey = `submission-confirmation/${submissionId}`;
    await db.prepare("INSERT OR IGNORE INTO email_messages (id, organization_id, event_id, template_key, recipient_email, recipient_name, subject, body_html, idempotency_key) VALUES (?, ?, ?, 'submission_confirmation', ?, ?, ?, ?, ?)").bind(emailId, form.organizationId, form.eventId, input.submitter.email, input.submitter.name, form.confirmationSubject || `We received your proposal for ${form.eventName}`, form.confirmationBody || "Submission confirmation", idempotencyKey).run();
    try {
      const providerId = await sendSubmissionConfirmation(context.env, { email: input.submitter.email, name: input.submitter.name, eventName: form.eventName, formName: form.name, submissionTitle: title, subject: form.confirmationSubject, body: form.confirmationBody, editLink, idempotencyKey });
      await db.prepare("UPDATE email_messages SET status = 'sent', provider_id = ?, sent_at = ?, updated_at = ? WHERE idempotency_key = ?").bind(providerId, now, now, idempotencyKey).run(); emailSent = true;
    } catch (error) {
      await db.prepare("UPDATE email_messages SET status = 'failed', last_error = ?, updated_at = ? WHERE idempotency_key = ?").bind(error instanceof Error ? error.message : "Unknown email failure", now, idempotencyKey).run();
    }
  }
  return context.json({ submission: { id: submissionId, status, title, updatedAt: now }, editToken: rawEditToken, editLink, emailSent }, input.editToken ? 200 : 201);
});

router.post(`${route}/submissions/preview`, zValidator("json", z.object({ editToken: z.string().min(32).max(200) })), async (context) => {
  const db = database(context.env);
  const form = await publicForm(db, context.req.param("organizationSlug"), context.req.param("eventSlug"), context.req.param("formSlug"));
  const { editToken } = context.req.valid("json");
  const submission = await db.prepare(`SELECT s.id, s.title, s.status, s.answers_json AS answersJson, s.submitted_at AS submittedAt, s.updated_at AS updatedAt, p.name, p.email, p.organization FROM submissions s JOIN submission_people p ON p.submission_id = s.id AND p.role = 'primary' WHERE s.form_id = ? AND s.edit_token_hash = ?`).bind(form.id, await sha256(editToken)).first<{ id: string; title: string; status: string; answersJson: string; submittedAt: string | null; updatedAt: string; name: string; email: string; organization: string | null }>();
  if (!submission) throw new HttpError(404, "submission_not_found", "This private edit link is invalid.");
  const locked = ["accepted", "declined", "withdrawn"].includes(submission.status) || Boolean(form.editClosesAt && new Date().toISOString() > form.editClosesAt);
  return context.json({ submission: { ...submission, answers: JSON.parse(submission.answersJson), answersJson: undefined, submitter: { name: submission.name, email: submission.email, organization: submission.organization }, locked } });
});

export default router;
