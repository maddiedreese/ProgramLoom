import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { authenticatedUserOrNull, database, HttpError } from "../lib/authz";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "../lib/communications";
import { randomToken, sha256 } from "../lib/crypto";
import { renderSimpleTransactionalEmail } from "../lib/email";
import { eventManagerNotificationStatement } from "../lib/notifications";
import { verifyTurnstile } from "../lib/turnstile";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const route = "/cfp/:organizationSlug/:eventSlug/:formSlug";
const actionResolveSchema = z.object({
  token: z.string().min(32).max(200),
});

router.post(
  "/actions/submission-edit/resolve",
  zValidator("json", actionResolveSchema),
  async (context) => {
    const db = database(context.env);
    const input = context.req.valid("json");
    const token = await db
      .prepare(
        `SELECT t.id,t.organization_id AS organizationId,t.event_id AS eventId,
                t.entity_id AS submissionId,t.expires_at AS expiresAt,
                s.status,f.closes_at AS closesAt,f.edit_closes_at AS editClosesAt,f.slug AS formSlug,
                e.slug AS eventSlug,o.slug AS organizationSlug
         FROM communication_action_tokens t JOIN submissions s ON s.id=t.entity_id
         JOIN cfp_forms f ON f.id=s.form_id JOIN events e ON e.id=s.event_id
         JOIN organizations o ON o.id=e.organization_id
         WHERE t.token_hash=? AND t.action_type='submission_edit'
           AND t.entity_type='submission' AND t.used_at IS NULL LIMIT 1`,
      )
      .bind(await sha256(input.token))
      .first<{
        id: string;
        organizationId: string;
        eventId: string;
        submissionId: string;
        expiresAt: string;
        status: string;
        closesAt: string | null;
        editClosesAt: string | null;
        formSlug: string;
        eventSlug: string;
        organizationSlug: string;
      }>();
    const now = new Date().toISOString();
    if (!token || token.expiresAt <= now)
      throw new HttpError(
        410,
        "action_link_expired",
        "This private action link is invalid or has expired.",
      );
    if (submissionEditingIsClosed(token, token.status, now))
      throw new HttpError(
        409,
        "submission_locked",
        "This proposal can no longer be edited.",
      );
    const rawEditToken = randomToken();
    const consumed = await db.batch([
      db
        .prepare(
          "UPDATE communication_action_tokens SET used_at=? WHERE id=? AND used_at IS NULL",
        )
        .bind(now, token.id),
      db
        .prepare(
          `UPDATE submissions SET edit_token_hash=?,updated_at=?
           WHERE id=? AND event_id=? AND EXISTS (
             SELECT 1 FROM communication_action_tokens WHERE id=? AND used_at=?
           )`,
        )
        .bind(
          await sha256(rawEditToken),
          now,
          token.submissionId,
          token.eventId,
          token.id,
          now,
        ),
    ]);
    if (!consumed[1].meta.changes)
      throw new HttpError(
        410,
        "action_link_used",
        "This private action link has already been used.",
      );
    await db
      .prepare(
        `INSERT INTO audit_events
          (id,organization_id,event_id,action,entity_type,entity_id,after_json,request_id)
         VALUES(?,?,?,'communication_action.submission_edit_resolved','submission',?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        token.organizationId,
        token.eventId,
        token.submissionId,
        JSON.stringify({ actionTokenId: token.id }),
        context.get("requestId"),
      )
      .run();
    context.header("cache-control", "no-store");
    return context.json({
      destination: `/c/${token.organizationSlug}/${token.eventSlug}/${token.formSlug}`,
      editToken: rawEditToken,
    });
  },
);

export const submissionSchema = z
  .object({
    submitter: z.object({
      name: z.string().trim().min(2).max(160),
      email: z.email().transform((email) => email.trim().toLowerCase()),
      organization: z.string().trim().max(160).optional(),
    }),
    answers: z.record(z.string(), z.unknown()),
    coSubmitters: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(160),
          email: z.email().transform((email) => email.trim().toLowerCase()),
          organization: z.string().trim().max(160).optional(),
          participantRole: z
            .enum(["coauthor", "presenter", "panelist", "discussant"])
            .default("coauthor"),
        }),
      )
      .max(12)
      .default([]),
    action: z.enum(["draft", "submit"]),
    editToken: z.string().min(32).max(200).optional(),
    submissionId: z.uuid().optional(),
    turnstileToken: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value.answers).length > 200)
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "This form contains too many answers.",
      });
    if (JSON.stringify(value.answers).length > 200_000)
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "The submitted answers are too large.",
      });
  });

type FormRecord = {
  id: string;
  eventId: string;
  organizationId: string;
  organizationName: string;
  eventName: string;
  eventSlug: string;
  timezone: string;
  primaryColor: string;
  name: string;
  slug: string;
  description: string | null;
  opensAt: string | null;
  closesAt: string | null;
  editClosesAt: string | null;
  allowDrafts: number;
  submissionLimit: number | null;
  confirmationSubject: string | null;
  confirmationBody: string | null;
  publishedAt: string | null;
};
type FieldRecord = {
  id: string;
  section: string;
  fieldType: string;
  fieldKey: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  required: number;
  optionsJson: string | null;
  validationJson: string | null;
  position: number;
};
type ConditionRecord = {
  id: string;
  sourceFieldId: string;
  operator: string;
  compareValueJson: string | null;
  targetFieldId: string;
  action: "show" | "hide" | "require";
};

async function publicForm(
  db: D1Database,
  organizationSlug: string,
  eventSlug: string,
  formSlug: string,
): Promise<FormRecord> {
  const form = await db
    .prepare(
      `SELECT f.id, f.event_id AS eventId, e.organization_id AS organizationId, o.name AS organizationName,
            e.name AS eventName, e.slug AS eventSlug, e.timezone, e.primary_color AS primaryColor,
            f.name, f.slug, f.description, f.opens_at AS opensAt, f.closes_at AS closesAt,
            f.edit_closes_at AS editClosesAt, f.allow_drafts AS allowDrafts, f.submission_limit AS submissionLimit,
            f.confirmation_subject AS confirmationSubject, f.confirmation_body AS confirmationBody, f.published_at AS publishedAt
     FROM cfp_forms f JOIN events e ON e.id = f.event_id JOIN organizations o ON o.id = e.organization_id
     WHERE o.slug = ? COLLATE NOCASE AND e.slug = ? COLLATE NOCASE AND f.slug = ? COLLATE NOCASE`,
    )
    .bind(organizationSlug, eventSlug, formSlug)
    .first<FormRecord>();
  if (!form || !form.publishedAt)
    throw new HttpError(
      404,
      "cfp_not_found",
      "This call for proposals is not available.",
    );
  return form;
}

async function formDefinition(db: D1Database, formId: string) {
  const fieldsResult = await db
    .prepare(
      `SELECT id, section, field_type AS fieldType, field_key AS fieldKey, label, description, placeholder, required, options_json AS optionsJson, validation_json AS validationJson, position FROM form_fields WHERE form_id = ? ORDER BY position, id`,
    )
    .bind(formId)
    .all<FieldRecord>();
  const conditionsResult = await db
    .prepare(
      `SELECT id, source_field_id AS sourceFieldId, operator, compare_value_json AS compareValueJson, target_field_id AS targetFieldId, action FROM form_conditions WHERE form_id = ? ORDER BY id`,
    )
    .bind(formId)
    .all<ConditionRecord>();
  const fields = fieldsResult.results.map((field) => ({
    ...field,
    required: Boolean(field.required),
    options: field.optionsJson ? JSON.parse(field.optionsJson) : undefined,
    validation: field.validationJson
      ? JSON.parse(field.validationJson)
      : undefined,
    optionsJson: undefined,
    validationJson: undefined,
  }));
  const conditions = conditionsResult.results.map((condition) => ({
    ...condition,
    compareValue: condition.compareValueJson
      ? JSON.parse(condition.compareValueJson)
      : undefined,
    compareValueJson: undefined,
  }));
  return { fields, conditions };
}

export function cfpAvailability(
  form: Pick<FormRecord, "opensAt" | "closesAt">,
  now = new Date().toISOString(),
) {
  if (form.opensAt && now < form.opensAt) return "upcoming" as const;
  if (form.closesAt && now >= form.closesAt) return "closed" as const;
  return "open" as const;
}

export function submissionEditingIsClosed(
  form: Pick<FormRecord, "closesAt" | "editClosesAt">,
  status: string,
  now = new Date().toISOString(),
) {
  return (
    ["accepted", "declined", "withdrawn"].includes(status) ||
    Boolean(form.closesAt && now >= form.closesAt) ||
    Boolean(form.editClosesAt && now >= form.editClosesAt)
  );
}

export function submissionCanBeSavedAsDraft(status: string) {
  return status === "draft";
}

router.get("/cfp", async (context) => {
  context.header("cache-control", "no-store");
  const db = database(context.env);
  const result = await db
    .prepare(
      `SELECT f.id, f.name, f.slug, f.description, f.opens_at AS opensAt,
              f.closes_at AS closesAt, f.edit_closes_at AS editClosesAt,
              f.published_at AS publishedAt, e.name AS eventName,
              e.slug AS eventSlug, e.starts_at AS eventStartsAt,
              e.ends_at AS eventEndsAt, e.timezone, o.name AS organizationName,
              o.slug AS organizationSlug
       FROM cfp_forms f
       JOIN events e ON e.id = f.event_id
       JOIN organizations o ON o.id = e.organization_id
       WHERE f.published_at IS NOT NULL
         AND (f.closes_at IS NULL OR datetime(f.closes_at) >= datetime('now', '-30 days'))
       ORDER BY
         CASE WHEN f.opens_at IS NOT NULL AND datetime(f.opens_at) > datetime('now') THEN 1
              WHEN f.closes_at IS NOT NULL AND datetime(f.closes_at) < datetime('now') THEN 2
              ELSE 0 END,
         COALESCE(f.closes_at, e.starts_at), f.name`,
    )
    .all<
      Pick<
        FormRecord,
        | "id"
        | "name"
        | "slug"
        | "description"
        | "opensAt"
        | "closesAt"
        | "editClosesAt"
        | "publishedAt"
        | "timezone"
      > & {
        eventName: string;
        eventSlug: string;
        eventStartsAt: string;
        eventEndsAt: string;
        organizationName: string;
        organizationSlug: string;
      }
    >();

  return context.json({
    forms: result.results.map((form) => ({
      ...form,
      availability: cfpAvailability(form),
      url: `/c/${form.organizationSlug}/${form.eventSlug}/${form.slug}`,
    })),
  });
});

router.get("/my-submissions", async (context) => {
  const user = await authenticatedUserOrNull(context);
  if (!user)
    throw new HttpError(401, "authentication_required", "Sign in to continue.");
  const result = await database(context.env)
    .prepare(
      `SELECT DISTINCT s.id,s.title,s.status,s.decision_state AS decisionState,
              s.submitted_at AS submittedAt,s.updated_at AS updatedAt,
              f.name AS formName,f.slug AS formSlug,f.edit_closes_at AS editClosesAt,
              e.id AS eventId,e.name AS eventName,e.slug AS eventSlug,
              o.name AS organizationName,o.slug AS organizationSlug
       FROM submissions s
       JOIN submission_people person ON person.submission_id=s.id
       JOIN cfp_forms f ON f.id=s.form_id
       JOIN events e ON e.id=s.event_id
       JOIN organizations o ON o.id=e.organization_id
       WHERE person.user_id=? OR lower(person.email)=lower(?)
       ORDER BY COALESCE(s.submitted_at,s.updated_at) DESC,s.id
       LIMIT 100`,
    )
    .bind(user.id, user.email)
    .all();
  return context.json({ submissions: result.results });
});

export function matches(operator: string, actual: unknown, expected: unknown) {
  if (operator === "is_checked") return actual === true;
  if (operator === "equals")
    return String(actual ?? "") === String(expected ?? "");
  if (operator === "not_equals")
    return String(actual ?? "") !== String(expected ?? "");
  if (operator === "contains")
    return Array.isArray(actual)
      ? actual.map(String).includes(String(expected))
      : String(actual ?? "").includes(String(expected ?? ""));
  if (operator === "greater_than") return Number(actual) > Number(expected);
  if (operator === "less_than") return Number(actual) < Number(expected);
  return false;
}

export function validateAnswers(
  fields: Awaited<ReturnType<typeof formDefinition>>["fields"],
  conditions: Awaited<ReturnType<typeof formDefinition>>["conditions"],
  answers: Record<string, unknown>,
) {
  const keyById = new Map(fields.map((field) => [field.id, field.fieldKey]));
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const showRules = conditions.filter(
      (condition) =>
        condition.targetFieldId === field.id && condition.action === "show",
    );
    const hiddenByRule = conditions.some(
      (condition) =>
        condition.targetFieldId === field.id &&
        condition.action === "hide" &&
        matches(
          condition.operator,
          answers[keyById.get(condition.sourceFieldId) ?? ""],
          condition.compareValue,
        ),
    );
    const visible =
      !hiddenByRule &&
      (!showRules.length ||
        showRules.some((condition) =>
          matches(
            condition.operator,
            answers[keyById.get(condition.sourceFieldId) ?? ""],
            condition.compareValue,
          ),
        ));
    if (!visible) continue;
    const conditionallyRequired = conditions.some(
      (condition) =>
        condition.targetFieldId === field.id &&
        condition.action === "require" &&
        matches(
          condition.operator,
          answers[keyById.get(condition.sourceFieldId) ?? ""],
          condition.compareValue,
        ),
    );
    const value = answers[field.fieldKey];
    const missing =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      value === false;
    if ((field.required || conditionallyRequired) && missing) {
      errors[field.fieldKey] = `${field.label} is required.`;
      continue;
    }
    if (missing) continue;
    if (field.fieldType === "email" && !z.email().safeParse(value).success)
      errors[field.fieldKey] = "Enter a valid email address.";
    if (field.fieldType === "url" && !z.url().safeParse(value).success)
      errors[field.fieldKey] = "Enter a complete URL.";
    if (field.fieldType === "number" && !Number.isFinite(Number(value)))
      errors[field.fieldKey] = "Enter a valid number.";
    if (
      field.fieldType === "select" &&
      field.options &&
      !field.options.includes(String(value))
    )
      errors[field.fieldKey] = "Choose one of the available options.";
    if (
      field.fieldType === "multiselect" &&
      field.options &&
      (!Array.isArray(value) ||
        value.some((item) => !field.options?.includes(String(item))))
    )
      errors[field.fieldKey] = "Choose only available options.";
  }
  return errors;
}

export function deriveProgramMetadata(
  fields: Awaited<ReturnType<typeof formDefinition>>["fields"],
  answers: Record<string, unknown>,
  tracks: Array<{ id: string; name: string }>,
) {
  const fieldMatching = (pattern: RegExp) =>
    fields.find((field) => pattern.test(`${field.fieldKey} ${field.label}`));
  const formatField = fieldMatching(/\b(format|session type)\b/i);
  const trackField = fieldMatching(/\b(track|category)\b/i);
  const formatValue = formatField ? answers[formatField.fieldKey] : undefined;
  const format =
    typeof formatValue === "string" && formatValue.trim()
      ? formatValue.trim().slice(0, 160)
      : null;
  const durationMatch = format?.match(/\((\d{1,3})\s*min(?:ute)?s?\)/i);
  const durationMinutes = durationMatch ? Number(durationMatch[1]) : null;
  const trackValue = trackField ? answers[trackField.fieldKey] : undefined;
  const requestedTracks = (
    Array.isArray(trackValue) ? trackValue : [trackValue]
  )
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
  const trackIds = tracks
    .filter((track) =>
      requestedTracks.includes(track.name.trim().toLocaleLowerCase()),
    )
    .map((track) => track.id);
  return { format, durationMinutes, trackIds };
}

router.get(`${route}`, async (context) => {
  context.header("cache-control", "no-store");
  const db = database(context.env);
  const form = await publicForm(
    db,
    context.req.param("organizationSlug"),
    context.req.param("eventSlug"),
    context.req.param("formSlug"),
  );
  const definition = await formDefinition(db, form.id);
  const authenticatedUser = await authenticatedUserOrNull(context);
  let currentSubmission:
    | {
        id: string;
        status: string;
        answers: Record<string, unknown>;
        submitter: {
          name: string;
          email: string;
          organization: string;
        };
        coSubmitters: Array<{
          name: string;
          email: string;
          organization: string;
          participantRole: string;
        }>;
        locked: boolean;
      }
    | undefined;
  if (authenticatedUser) {
    const requestedSubmissionId = context.req.query("submission") ?? null;
    const owned = await db
      .prepare(
        `SELECT s.id,s.status,s.answers_json AS answersJson,p.name,p.email,p.organization
         FROM submissions s
         JOIN submission_people p ON p.submission_id=s.id AND p.role='primary'
         WHERE s.form_id=? AND (? IS NULL OR s.id=?)
           AND (p.user_id=? OR p.email=? COLLATE NOCASE)
         ORDER BY CASE WHEN s.id=? THEN 0 ELSE 1 END,
                  CASE s.status WHEN 'draft' THEN 0 ELSE 1 END,s.updated_at DESC
         LIMIT 1`,
      )
      .bind(
        form.id,
        requestedSubmissionId,
        requestedSubmissionId,
        authenticatedUser.id,
        authenticatedUser.email,
        requestedSubmissionId,
      )
      .first<{
        id: string;
        status: string;
        answersJson: string;
        name: string;
        email: string;
        organization: string | null;
      }>();
    if (owned) {
      const coauthors = await db
        .prepare(
          `SELECT name,email,organization,role AS participantRole FROM submission_people
           WHERE submission_id=? AND role!='primary' ORDER BY position,id`,
        )
        .bind(owned.id)
        .all<{
          name: string;
          email: string;
          organization: string | null;
          participantRole: string;
        }>();
      currentSubmission = {
        id: owned.id,
        status: owned.status,
        answers: JSON.parse(owned.answersJson),
        submitter: {
          name: owned.name,
          email: owned.email,
          organization: owned.organization ?? "",
        },
        coSubmitters: coauthors.results.map((person) => ({
          ...person,
          organization: person.organization ?? "",
        })),
        locked: submissionEditingIsClosed(form, owned.status),
      };
    }
  }
  return context.json({
    form: {
      ...form,
      allowDrafts: Boolean(form.allowDrafts),
      availability: cfpAvailability(form),
    },
    ...definition,
    currentSubmission,
  });
});

router.post(
  `${route}/submissions`,
  zValidator("json", submissionSchema),
  async (context) => {
    const db = database(context.env);
    const form = await publicForm(
      db,
      context.req.param("organizationSlug"),
      context.req.param("eventSlug"),
      context.req.param("formSlug"),
    );
    const input = context.req.valid("json");
    const authenticatedUser = await authenticatedUserOrNull(context);
    if (
      !authenticatedUser &&
      !(await verifyTurnstile(
        context.env,
        input.turnstileToken,
        context.req.header("cf-connecting-ip"),
      ))
    )
      throw new HttpError(
        400,
        "challenge_failed",
        "Please complete the security check.",
      );
    if (cfpAvailability(form) !== "open")
      throw new HttpError(
        400,
        "cfp_closed",
        form.opensAt && new Date().toISOString() < form.opensAt
          ? "Submissions are not open yet."
          : "The submission deadline has passed.",
      );
    if (input.action === "draft" && !form.allowDrafts)
      throw new HttpError(
        400,
        "drafts_disabled",
        "This form does not allow draft submissions.",
      );
    const definition = await formDefinition(db, form.id);
    if (input.action === "submit") {
      const errors = validateAnswers(
        definition.fields,
        definition.conditions,
        input.answers,
      );
      if (Object.keys(errors).length)
        return context.json(
          {
            error: {
              code: "validation_failed",
              message: "Complete the highlighted fields.",
              fields: errors,
            },
          },
          400,
        );
    }
    const now = new Date().toISOString();
    let submissionId: string;
    let rawEditToken = input.editToken;
    let previousStatus: string | undefined;
    if (input.editToken) {
      const existing = await db
        .prepare(
          "SELECT id, status FROM submissions WHERE form_id = ? AND edit_token_hash = ?",
        )
        .bind(form.id, await sha256(input.editToken))
        .first<{ id: string; status: string }>();
      if (!existing)
        throw new HttpError(
          404,
          "submission_not_found",
          "This private edit link is invalid.",
        );
      if (submissionEditingIsClosed(form, existing.status, now))
        throw new HttpError(
          409,
          "edit_deadline_passed",
          "The call for proposals or editing window has closed.",
        );
      submissionId = existing.id;
      previousStatus = existing.status;
      if (input.action === "draft" && !submissionCanBeSavedAsDraft(existing.status))
        throw new HttpError(
          409,
          "already_submitted",
          "Submitted proposals stay in the review queue. Use Update proposal to save changes.",
        );
    } else if (input.submissionId) {
      if (!authenticatedUser)
        throw new HttpError(
          401,
          "authentication_required",
          "Sign in again to update this proposal.",
        );
      const existing = await db
        .prepare(
          `SELECT s.id,s.status FROM submissions s
           JOIN submission_people p ON p.submission_id=s.id AND p.role='primary'
           WHERE s.id=? AND s.form_id=?
             AND (p.user_id=? OR p.email=? COLLATE NOCASE)`,
        )
        .bind(
          input.submissionId,
          form.id,
          authenticatedUser.id,
          authenticatedUser.email,
        )
        .first<{ id: string; status: string }>();
      if (!existing)
        throw new HttpError(
          404,
          "submission_not_found",
          "This proposal is not available to your account.",
        );
      if (submissionEditingIsClosed(form, existing.status, now))
        throw new HttpError(
          409,
          "edit_deadline_passed",
          "The call for proposals or editing window has closed.",
        );
      submissionId = existing.id;
      previousStatus = existing.status;
      rawEditToken = randomToken();
      if (input.action === "draft" && !submissionCanBeSavedAsDraft(existing.status))
        throw new HttpError(
          409,
          "already_submitted",
          "Submitted proposals stay in the review queue. Use Update proposal to save changes.",
        );
    } else {
      if (form.submissionLimit) {
        const count = await db
          .prepare(
            `SELECT COUNT(DISTINCT s.id) AS count FROM submissions s JOIN submission_people p ON p.submission_id = s.id WHERE s.form_id = ? AND p.email = ? COLLATE NOCASE AND p.role = 'primary' AND s.status != 'withdrawn'`,
          )
          .bind(form.id, input.submitter.email)
          .first<{ count: number }>();
        if ((count?.count ?? 0) >= form.submissionLimit)
          throw new HttpError(
            409,
            "submission_limit_reached",
            `This form allows ${form.submissionLimit} submission${form.submissionLimit === 1 ? "" : "s"} per person.`,
          );
      }
      submissionId = crypto.randomUUID();
      rawEditToken = randomToken();
    }
    const status = input.action === "submit" ? "pending" : "draft";
    const title = String(
      input.answers.session_title ?? input.answers.title ?? "",
    )
      .trim()
      .slice(0, 300);
    const abstract = String(
      input.answers.abstract ?? input.answers.session_abstract ?? "",
    ).trim();
    const tracks = await db
      .prepare(
        "SELECT id,name FROM tracks WHERE event_id=? ORDER BY position,name",
      )
      .bind(form.eventId)
      .all<{ id: string; name: string }>();
    const metadata = deriveProgramMetadata(
      definition.fields,
      input.answers,
      tracks.results,
    );
    const trackStatements = [
      db
        .prepare("DELETE FROM submission_tracks WHERE submission_id=?")
        .bind(submissionId),
      ...metadata.trackIds.map((trackId) =>
        db
          .prepare(
            "INSERT INTO submission_tracks(submission_id,track_id) VALUES(?,?)",
          )
          .bind(submissionId, trackId),
      ),
    ];
    const existingSubmission = Boolean(input.editToken || input.submissionId);
    const coauthorStatements = [
      db
        .prepare(
          "DELETE FROM submission_people WHERE submission_id=? AND role!='primary'",
        )
        .bind(submissionId),
      ...input.coSubmitters.map((person, position) =>
        db
          .prepare(
            `INSERT INTO submission_people
              (id,submission_id,email,name,role,organization,position)
             VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            submissionId,
            person.email,
            person.name,
            person.participantRole,
            person.organization ?? null,
            position + 1,
          ),
      ),
    ];
    if (existingSubmission) {
      await db.batch([
        db
          .prepare(
            "UPDATE submissions SET edit_token_hash=?, title = ?, abstract = ?, format=?, duration_minutes=?, status = ?, answers_json = ?, submitted_at = CASE WHEN ? = 'pending' THEN COALESCE(submitted_at, ?) ELSE submitted_at END, updated_at = ? WHERE id = ?",
          )
          .bind(
            await sha256(rawEditToken!),
            title,
            abstract,
            metadata.format,
            metadata.durationMinutes,
            status,
            JSON.stringify(input.answers),
            status,
            now,
            now,
            submissionId,
          ),
        db
          .prepare(
            "UPDATE submission_people SET user_id=COALESCE(user_id,?), email = ?, name = ?, organization = ? WHERE submission_id = ? AND role = 'primary'",
          )
          .bind(
            authenticatedUser?.id ?? null,
            input.submitter.email,
            input.submitter.name,
            input.submitter.organization ?? null,
            submissionId,
          ),
        ...coauthorStatements,
        ...trackStatements,
      ]);
    } else {
      await db.batch([
        db
          .prepare(
            "INSERT INTO submissions (id, form_id, event_id, edit_token_hash, title, abstract, format, duration_minutes, status, answers_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            submissionId,
            form.id,
            form.eventId,
            await sha256(rawEditToken!),
            title,
            abstract,
            metadata.format,
            metadata.durationMinutes,
            status,
            JSON.stringify(input.answers),
            status === "pending" ? now : null,
          ),
        db
          .prepare(
            "INSERT INTO submission_people (id, submission_id, user_id, email, name, role, organization) VALUES (?, ?, ?, ?, ?, 'primary', ?)",
          )
          .bind(
            crypto.randomUUID(),
            submissionId,
            authenticatedUser?.id ?? null,
            input.submitter.email,
            input.submitter.name,
            input.submitter.organization ?? null,
          ),
        ...coauthorStatements,
        ...trackStatements,
      ]);
    }
    await db
      .prepare(
        `INSERT INTO audit_events (id, organization_id, event_id, action, entity_type, entity_id, after_json, request_id)
     VALUES (?, ?, ?, ?, 'submission', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        form.organizationId,
        form.eventId,
        previousStatus
          ? "submission.updated"
          : status === "pending"
            ? "submission.submitted"
            : "submission.draft_created",
        submissionId,
        JSON.stringify({ status, previousStatus, formId: form.id }),
        context.get("requestId"),
      )
      .run();
    if (status === "pending")
      await eventManagerNotificationStatement(db, {
        organizationId: form.organizationId,
        eventId: form.eventId,
        category: "submission",
        notificationType: previousStatus
          ? "submission.updated"
          : "submission.created",
        severity: "info",
        title: previousStatus
          ? "A proposal was updated"
          : "A new proposal was submitted",
        body: title || "Open the submission workspace to review the proposal.",
        actionUrl: `/app/events/${form.eventId}/submissions?submission=${submissionId}`,
        entityType: "submission",
        entityId: submissionId,
        coalesceKey: `submission:${submissionId}:${previousStatus ? "updated" : "created"}`,
      }).run();
    const editLink = `${context.env.MARKETING_URL}/c/${context.req.param("organizationSlug")}/${form.eventSlug}/${form.slug}#edit=${encodeURIComponent(rawEditToken!)}`;
    let emailQueued = false;
    if (
      status === "pending" &&
      previousStatus !== "pending" &&
      context.env.APP_ENV !== "test"
    ) {
      const emailId = crypto.randomUUID();
      const idempotencyKey = `submission-confirmation/${submissionId}`;
      const subject =
        form.confirmationSubject ||
        `We received your proposal for ${form.eventName}`;
      const intro =
        form.confirmationBody ||
        `Thanks for sharing your idea with the ${form.eventName} program team.`;
      const rendered = renderSimpleTransactionalEmail({
        recipientName: input.submitter.name,
        paragraphs: [
          intro,
          `${title || form.name} is now in the review queue.`,
          "Keep this private link safe. Editing may close at the organizer’s deadline.",
        ],
        actionLabel: "Review or edit proposal",
        actionUrl: editLink,
      });
      await db.batch([
        prepareCommunicationStatement(db, {
          id: emailId,
          organizationId: form.organizationId,
          eventId: form.eventId,
          category: "submission_confirmation",
          recipientEmail: input.submitter.email,
          recipientName: input.submitter.name,
          subject,
          bodyHtml: rendered.html,
          bodyText: rendered.text,
          entityType: "submission",
          entityId: submissionId,
          sensitiveExpiresAt:
            form.editClosesAt ??
            new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
          metadata: { formId: form.id },
          idempotencyKey,
          correlationId: context.get("requestId"),
        }),
        db
          .prepare(
            `INSERT INTO domain_events
                (id,organization_id,event_id,event_type,entity_type,entity_id,payload_json,correlation_id)
               VALUES(?,?,?,'communication.confirmation_prepared','submission',?,'{}',?)`,
          )
          .bind(
            crypto.randomUUID(),
            form.organizationId,
            form.eventId,
            submissionId,
            context.get("requestId"),
          ),
      ]);
      try {
        const queued = await enqueueCommunication(
          context.env,
          emailId,
          context.get("requestId"),
        );
        emailQueued = queued.queued;
      } catch {
        // The durable prepared record remains visible in the outbox for safe retry.
      }
    }
    return context.json(
      {
        submission: { id: submissionId, status, title, updatedAt: now },
        editToken: rawEditToken,
        editLink,
        emailQueued,
        emailSent: false,
      },
      existingSubmission ? 200 : 201,
    );
  },
);

router.post(
  `${route}/submissions/preview`,
  zValidator("json", z.object({ editToken: z.string().min(32).max(200) })),
  async (context) => {
    const db = database(context.env);
    const form = await publicForm(
      db,
      context.req.param("organizationSlug"),
      context.req.param("eventSlug"),
      context.req.param("formSlug"),
    );
    const { editToken } = context.req.valid("json");
    const submission = await db
      .prepare(
        `SELECT s.id, s.title, s.status, s.answers_json AS answersJson, s.submitted_at AS submittedAt, s.updated_at AS updatedAt, p.name, p.email, p.organization FROM submissions s JOIN submission_people p ON p.submission_id = s.id AND p.role = 'primary' WHERE s.form_id = ? AND s.edit_token_hash = ?`,
      )
      .bind(form.id, await sha256(editToken))
      .first<{
        id: string;
        title: string;
        status: string;
        answersJson: string;
        submittedAt: string | null;
        updatedAt: string;
        name: string;
        email: string;
        organization: string | null;
      }>();
    if (!submission)
      throw new HttpError(
        404,
        "submission_not_found",
        "This private edit link is invalid.",
      );
    const locked =
      ["accepted", "declined", "withdrawn"].includes(submission.status) ||
      Boolean(
        form.editClosesAt && new Date().toISOString() > form.editClosesAt,
      );
    const coauthors = await db
      .prepare(
        `SELECT name,email,organization,role AS participantRole FROM submission_people
         WHERE submission_id=? AND role!='primary' ORDER BY position,id`,
      )
      .bind(submission.id)
      .all<{
        name: string;
        email: string;
        organization: string | null;
        participantRole: string;
      }>();
    return context.json({
      submission: {
        ...submission,
        answers: JSON.parse(submission.answersJson),
        answersJson: undefined,
        submitter: {
          name: submission.name,
          email: submission.email,
          organization: submission.organization,
        },
        coSubmitters: coauthors.results.map((person) => ({
          ...person,
          organization: person.organization ?? "",
        })),
        locked,
      },
    });
  },
);

export default router;
