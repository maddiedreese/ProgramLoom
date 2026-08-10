import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { auditStatement } from "../lib/audit";
import {
  database,
  HttpError,
  normalizeSlug,
  requireOrganizationRole,
} from "../lib/authz";
import {
  enqueueCommunication,
  prepareCommunicationStatement,
} from "../lib/communications";
import { renderSimpleTransactionalEmail } from "../lib/email";
import { domainEventStatement } from "../lib/operations";
import { verifyTurnstile } from "../lib/turnstile";

type Variables = { requestId: string };
const router = new Hono<{ Bindings: Env; Variables: Variables }>();
const writeRoles = ["owner", "admin"] as const;
const readRoles = ["owner", "admin", "member"] as const;
const stages = [
  "researching",
  "identified",
  "approved",
  "contacted",
  "interested",
  "confirmed",
  "future_fit",
  "declined",
] as const;

const nullableText = z.string().trim().max(5000).nullable().optional();
const contactFields = {
  email: z.email().transform((value) => value.trim().toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  pronouns: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(180).nullable().optional(),
  jobTitle: z.string().trim().max(180).nullable().optional(),
  bio: nullableText,
  phone: z.string().trim().max(80).nullable().optional(),
  region: z.string().trim().max(160).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(100),
  social: z.record(z.string(), z.string().max(500)),
  source: z.string().trim().min(1).max(80),
};
const contactSchema = z.object({
  ...contactFields,
  tags: contactFields.tags.default([]),
  social: contactFields.social.default({}),
  source: contactFields.source.default("manual"),
});
const contactPatchSchema = z
  .object(contactFields)
  .partial()
  .extend({
    customFields: z.record(z.string().uuid(), z.unknown()).optional(),
  });
const importSchema = z.object({
  mode: z
    .enum(["create_and_update", "create_only", "update_only"])
    .default("create_and_update"),
  rows: z.array(contactSchema).min(1).max(1000),
  eventId: z.string().uuid().optional(),
});
const fieldSchema = z.object({
  name: z.string().trim().min(1).max(255),
  fieldType: z.enum([
    "text",
    "number",
    "date",
    "select",
    "multiselect",
    "checkbox",
  ]),
  options: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const segmentSchema = z.object({
  name: z.string().trim().min(2).max(160),
  segmentType: z.enum(["dynamic", "curated"]),
  filter: z
    .object({
      search: z.string().max(200).optional(),
      companies: z.array(z.string().max(180)).max(100).default([]),
      jobTitles: z.array(z.string().max(180)).max(100).default([]),
      tags: z.array(z.string().max(80)).max(100).default([]),
      fieldId: z.string().uuid().optional(),
      fieldValue: z.unknown().optional(),
    })
    .default({ companies: [], jobTitles: [], tags: [] }),
  contactIds: z.array(z.string().uuid()).max(1000).default([]),
});
const enrollSchema = z.object({
  contactId: z.string().uuid(),
  stage: z.enum(stages).default("identified"),
  score: z.number().int().min(0).max(100).nullable().optional(),
  rationale: z.string().trim().max(3000).nullable().optional(),
});
const moveSchema = z.object({
  stage: z.enum(stages),
  note: z.string().trim().max(2000).optional(),
});
const mergeSchema = z.object({
  primaryId: z.string().uuid(),
  duplicateIds: z.array(z.string().uuid()).min(1).max(10),
  preferred: z.record(z.string(), z.string().uuid()).default({}),
});
const handoffSchema = z.object({
  contactId: z.string().uuid(),
  eventId: z.string().uuid(),
});
const outreachSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(100),
  eventId: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),
  replyTo: z.email().nullable().optional(),
  subject: z.string().trim().min(3).max(180),
  body: z.string().trim().min(10).max(10000),
});
const templateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  templateType: z.enum(["outreach", "event_invite", "follow_up"]),
  replyTo: z.email().nullable().optional(),
  subject: z.string().trim().min(3).max(180),
  body: z.string().trim().min(10).max(10000),
});
const interestFormSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z.string().trim().max(80).optional(),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    mode: z.enum(["speakers_only", "sessions_and_speakers"]),
    opensAt: z.iso.datetime({ offset: true }).nullable().optional(),
    closesAt: z.iso.datetime({ offset: true }).nullable().optional(),
    eventIds: z.array(z.string().uuid()).max(100).default([]),
    fields: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(80),
          label: z.string().trim().min(1).max(160),
          type: z.enum(["text", "textarea", "url", "select"]),
          required: z.boolean().default(false),
          options: z.array(z.string().max(160)).max(100).default([]),
        }),
      )
      .max(50)
      .default([]),
    managerIds: z.array(z.string().uuid()).max(100).default([]),
    notification: z.record(z.string(), z.unknown()).default({}),
    published: z.boolean().default(false),
  })
  .refine(
    (value) =>
      !value.opensAt || !value.closesAt || value.opensAt < value.closesAt,
    { path: ["closesAt"], message: "Close time must be after open time." },
  );
const interestSubmissionSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  company: z.string().trim().max(180).nullable().optional(),
  jobTitle: z.string().trim().max(180).nullable().optional(),
  bio: z.string().trim().max(5000).nullable().optional(),
  sessionTitle: z.string().trim().max(240).nullable().optional(),
  sessionAbstract: z.string().trim().max(10000).nullable().optional(),
  answers: z.record(z.string(), z.unknown()).default({}),
  turnstileToken: z.string().optional(),
});

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback;
  } catch {
    return fallback;
  }
}

type NormalizedContact = Record<string, unknown> & {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string | null;
  jobTitle: string | null;
  bio: string | null;
  source: string;
  tags: string[];
  social: Record<string, string>;
};

function normalizeContact(row: Record<string, unknown>): NormalizedContact {
  return {
    ...row,
    tags: parseJson<string[]>(row.tagsJson, []),
    social: parseJson<Record<string, string>>(row.socialJson, {}),
    tagsJson: undefined,
    socialJson: undefined,
  } as unknown as NormalizedContact;
}

export function matchesFilter(
  contact: ReturnType<typeof normalizeContact>,
  filter: {
    search?: string;
    companies?: string[];
    jobTitles?: string[];
    tags?: string[];
    fieldId?: string;
    fieldValue?: unknown;
  },
  fieldValues: Map<string, Record<string, unknown>>,
) {
  const search = filter.search?.trim().toLowerCase();
  if (
    search &&
    !`${contact.firstName} ${contact.lastName} ${contact.email} ${contact.company ?? ""} ${contact.jobTitle ?? ""}`
      .toLowerCase()
      .includes(search)
  )
    return false;
  if (
    filter.companies?.length &&
    !filter.companies.includes(String(contact.company ?? ""))
  )
    return false;
  if (
    filter.jobTitles?.length &&
    !filter.jobTitles.includes(String(contact.jobTitle ?? ""))
  )
    return false;
  if (
    filter.tags?.length &&
    !filter.tags.every((tag) => contact.tags.includes(tag))
  )
    return false;
  if (filter.fieldId) {
    const actual = fieldValues.get(String(contact.id))?.[filter.fieldId];
    if (JSON.stringify(actual) !== JSON.stringify(filter.fieldValue))
      return false;
  }
  return true;
}

async function organizationContacts(db: D1Database, organizationId: string) {
  const [contactsResult, valuesResult] = await Promise.all([
    db
      .prepare(
        `SELECT c.id,c.email,c.first_name AS firstName,c.last_name AS lastName,c.pronouns,c.company,c.job_title AS jobTitle,c.bio,c.phone,c.region,c.tags_json AS tagsJson,c.social_json AS socialJson,c.source,c.speaker_profile_id AS speakerProfileId,c.created_at AS createdAt,c.updated_at AS updatedAt,pc.id AS pipelineCardId,pc.stage AS pipelineStage,pc.score AS pipelineScore FROM crm_contacts c LEFT JOIN crm_pipeline_cards pc ON pc.contact_id=c.id AND pc.organization_id=c.organization_id WHERE c.organization_id=? ORDER BY c.last_name COLLATE NOCASE,c.first_name COLLATE NOCASE`,
      )
      .bind(organizationId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT v.contact_id AS contactId,v.field_id AS fieldId,v.value_json AS valueJson FROM crm_field_values v JOIN crm_contacts c ON c.id=v.contact_id WHERE c.organization_id=?",
      )
      .bind(organizationId)
      .all<Record<string, unknown>>(),
  ]);
  const values = new Map<string, Record<string, unknown>>();
  for (const row of valuesResult.results) {
    const current = values.get(String(row.contactId)) ?? {};
    current[String(row.fieldId)] = parseJson(row.valueJson, null);
    values.set(String(row.contactId), current);
  }
  return {
    contacts: contactsResult.results.map((row) => ({
      ...normalizeContact(row),
      customFields: values.get(String(row.id)) ?? {},
    })),
    values,
  };
}

async function requireContact(
  db: D1Database,
  organizationId: string,
  contactId: string,
) {
  const contact = await db
    .prepare("SELECT id FROM crm_contacts WHERE id=? AND organization_id=?")
    .bind(contactId, organizationId)
    .first();
  if (!contact)
    throw new HttpError(404, "contact_not_found", "Contact not found.");
}

router.get("/organizations/:organizationId/overview", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const db = database(context.env);
  const [totals, pipeline, companies, sources, recent] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM crm_contacts WHERE organization_id=?) AS contacts,(SELECT COUNT(*) FROM events WHERE organization_id=?) AS events,(SELECT COUNT(DISTINCT es.speaker_id) FROM event_speakers es JOIN events e ON e.id=es.event_id WHERE e.organization_id=?) AS activeSpeakers,(SELECT COUNT(*) FROM (SELECT es.speaker_id FROM event_speakers es JOIN events e ON e.id=es.event_id WHERE e.organization_id=? GROUP BY es.speaker_id HAVING COUNT(DISTINCT es.event_id)>1)) AS returningSpeakers`,
      )
      .bind(organizationId, organizationId, organizationId, organizationId)
      .first(),
    db
      .prepare(
        "SELECT stage,COUNT(*) AS count FROM crm_pipeline_cards WHERE organization_id=? GROUP BY stage ORDER BY stage",
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        "SELECT COALESCE(NULLIF(company,''),'Not specified') AS label,COUNT(*) AS count FROM crm_contacts WHERE organization_id=? GROUP BY label ORDER BY count DESC,label LIMIT 8",
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        "SELECT source AS label,COUNT(*) AS count FROM crm_contacts WHERE organization_id=? GROUP BY source ORDER BY count DESC,label LIMIT 8",
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        "SELECT id,subject,recipient_count AS recipientCount,status,created_at AS createdAt FROM crm_email_campaigns WHERE organization_id=? ORDER BY created_at DESC LIMIT 5",
      )
      .bind(organizationId)
      .all(),
  ]);
  return context.json({
    totals,
    pipeline: pipeline.results,
    topCompanies: companies.results,
    sources: sources.results,
    recentCampaigns: recent.results,
  });
});

router.get("/organizations/:organizationId/contacts", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const db = database(context.env);
  const { contacts, values } = await organizationContacts(db, organizationId);
  const filter = {
    search: context.req.query("search"),
    companies: context.req.queries("company") ?? [],
    jobTitles: context.req.queries("jobTitle") ?? [],
    tags: context.req.queries("tag") ?? [],
    fieldId: context.req.query("fieldId"),
    fieldValue: context.req.query("fieldValue"),
  };
  const filtered = contacts.filter((contact) =>
    matchesFilter(contact, filter, values),
  );
  const facets = {
    companies: [
      ...new Set(contacts.map((contact) => contact.company).filter(Boolean)),
    ].sort(),
    jobTitles: [
      ...new Set(contacts.map((contact) => contact.jobTitle).filter(Boolean)),
    ].sort(),
    tags: [...new Set(contacts.flatMap((contact) => contact.tags))].sort(),
  };
  return context.json({
    contacts: filtered,
    total: filtered.length,
    allTotal: contacts.length,
    facets,
    filter,
  });
});

router.get(
  "/organizations/:organizationId/contacts/export.csv",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, [...readRoles]);
    const { contacts } = await organizationContacts(
      database(context.env),
      organizationId,
    );
    const csv = [
      [
        "First Name",
        "Last Name",
        "Email",
        "Job Title",
        "Company",
        "Bio",
        "Tags",
        "Source",
      ],
      ...contacts.map((contact) => [
        contact.firstName,
        contact.lastName,
        contact.email,
        contact.jobTitle,
        contact.company,
        contact.bio,
        contact.tags.join("|"),
        contact.source,
      ]),
    ]
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
    return context.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        'attachment; filename="programloom-speaker-crm.csv"',
    });
  },
);

router.post(
  "/organizations/:organizationId/contacts",
  zValidator("json", contactSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    if (
      await db
        .prepare(
          "SELECT id FROM crm_contacts WHERE organization_id=? AND email=? COLLATE NOCASE",
        )
        .bind(organizationId, input.email)
        .first()
    )
      throw new HttpError(
        409,
        "contact_exists",
        "A contact with this email already exists.",
      );
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO crm_contacts(id,organization_id,email,first_name,last_name,pronouns,company,job_title,bio,phone,region,tags_json,social_json,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          organizationId,
          input.email,
          input.firstName,
          input.lastName,
          input.pronouns ?? null,
          input.company ?? null,
          input.jobTitle ?? null,
          input.bio ?? null,
          input.phone ?? null,
          input.region ?? null,
          JSON.stringify(input.tags),
          JSON.stringify(input.social),
          input.source,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "crm.contact.created",
        entityType: "crm_contact",
        entityId: id,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    const duplicates = await db
      .prepare(
        "SELECT id,email,first_name AS firstName,last_name AS lastName FROM crm_contacts WHERE organization_id=? AND id!=? AND lower(first_name)=lower(?) AND lower(last_name)=lower(?)",
      )
      .bind(organizationId, id, input.firstName, input.lastName)
      .all();
    return context.json(
      { contact: { id, ...input }, duplicates: duplicates.results },
      201,
    );
  },
);

router.post(
  "/organizations/:organizationId/import",
  zValidator("json", importSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const { rows, mode, eventId } = context.req.valid("json");
    const db = database(context.env);
    if (
      eventId &&
      !(await db
        .prepare("SELECT id FROM events WHERE id=? AND organization_id=?")
        .bind(eventId, organizationId)
        .first())
    )
      throw new HttpError(404, "event_not_found", "Event not found.");
    const existingResult = await db
      .prepare("SELECT id,email FROM crm_contacts WHERE organization_id=?")
      .bind(organizationId)
      .all<{ id: string; email: string }>();
    const existing = new Map(
      existingResult.results.map((row) => [row.email.toLowerCase(), row.id]),
    );
    const seen = new Set<string>();
    const issues: { row: number; email: string; message: string }[] = [];
    const statements: D1PreparedStatement[] = [];
    let created = 0;
    let updated = 0;
    rows.forEach((row, index) => {
      const email = row.email.toLowerCase();
      if (seen.has(email)) {
        issues.push({
          row: index + 2,
          email,
          message: "Duplicate email inside this file.",
        });
        return;
      }
      seen.add(email);
      const existingId = existing.get(email);
      if (existingId && mode === "create_only") {
        issues.push({
          row: index + 2,
          email,
          message: "Already exists; skipped in create-only mode.",
        });
        return;
      }
      if (!existingId && mode === "update_only") {
        issues.push({
          row: index + 2,
          email,
          message: "No existing contact; skipped in update-only mode.",
        });
        return;
      }
      if (existingId) {
        statements.push(
          db
            .prepare(
              "UPDATE crm_contacts SET first_name=?,last_name=?,pronouns=?,company=?,job_title=?,bio=?,phone=?,region=?,tags_json=?,social_json=?,source=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?",
            )
            .bind(
              row.firstName,
              row.lastName,
              row.pronouns ?? null,
              row.company ?? null,
              row.jobTitle ?? null,
              row.bio ?? null,
              row.phone ?? null,
              row.region ?? null,
              JSON.stringify(row.tags),
              JSON.stringify(row.social),
              row.source,
              existingId,
              organizationId,
            ),
        );
        updated += 1;
      } else {
        const id = crypto.randomUUID();
        statements.push(
          db
            .prepare(
              "INSERT INTO crm_contacts(id,organization_id,email,first_name,last_name,pronouns,company,job_title,bio,phone,region,tags_json,social_json,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              organizationId,
              email,
              row.firstName,
              row.lastName,
              row.pronouns ?? null,
              row.company ?? null,
              row.jobTitle ?? null,
              row.bio ?? null,
              row.phone ?? null,
              row.region ?? null,
              JSON.stringify(row.tags),
              JSON.stringify(row.social),
              row.source || "import",
            ),
        );
        existing.set(email, id);
        created += 1;
      }
    });
    if (statements.length) await db.batch(statements);
    const importedContactIds = [
      ...new Set(
        rows
          .map((row) => existing.get(row.email.toLowerCase()))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let eventSpeakersProcessed = 0;
    if (eventId && importedContactIds.length) {
      const contacts: Record<string, unknown>[] = [];
      for (let index = 0; index < importedContactIds.length; index += 90) {
        const ids = importedContactIds.slice(index, index + 90);
        const result = await db
          .prepare(
            `SELECT id,email,first_name AS firstName,last_name AS lastName,pronouns,company,job_title AS jobTitle,bio,social_json AS socialJson,speaker_profile_id AS speakerProfileId
             FROM crm_contacts WHERE organization_id=? AND id IN (${ids.map(() => "?").join(",")})`,
          )
          .bind(organizationId, ...ids)
          .all();
        contacts.push(...result.results);
      }
      const emails = contacts.map((contact) => String(contact.email));
      const existingProfiles = new Map<string, string>();
      for (let index = 0; index < emails.length; index += 90) {
        const chunk = emails.slice(index, index + 90);
        const result = await db
          .prepare(
            `SELECT id,email FROM speaker_profiles WHERE organization_id=? AND email COLLATE NOCASE IN (${chunk.map(() => "?").join(",")})`,
          )
          .bind(organizationId, ...chunk)
          .all<{ id: string; email: string }>();
        for (const profile of result.results)
          existingProfiles.set(profile.email.toLowerCase(), profile.id);
      }
      const handoffStatements: D1PreparedStatement[] = [];
      for (const contact of contacts) {
        const existingSpeakerId =
          (contact.speakerProfileId && String(contact.speakerProfileId)) ||
          existingProfiles.get(String(contact.email).toLowerCase());
        const speakerId = existingSpeakerId ?? crypto.randomUUID();
        if (!existingSpeakerId)
          handoffStatements.push(
            db
              .prepare(
                "INSERT INTO speaker_profiles(id,organization_id,email,first_name,last_name,pronouns,company,job_title,bio,social_json,portal_status) VALUES(?,?,?,?,?,?,?,?,?,?,'not_invited')",
              )
              .bind(
                speakerId,
                organizationId,
                contact.email,
                contact.firstName,
                contact.lastName,
                contact.pronouns ?? null,
                contact.company ?? null,
                contact.jobTitle ?? null,
                contact.bio ?? null,
                contact.socialJson ?? "{}",
              ),
          );
        handoffStatements.push(
          db
            .prepare(
              "UPDATE crm_contacts SET speaker_profile_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?",
            )
            .bind(speakerId, contact.id, organizationId),
          db
            .prepare(
              "INSERT OR IGNORE INTO event_speakers(event_id,speaker_id,source,added_by,status) VALUES(?,?,?,?,'confirmed')",
            )
            .bind(eventId, speakerId, "import", user.id),
        );
      }
      for (let index = 0; index < handoffStatements.length; index += 90)
        await db.batch(handoffStatements.slice(index, index + 90));
      eventSpeakersProcessed = contacts.length;
    }
    await auditStatement(db, {
      organizationId,
      actorUserId: user.id,
      action: "crm.contacts.imported",
      entityType: "crm_import",
      entityId: crypto.randomUUID(),
      after: {
        rows: rows.length,
        created,
        updated,
        issues: issues.length,
        mode,
        eventId: eventId ?? null,
        eventSpeakersProcessed,
      },
      requestId: context.get("requestId"),
    }).run();
    return context.json({
      imported: created + updated,
      created,
      updated,
      issues,
      eventSpeakersProcessed,
    });
  },
);

router.get(
  "/organizations/:organizationId/contacts/:contactId",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, [...readRoles]);
    const db = database(context.env);
    const contactId = context.req.param("contactId");
    const { contacts } = await organizationContacts(db, organizationId);
    const contact = contacts.find((item) => item.id === contactId);
    if (!contact)
      throw new HttpError(404, "contact_not_found", "Contact not found.");
    const [
      notes,
      connections,
      sessions,
      activity,
      emails,
      duplicates,
      segments,
    ] = await Promise.all([
      db
        .prepare(
          "SELECT n.id,n.body,n.created_at AS createdAt,u.name AS authorName FROM crm_contact_notes n JOIN users u ON u.id=n.author_user_id WHERE n.organization_id=? AND n.contact_id=? ORDER BY n.created_at DESC",
        )
        .bind(organizationId, contactId)
        .all(),
      db
        .prepare(
          "SELECT e.id,e.name,e.starts_at AS startsAt,e.ends_at AS endsAt,es.created_at AS addedAt FROM event_speakers es JOIN events e ON e.id=es.event_id JOIN speaker_profiles sp ON sp.id=es.speaker_id JOIN crm_contacts c ON c.speaker_profile_id=sp.id WHERE c.id=? AND c.organization_id=? ORDER BY e.starts_at DESC",
        )
        .bind(contactId, organizationId)
        .all(),
      db
        .prepare(
          "SELECT DISTINCT s.id,s.title,e.id AS eventId,e.name AS eventName FROM crm_contacts c JOIN speaker_profiles sp ON sp.id=c.speaker_profile_id JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id JOIN events e ON e.id=s.event_id WHERE c.id=? AND c.organization_id=? ORDER BY e.starts_at DESC,s.title",
        )
        .bind(contactId, organizationId)
        .all(),
      db
        .prepare(
          "SELECT id,action,after_json AS afterJson,created_at AS createdAt FROM audit_events WHERE organization_id=? AND entity_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(organizationId, contactId)
        .all(),
      db
        .prepare(
          "SELECT r.id,r.rendered_subject AS subject,r.status,r.sent_at AS sentAt,r.opened_at AS openedAt,r.clicked_at AS clickedAt,c.id AS campaignId FROM crm_email_recipients r JOIN crm_email_campaigns c ON c.id=r.campaign_id WHERE c.organization_id=? AND r.contact_id=? ORDER BY r.created_at DESC",
        )
        .bind(organizationId, contactId)
        .all(),
      db
        .prepare(
          "SELECT id,email,first_name AS firstName,last_name AS lastName,company,job_title AS jobTitle FROM crm_contacts WHERE organization_id=? AND id!=? AND lower(first_name)=lower(?) AND lower(last_name)=lower(?) ORDER BY created_at",
        )
        .bind(organizationId, contactId, contact.firstName, contact.lastName)
        .all(),
      db
        .prepare(
          "SELECT s.id,s.name,s.segment_type AS segmentType FROM crm_segment_members m JOIN crm_segments s ON s.id=m.segment_id WHERE m.contact_id=? ORDER BY s.name",
        )
        .bind(contactId)
        .all(),
    ]);
    return context.json({
      contact,
      notes: notes.results,
      connections: connections.results,
      sessions: sessions.results,
      activity: activity.results.map((item: Record<string, unknown>) => ({
        ...item,
        after: parseJson(item.afterJson, null),
        afterJson: undefined,
      })),
      emails: emails.results,
      duplicates: duplicates.results,
      segments: segments.results,
    });
  },
);

router.patch(
  "/organizations/:organizationId/contacts/:contactId",
  zValidator("json", contactPatchSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const contactId = context.req.param("contactId");
    const input = context.req.valid("json");
    const db = database(context.env);
    await requireContact(db, organizationId, contactId);
    const mapping: Record<string, string> = {
      email: "email",
      firstName: "first_name",
      lastName: "last_name",
      pronouns: "pronouns",
      company: "company",
      jobTitle: "job_title",
      bio: "bio",
      phone: "phone",
      region: "region",
      tags: "tags_json",
      social: "social_json",
      source: "source",
    };
    const fields: [string, unknown][] = [];
    for (const [key, column] of Object.entries(mapping))
      if (key in input)
        fields.push([
          column,
          key === "tags" || key === "social"
            ? JSON.stringify(input[key as keyof typeof input])
            : (input[key as keyof typeof input] ?? null),
        ]);
    if (fields.length) {
      fields.push(["updated_at", new Date().toISOString()]);
      try {
        await db
          .prepare(
            `UPDATE crm_contacts SET ${fields.map(([column]) => `${column}=?`).join(",")} WHERE id=? AND organization_id=?`,
          )
          .bind(...fields.map(([, value]) => value), contactId, organizationId)
          .run();
      } catch {
        throw new HttpError(
          409,
          "email_exists",
          "A contact with this email already exists.",
        );
      }
    }
    if (input.customFields) {
      const validFields = await db
        .prepare(
          `SELECT id FROM crm_fields WHERE organization_id=? AND id IN (${
            Object.keys(input.customFields)
              .map(() => "?")
              .join(",") || "NULL"
          })`,
        )
        .bind(organizationId, ...Object.keys(input.customFields))
        .all<{ id: string }>();
      const allowed = new Set(validFields.results.map((row) => row.id));
      const valueStatements = Object.entries(input.customFields)
        .filter(([fieldId]) => allowed.has(fieldId))
        .map(([fieldId, value]) =>
          db
            .prepare(
              "INSERT INTO crm_field_values(contact_id,field_id,value_json) VALUES(?,?,?) ON CONFLICT(contact_id,field_id) DO UPDATE SET value_json=excluded.value_json",
            )
            .bind(contactId, fieldId, JSON.stringify(value)),
        );
      if (valueStatements.length) await db.batch(valueStatements);
    }
    await auditStatement(db, {
      organizationId,
      actorUserId: user.id,
      action: "crm.contact.updated",
      entityType: "crm_contact",
      entityId: contactId,
      after: input,
      requestId: context.get("requestId"),
    }).run();
    return context.json({ contact: { id: contactId, ...input } });
  },
);

router.post(
  "/organizations/:organizationId/contacts/:contactId/notes",
  zValidator("json", noteSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const contactId = context.req.param("contactId");
    const db = database(context.env);
    await requireContact(db, organizationId, contactId);
    const id = crypto.randomUUID();
    const body = context.req.valid("json").body;
    await db.batch([
      db
        .prepare(
          "INSERT INTO crm_contact_notes(id,organization_id,contact_id,author_user_id,body) VALUES(?,?,?,?,?)",
        )
        .bind(id, organizationId, contactId, user.id, body),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "crm.contact.note_added",
        entityType: "crm_contact",
        entityId: contactId,
        after: { noteId: id },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(
      {
        note: {
          id,
          body,
          authorName: user.name,
          createdAt: new Date().toISOString(),
        },
      },
      201,
    );
  },
);

router.get("/organizations/:organizationId/fields", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const result = await database(context.env)
    .prepare(
      "SELECT id,name,field_type AS fieldType,options_json AS optionsJson,position FROM crm_fields WHERE organization_id=? ORDER BY position,name",
    )
    .bind(organizationId)
    .all<Record<string, unknown>>();
  return context.json({
    fields: result.results.map((row) => ({
      ...row,
      options: parseJson(row.optionsJson, []),
      optionsJson: undefined,
    })),
  });
});

router.post(
  "/organizations/:organizationId/fields",
  zValidator("json", fieldSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    if (
      ["select", "multiselect"].includes(input.fieldType) &&
      !input.options.length
    )
      throw new HttpError(
        400,
        "options_required",
        "Select fields need at least one option.",
      );
    const db = database(context.env);
    const id = crypto.randomUUID();
    const position = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM crm_fields WHERE organization_id=?",
          )
          .bind(organizationId)
          .first<{ position: number }>()
      )?.position ?? 0,
    );
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO crm_fields(id,organization_id,name,field_type,options_json,position) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            id,
            organizationId,
            input.name,
            input.fieldType,
            input.options.length ? JSON.stringify(input.options) : null,
            position,
          ),
        auditStatement(db, {
          organizationId,
          actorUserId: user.id,
          action: "crm.field.created",
          entityType: "crm_field",
          entityId: id,
          after: input,
          requestId: context.get("requestId"),
        }),
      ]);
    } catch {
      throw new HttpError(
        409,
        "field_exists",
        "A field with this name already exists.",
      );
    }
    return context.json({ field: { id, ...input, position } }, 201);
  },
);

router.post(
  "/organizations/:organizationId/merge",
  zValidator("json", mergeSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    if (input.duplicateIds.includes(input.primaryId))
      throw new HttpError(
        400,
        "invalid_merge",
        "The primary contact cannot also be a duplicate.",
      );
    const ids = [input.primaryId, ...input.duplicateIds];
    const db = database(context.env);
    const contacts = await db
      .prepare(
        `SELECT id,email,first_name AS firstName,last_name AS lastName,company,job_title AS jobTitle,bio,phone,region,speaker_profile_id AS speakerProfileId FROM crm_contacts WHERE organization_id=? AND id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(organizationId, ...ids)
      .all<Record<string, unknown>>();
    if (contacts.results.length !== ids.length)
      throw new HttpError(
        404,
        "contact_not_found",
        "Every merge contact must belong to this workspace.",
      );
    const byId = new Map(contacts.results.map((row) => [String(row.id), row]));
    const primary = byId.get(input.primaryId)!;
    const values: Record<string, unknown> = {};
    const columns: Record<string, string> = {
      email: "email",
      firstName: "first_name",
      lastName: "last_name",
      company: "company",
      jobTitle: "job_title",
      bio: "bio",
      phone: "phone",
      region: "region",
    };
    for (const [field, column] of Object.entries(columns)) {
      const source =
        byId.get(
          input.preferred[field as keyof typeof input.preferred] ??
            input.primaryId,
        ) ?? primary;
      values[column] = source[field] ?? null;
    }
    const primaryProfile =
      primary.speakerProfileId ??
      contacts.results.find((row) => row.speakerProfileId)?.speakerProfileId ??
      null;
    const cards = await db
      .prepare(
        `SELECT id,contact_id AS contactId FROM crm_pipeline_cards WHERE organization_id=? AND contact_id IN (${ids.map(() => "?").join(",")}) ORDER BY CASE WHEN contact_id=? THEN 0 ELSE 1 END,created_at`,
      )
      .bind(organizationId, ...ids, input.primaryId)
      .all<{ id: string; contactId: string }>();
    const targetCard = cards.results[0];
    const statements: D1PreparedStatement[] = [
      ...input.duplicateIds.map((id) =>
        db
          .prepare(
            "UPDATE crm_contacts SET email=? WHERE id=? AND organization_id=?",
          )
          .bind(`merged+${id}@invalid.programloom.local`, id, organizationId),
      ),
      db
        .prepare(
          "UPDATE crm_contacts SET email=?,first_name=?,last_name=?,company=?,job_title=?,bio=?,phone=?,region=?,speaker_profile_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?",
        )
        .bind(
          values.email,
          values.first_name,
          values.last_name,
          values.company,
          values.job_title,
          values.bio,
          values.phone,
          values.region,
          primaryProfile,
          input.primaryId,
          organizationId,
        ),
    ];
    for (const duplicateId of input.duplicateIds) {
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO crm_segment_members(segment_id,contact_id) SELECT segment_id,? FROM crm_segment_members WHERE contact_id=?",
          )
          .bind(input.primaryId, duplicateId),
        db
          .prepare(
            "INSERT OR IGNORE INTO crm_field_values(contact_id,field_id,value_json) SELECT ?,field_id,value_json FROM crm_field_values WHERE contact_id=?",
          )
          .bind(input.primaryId, duplicateId),
        db
          .prepare(
            "UPDATE crm_contact_notes SET contact_id=? WHERE contact_id=?",
          )
          .bind(input.primaryId, duplicateId),
        db
          .prepare(
            "UPDATE crm_email_recipients SET contact_id=? WHERE contact_id=?",
          )
          .bind(input.primaryId, duplicateId),
        db
          .prepare(
            "UPDATE crm_interest_submissions SET contact_id=? WHERE contact_id=?",
          )
          .bind(input.primaryId, duplicateId),
      );
    }
    if (targetCard) {
      statements.push(
        db
          .prepare("UPDATE crm_pipeline_cards SET contact_id=? WHERE id=?")
          .bind(input.primaryId, targetCard.id),
      );
      for (const card of cards.results.slice(1))
        statements.push(
          db
            .prepare(
              "UPDATE crm_contact_notes SET pipeline_card_id=? WHERE pipeline_card_id=?",
            )
            .bind(targetCard.id, card.id),
          db
            .prepare(
              "UPDATE crm_pipeline_history SET card_id=? WHERE card_id=?",
            )
            .bind(targetCard.id, card.id),
          db.prepare("DELETE FROM crm_pipeline_cards WHERE id=?").bind(card.id),
        );
    }
    statements.push(
      ...input.duplicateIds.map((id) =>
        db
          .prepare("DELETE FROM crm_contacts WHERE id=? AND organization_id=?")
          .bind(id, organizationId),
      ),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "crm.contacts.merged",
        entityType: "crm_contact",
        entityId: input.primaryId,
        after: { mergedIds: input.duplicateIds, preferred: input.preferred },
        requestId: context.get("requestId"),
      }),
    );
    try {
      await db.batch(statements);
    } catch {
      throw new HttpError(
        409,
        "merge_conflict",
        "Choose a different primary email or resolve linked records before merging.",
      );
    }
    return context.json({
      contactId: input.primaryId,
      mergedIds: input.duplicateIds,
      warning: "This merge is permanent.",
    });
  },
);

router.get("/organizations/:organizationId/segments", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const db = database(context.env);
  const segments = await db
    .prepare(
      "SELECT s.id,s.name,s.segment_type AS segmentType,s.filter_json AS filterJson,s.created_at AS createdAt,COUNT(m.contact_id) AS curatedCount FROM crm_segments s LEFT JOIN crm_segment_members m ON m.segment_id=s.id WHERE s.organization_id=? GROUP BY s.id ORDER BY s.name",
    )
    .bind(organizationId)
    .all<Record<string, unknown>>();
  const { contacts, values } = await organizationContacts(db, organizationId);
  return context.json({
    segments: segments.results.map((row) => {
      const filter = parseJson<Record<string, unknown>>(row.filterJson, {});
      const count =
        row.segmentType === "dynamic"
          ? contacts.filter((contact) => matchesFilter(contact, filter, values))
              .length
          : Number(row.curatedCount);
      return {
        ...row,
        filter,
        count,
        filterJson: undefined,
        curatedCount: undefined,
      };
    }),
  });
});

router.post(
  "/organizations/:organizationId/segments",
  zValidator("json", segmentSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO crm_segments(id,organization_id,name,segment_type,filter_json) VALUES(?,?,?,?,?)",
          )
          .bind(
            id,
            organizationId,
            input.name,
            input.segmentType,
            input.segmentType === "dynamic"
              ? JSON.stringify(input.filter)
              : null,
          ),
        ...input.contactIds.map((contactId) =>
          db
            .prepare(
              "INSERT OR IGNORE INTO crm_segment_members(segment_id,contact_id) SELECT ?,id FROM crm_contacts WHERE id=? AND organization_id=?",
            )
            .bind(id, contactId, organizationId),
        ),
        auditStatement(db, {
          organizationId,
          actorUserId: user.id,
          action: "crm.segment.created",
          entityType: "crm_segment",
          entityId: id,
          after: input,
          requestId: context.get("requestId"),
        }),
      ]);
    } catch {
      throw new HttpError(
        409,
        "segment_exists",
        "A segment with this name already exists.",
      );
    }
    return context.json({ segment: { id, ...input } }, 201);
  },
);

router.get(
  "/organizations/:organizationId/segments/:segmentId",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, [...readRoles]);
    const db = database(context.env);
    const segment = await db
      .prepare(
        "SELECT id,name,segment_type AS segmentType,filter_json AS filterJson FROM crm_segments WHERE id=? AND organization_id=?",
      )
      .bind(context.req.param("segmentId"), organizationId)
      .first<Record<string, unknown>>();
    if (!segment)
      throw new HttpError(404, "segment_not_found", "Segment not found.");
    const { contacts, values } = await organizationContacts(db, organizationId);
    const members =
      segment.segmentType === "dynamic"
        ? contacts.filter((contact) =>
            matchesFilter(contact, parseJson(segment.filterJson, {}), values),
          )
        : contacts.filter((contact) => false);
    if (segment.segmentType !== "dynamic") {
      const memberRows = await db
        .prepare(
          "SELECT contact_id AS contactId FROM crm_segment_members WHERE segment_id=?",
        )
        .bind(segment.id)
        .all<{ contactId: string }>();
      const ids = new Set(memberRows.results.map((row) => row.contactId));
      members.push(
        ...contacts.filter((contact) => ids.has(String(contact.id))),
      );
    }
    return context.json({
      segment: {
        ...segment,
        filter: parseJson(segment.filterJson, {}),
        filterJson: undefined,
      },
      contacts: members,
    });
  },
);

router.get("/organizations/:organizationId/pipeline", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const cards = await database(context.env)
    .prepare(
      "SELECT pc.id,pc.contact_id AS contactId,pc.stage,pc.score,pc.rationale,pc.position,pc.updated_at AS updatedAt,c.first_name AS firstName,c.last_name AS lastName,c.email,c.company,c.job_title AS jobTitle FROM crm_pipeline_cards pc JOIN crm_contacts c ON c.id=pc.contact_id WHERE pc.organization_id=? ORDER BY pc.stage,pc.position,pc.created_at",
    )
    .bind(organizationId)
    .all();
  return context.json({ stages, cards: cards.results });
});

router.post(
  "/organizations/:organizationId/pipeline",
  zValidator("json", enrollSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    await requireContact(db, organizationId, input.contactId);
    if (
      await db
        .prepare(
          "SELECT id FROM crm_pipeline_cards WHERE organization_id=? AND contact_id=?",
        )
        .bind(organizationId, input.contactId)
        .first()
    )
      throw new HttpError(
        409,
        "already_enrolled",
        "This contact is already in the pipeline.",
      );
    const id = crypto.randomUUID();
    const historyId = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO crm_pipeline_cards(id,organization_id,contact_id,stage,score,rationale) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          id,
          organizationId,
          input.contactId,
          input.stage,
          input.score ?? null,
          input.rationale ?? null,
        ),
      db
        .prepare(
          "INSERT INTO crm_pipeline_history(id,card_id,from_stage,to_stage,changed_by,note) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          historyId,
          id,
          null,
          input.stage,
          user.id,
          "Enrolled in pipeline",
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "crm.pipeline.enrolled",
        entityType: "pipeline_card",
        entityId: id,
        after: input,
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ card: { id, ...input } }, 201);
  },
);

router.patch(
  "/organizations/:organizationId/pipeline/:cardId",
  zValidator("json", moveSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const cardId = context.req.param("cardId");
    const input = context.req.valid("json");
    const db = database(context.env);
    const card = await db
      .prepare(
        "SELECT stage FROM crm_pipeline_cards WHERE id=? AND organization_id=?",
      )
      .bind(cardId, organizationId)
      .first<{ stage: string }>();
    if (!card)
      throw new HttpError(404, "card_not_found", "Pipeline card not found.");
    if (card.stage === input.stage)
      return context.json({ card: { id: cardId, stage: input.stage } });
    await db.batch([
      db
        .prepare(
          "UPDATE crm_pipeline_cards SET stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(input.stage, cardId),
      db
        .prepare(
          "INSERT INTO crm_pipeline_history(id,card_id,from_stage,to_stage,changed_by,note) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          cardId,
          card.stage,
          input.stage,
          user.id,
          input.note ?? null,
        ),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "crm.pipeline.moved",
        entityType: "pipeline_card",
        entityId: cardId,
        after: { fromStage: card.stage, stage: input.stage, note: input.note },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({ card: { id: cardId, stage: input.stage } });
  },
);

router.get(
  "/organizations/:organizationId/pipeline/:cardId",
  async (context) => {
    const organizationId = context.req.param("organizationId");
    await requireOrganizationRole(context, organizationId, [...readRoles]);
    const db = database(context.env);
    const cardId = context.req.param("cardId");
    const card = await db
      .prepare(
        "SELECT pc.id,pc.contact_id AS contactId,pc.stage,pc.score,pc.rationale,pc.created_at AS createdAt,pc.updated_at AS updatedAt,c.first_name AS firstName,c.last_name AS lastName,c.email,c.company,c.job_title AS jobTitle FROM crm_pipeline_cards pc JOIN crm_contacts c ON c.id=pc.contact_id WHERE pc.id=? AND pc.organization_id=?",
      )
      .bind(cardId, organizationId)
      .first();
    if (!card)
      throw new HttpError(404, "card_not_found", "Pipeline card not found.");
    const [notes, history] = await Promise.all([
      db
        .prepare(
          "SELECT n.id,n.body,n.created_at AS createdAt,u.name AS authorName FROM crm_contact_notes n JOIN users u ON u.id=n.author_user_id WHERE n.organization_id=? AND n.pipeline_card_id=? ORDER BY n.created_at DESC",
        )
        .bind(organizationId, cardId)
        .all(),
      db
        .prepare(
          "SELECT h.id,h.from_stage AS fromStage,h.to_stage AS toStage,h.note,h.created_at AS createdAt,u.name AS changedBy FROM crm_pipeline_history h JOIN users u ON u.id=h.changed_by WHERE h.card_id=? ORDER BY h.created_at DESC",
        )
        .bind(cardId)
        .all(),
    ]);
    return context.json({
      card,
      notes: notes.results,
      history: history.results,
    });
  },
);

router.post(
  "/organizations/:organizationId/pipeline/:cardId/notes",
  zValidator("json", noteSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const cardId = context.req.param("cardId");
    const db = database(context.env);
    if (
      !(await db
        .prepare(
          "SELECT id FROM crm_pipeline_cards WHERE id=? AND organization_id=?",
        )
        .bind(cardId, organizationId)
        .first())
    )
      throw new HttpError(404, "card_not_found", "Pipeline card not found.");
    const id = crypto.randomUUID();
    const body = context.req.valid("json").body;
    await db.batch([
      db
        .prepare(
          "INSERT INTO crm_contact_notes(id,organization_id,pipeline_card_id,author_user_id,body) VALUES(?,?,?,?,?)",
        )
        .bind(id, organizationId, cardId, user.id, body),
      auditStatement(db, {
        organizationId,
        actorUserId: user.id,
        action: "crm.pipeline.note_added",
        entityType: "pipeline_card",
        entityId: cardId,
        after: { noteId: id },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json(
      {
        note: {
          id,
          body,
          authorName: user.name,
          createdAt: new Date().toISOString(),
        },
      },
      201,
    );
  },
);

router.post(
  "/organizations/:organizationId/handoff",
  zValidator("json", handoffSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const contact = await db
      .prepare(
        "SELECT id,email,first_name AS firstName,last_name AS lastName,pronouns,company,job_title AS jobTitle,bio,social_json AS socialJson,speaker_profile_id AS speakerProfileId FROM crm_contacts WHERE id=? AND organization_id=?",
      )
      .bind(input.contactId, organizationId)
      .first<Record<string, unknown>>();
    if (!contact)
      throw new HttpError(404, "contact_not_found", "Contact not found.");
    if (
      !(await db
        .prepare("SELECT id FROM events WHERE id=? AND organization_id=?")
        .bind(input.eventId, organizationId)
        .first())
    )
      throw new HttpError(404, "event_not_found", "Event not found.");
    let speakerId = contact.speakerProfileId
      ? String(contact.speakerProfileId)
      : undefined;
    if (!speakerId) {
      const existing = await db
        .prepare(
          "SELECT id FROM speaker_profiles WHERE organization_id=? AND email=? COLLATE NOCASE",
        )
        .bind(organizationId, contact.email)
        .first<{ id: string }>();
      speakerId = existing?.id ?? crypto.randomUUID();
      if (!existing)
        await db
          .prepare(
            "INSERT INTO speaker_profiles(id,organization_id,email,first_name,last_name,pronouns,company,job_title,bio,social_json,portal_status) VALUES(?,?,?,?,?,?,?,?,?,?,'not_invited')",
          )
          .bind(
            speakerId,
            organizationId,
            contact.email,
            contact.firstName,
            contact.lastName,
            contact.pronouns ?? null,
            contact.company ?? null,
            contact.jobTitle ?? null,
            contact.bio ?? null,
            contact.socialJson ?? "{}",
          )
          .run();
      await db
        .prepare(
          "UPDATE crm_contacts SET speaker_profile_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(speakerId, input.contactId)
        .run();
    }
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO event_speakers(event_id,speaker_id,source,added_by) VALUES(?,?,?,?)",
        )
        .bind(input.eventId, speakerId, "crm", user.id),
      auditStatement(db, {
        organizationId,
        eventId: input.eventId,
        actorUserId: user.id,
        action: "crm.contact.handed_off",
        entityType: "crm_contact",
        entityId: input.contactId,
        after: { eventId: input.eventId, speakerId },
        requestId: context.get("requestId"),
      }),
    ]);
    return context.json({
      contactId: input.contactId,
      eventId: input.eventId,
      speakerId,
    });
  },
);

router.get("/organizations/:organizationId/templates", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const templates = await database(context.env)
    .prepare(
      "SELECT id,name,template_type AS templateType,reply_to AS replyTo,subject,body,created_at AS createdAt,updated_at AS updatedAt FROM crm_email_templates WHERE organization_id=? ORDER BY name COLLATE NOCASE",
    )
    .bind(organizationId)
    .all();
  return context.json({ templates: templates.results });
});

router.post(
  "/organizations/:organizationId/templates",
  zValidator("json", templateSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const id = crypto.randomUUID();
    try {
      await database(context.env)
        .prepare(
          "INSERT INTO crm_email_templates(id,organization_id,name,template_type,reply_to,subject,body,created_by) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          organizationId,
          input.name,
          input.templateType,
          input.replyTo ?? null,
          input.subject,
          input.body,
          user.id,
        )
        .run();
    } catch {
      throw new HttpError(
        409,
        "template_exists",
        "A template with this name already exists.",
      );
    }
    return context.json({ template: { id, ...input } }, 201);
  },
);

export function personalize(value: string, contact: Record<string, unknown>) {
  return value
    .replaceAll("{{first_name}}", String(contact.firstName))
    .replaceAll("{{last_name}}", String(contact.lastName))
    .replaceAll("{{full_name}}", `${contact.firstName} ${contact.lastName}`)
    .replaceAll("{{company}}", String(contact.company ?? ""));
}

router.post(
  "/organizations/:organizationId/outreach",
  zValidator("json", outreachSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const db = database(context.env);
    const event = await db
      .prepare("SELECT id,name FROM events WHERE id=? AND organization_id=?")
      .bind(input.eventId, organizationId)
      .first<{ id: string; name: string }>();
    if (!event)
      throw new HttpError(
        404,
        "event_not_found",
        "Choose an event from this workspace for the outreach campaign.",
      );
    const contacts = await db
      .prepare(
        `SELECT id,email,first_name AS firstName,last_name AS lastName,company FROM crm_contacts WHERE organization_id=? AND id IN (${input.contactIds.map(() => "?").join(",")})`,
      )
      .bind(organizationId, ...input.contactIds)
      .all<Record<string, unknown>>();
    if (contacts.results.length !== new Set(input.contactIds).size)
      throw new HttpError(
        404,
        "contact_not_found",
        "Every recipient must belong to this workspace.",
      );
    const campaignId = crypto.randomUUID();
    const recipientRows = contacts.results.map((contact) => ({
      id: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      contact,
      subject: personalize(input.subject, contact),
      body: personalize(input.body, contact),
    }));
    const correlationId = context.get("requestId");
    await db.batch([
      db
        .prepare(
          "INSERT INTO crm_email_campaigns(id,organization_id,event_id,template_id,subject,body,reply_to,recipient_count,status,sent_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          campaignId,
          organizationId,
          input.eventId,
          input.templateId ?? null,
          input.subject,
          input.body,
          input.replyTo ?? null,
          recipientRows.length,
          "sending",
          user.id,
        ),
      // Communication rows must precede recipients because the CRM bridge has
      // an immediate foreign key to communication_messages.
      ...recipientRows.map((row) => {
        const rendered = renderSimpleTransactionalEmail({
          recipientName: String(row.contact.firstName),
          paragraphs: row.body.split("\n").filter(Boolean),
        });
        return prepareCommunicationStatement(db, {
          id: row.messageId,
          organizationId,
          eventId: input.eventId,
          category: "crm_outreach",
          recipientEmail: String(row.contact.email),
          recipientName: `${row.contact.firstName} ${row.contact.lastName}`,
          replyTo: input.replyTo,
          subject: row.subject,
          bodyHtml: rendered.html,
          bodyText: rendered.text,
          entityType: "crm_contact",
          entityId: String(row.contact.id),
          metadata: { campaignId, recipientId: row.id },
          idempotencyKey: `crm-outreach/${campaignId}/${row.id}`,
          preparedBy: user.id,
          correlationId,
        });
      }),
      ...recipientRows.map((row) =>
        db
          .prepare(
            "INSERT INTO crm_email_recipients(id,campaign_id,contact_id,recipient_email,recipient_name,rendered_subject,rendered_body,status,communication_message_id) VALUES(?,?,?,?,?,?,?,'queued',?)",
          )
          .bind(
            row.id,
            campaignId,
            row.contact.id,
            row.contact.email,
            `${row.contact.firstName} ${row.contact.lastName}`,
            row.subject,
            row.body,
            row.messageId,
          ),
      ),
      domainEventStatement(db, {
        organizationId,
        eventId: input.eventId,
        eventType: "crm.outreach_prepared",
        entityType: "crm_campaign",
        entityId: campaignId,
        actorUserId: user.id,
        payload: { recipientCount: recipientRows.length },
        correlationId,
      }),
      auditStatement(db, {
        organizationId,
        eventId: input.eventId,
        actorUserId: user.id,
        action: "crm.outreach_prepared",
        entityType: "crm_campaign",
        entityId: campaignId,
        after: { recipients: recipientRows.length },
        requestId: correlationId,
      }),
    ]);
    let queued = 0;
    for (const row of recipientRows) {
      try {
        if (
          (
            await enqueueCommunication(
              context.env,
              row.messageId,
              correlationId,
            )
          ).queued
        )
          queued += 1;
      } catch {
        // Prepared records remain visible in Communications for retry.
      }
    }
    return context.json(
      {
        campaign: {
          id: campaignId,
          eventId: input.eventId,
          status: "sending",
          recipientCount: recipientRows.length,
          queued,
          prepared: recipientRows.length - queued,
        },
      },
      201,
    );
  },
);

router.get("/organizations/:organizationId/history", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const db = database(context.env);
  const [campaigns, recipients] = await Promise.all([
    db
      .prepare(
        "SELECT c.id,c.subject,c.recipient_count AS recipientCount,c.status,c.created_at AS createdAt,c.completed_at AS completedAt,u.name AS sentBy,SUM(CASE WHEN r.status='opened' THEN 1 ELSE 0 END) AS uniqueOpens FROM crm_email_campaigns c JOIN users u ON u.id=c.sent_by LEFT JOIN crm_email_recipients r ON r.campaign_id=c.id WHERE c.organization_id=? GROUP BY c.id ORDER BY c.created_at DESC",
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        "SELECT r.id,r.recipient_name AS recipientName,r.recipient_email AS recipientEmail,r.rendered_subject AS subject,r.status,r.sent_at AS sentAt,r.opened_at AS openedAt,r.clicked_at AS clickedAt,c.id AS campaignId,u.name AS sentBy FROM crm_email_recipients r JOIN crm_email_campaigns c ON c.id=r.campaign_id JOIN users u ON u.id=c.sent_by WHERE c.organization_id=? ORDER BY r.created_at DESC LIMIT 500",
      )
      .bind(organizationId)
      .all(),
  ]);
  return context.json({
    campaigns: campaigns.results,
    recipients: recipients.results,
  });
});

router.get("/organizations/:organizationId/interest-forms", async (context) => {
  const organizationId = context.req.param("organizationId");
  await requireOrganizationRole(context, organizationId, [...readRoles]);
  const forms = await database(context.env)
    .prepare(
      "SELECT f.id,f.name,f.slug,f.title,f.description,f.mode,f.opens_at AS opensAt,f.closes_at AS closesAt,f.event_ids_json AS eventIdsJson,f.fields_json AS fieldsJson,f.manager_ids_json AS managerIdsJson,f.notification_json AS notificationJson,f.published_at AS publishedAt,COUNT(s.id) AS submissionCount,COUNT(DISTINCT s.contact_id) AS speakerCount FROM crm_interest_forms f LEFT JOIN crm_interest_submissions s ON s.form_id=f.id WHERE f.organization_id=? GROUP BY f.id ORDER BY f.created_at DESC",
    )
    .bind(organizationId)
    .all<Record<string, unknown>>();
  return context.json({
    forms: forms.results.map((row) => ({
      ...row,
      eventIds: parseJson(row.eventIdsJson, []),
      fields: parseJson(row.fieldsJson, []),
      managerIds: parseJson(row.managerIdsJson, []),
      notification: parseJson(row.notificationJson, {}),
      eventIdsJson: undefined,
      fieldsJson: undefined,
      managerIdsJson: undefined,
      notificationJson: undefined,
    })),
  });
});

router.post(
  "/organizations/:organizationId/interest-forms",
  zValidator("json", interestFormSchema),
  async (context) => {
    const organizationId = context.req.param("organizationId");
    const { user } = await requireOrganizationRole(context, organizationId, [
      ...writeRoles,
    ]);
    const input = context.req.valid("json");
    const slug = normalizeSlug(input.slug || input.name);
    if (!slug)
      throw new HttpError(
        400,
        "invalid_slug",
        "Choose a form name containing letters or numbers.",
      );
    const db = database(context.env);
    if (input.eventIds.length) {
      const count = await db
        .prepare(
          `SELECT COUNT(*) AS count FROM events WHERE organization_id=? AND id IN (${input.eventIds.map(() => "?").join(",")}) AND ends_at>?`,
        )
        .bind(organizationId, ...input.eventIds, new Date().toISOString())
        .first<{ count: number }>();
      if (count?.count !== new Set(input.eventIds).size)
        throw new HttpError(
          400,
          "invalid_events",
          "Interest forms may target future events in this workspace only.",
        );
    }
    const id = crypto.randomUUID();
    try {
      await db
        .prepare(
          "INSERT INTO crm_interest_forms(id,organization_id,name,slug,title,description,mode,opens_at,closes_at,event_ids_json,fields_json,manager_ids_json,notification_json,published_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          organizationId,
          input.name,
          slug,
          input.title,
          input.description ?? null,
          input.mode,
          input.opensAt ?? null,
          input.closesAt ?? null,
          JSON.stringify(input.eventIds),
          JSON.stringify(input.fields),
          JSON.stringify(input.managerIds),
          JSON.stringify(input.notification),
          input.published ? new Date().toISOString() : null,
          user.id,
        )
        .run();
    } catch {
      throw new HttpError(
        409,
        "slug_taken",
        "That interest form URL is already in use.",
      );
    }
    const organization = await db
      .prepare("SELECT slug FROM organizations WHERE id=?")
      .bind(organizationId)
      .first<{ slug: string }>();
    return context.json(
      {
        form: {
          id,
          ...input,
          slug,
          publicUrl: `${context.env.MARKETING_URL}/interest/${organization?.slug}/${slug}`,
        },
      },
      201,
    );
  },
);

router.get("/public/:organizationSlug/:formSlug", async (context) => {
  const db = database(context.env);
  const form = await db
    .prepare(
      "SELECT f.id,f.title,f.description,f.mode,f.opens_at AS opensAt,f.closes_at AS closesAt,f.fields_json AS fieldsJson,o.name AS organizationName,o.slug AS organizationSlug FROM crm_interest_forms f JOIN organizations o ON o.id=f.organization_id WHERE o.slug=? COLLATE NOCASE AND f.slug=? COLLATE NOCASE AND f.published_at IS NOT NULL",
    )
    .bind(context.req.param("organizationSlug"), context.req.param("formSlug"))
    .first<Record<string, unknown>>();
  if (!form)
    throw new HttpError(404, "form_not_found", "Interest form not found.");
  const now = new Date().toISOString();
  return context.json({
    form: {
      ...form,
      fields: parseJson(form.fieldsJson, []),
      fieldsJson: undefined,
      accepting:
        (!form.opensAt || String(form.opensAt) <= now) &&
        (!form.closesAt || String(form.closesAt) > now),
    },
  });
});

router.post(
  "/public/:organizationSlug/:formSlug",
  zValidator("json", interestSubmissionSchema),
  async (context) => {
    const db = database(context.env);
    const input = context.req.valid("json");
    const form = await db
      .prepare(
        "SELECT f.id,f.organization_id AS organizationId,f.mode,f.opens_at AS opensAt,f.closes_at AS closesAt,f.fields_json AS fieldsJson FROM crm_interest_forms f JOIN organizations o ON o.id=f.organization_id WHERE o.slug=? COLLATE NOCASE AND f.slug=? COLLATE NOCASE AND f.published_at IS NOT NULL",
      )
      .bind(
        context.req.param("organizationSlug"),
        context.req.param("formSlug"),
      )
      .first<Record<string, unknown>>();
    if (!form)
      throw new HttpError(404, "form_not_found", "Interest form not found.");
    const now = new Date().toISOString();
    if (
      (form.opensAt && String(form.opensAt) > now) ||
      (form.closesAt && String(form.closesAt) <= now)
    )
      throw new HttpError(
        409,
        "form_closed",
        "This interest form is not accepting responses.",
      );
    if (
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
    const fields = parseJson<
      { key: string; label: string; required?: boolean }[]
    >(form.fieldsJson, []);
    for (const field of fields)
      if (
        field.required &&
        (input.answers[field.key] === undefined ||
          input.answers[field.key] === "")
      )
        throw new HttpError(
          400,
          "required_field",
          `${field.label} is required.`,
        );
    if (
      form.mode === "sessions_and_speakers" &&
      (!input.sessionTitle || !input.sessionAbstract)
    )
      throw new HttpError(
        400,
        "session_required",
        "Session title and abstract are required.",
      );
    let contact = await db
      .prepare(
        "SELECT id FROM crm_contacts WHERE organization_id=? AND email=? COLLATE NOCASE",
      )
      .bind(form.organizationId, input.email)
      .first<{ id: string }>();
    const contactId = contact?.id ?? crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    if (contact)
      statements.push(
        db
          .prepare(
            "UPDATE crm_contacts SET first_name=?,last_name=?,company=?,job_title=?,bio=?,source='interest_form',updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(
            input.firstName,
            input.lastName,
            input.company ?? null,
            input.jobTitle ?? null,
            input.bio ?? null,
            contactId,
          ),
      );
    else
      statements.push(
        db
          .prepare(
            "INSERT INTO crm_contacts(id,organization_id,email,first_name,last_name,company,job_title,bio,source) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            contactId,
            form.organizationId,
            input.email,
            input.firstName,
            input.lastName,
            input.company ?? null,
            input.jobTitle ?? null,
            input.bio ?? null,
            "interest_form",
          ),
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO crm_interest_submissions(id,form_id,contact_id,answers_json) VALUES(?,?,?,?)",
        )
        .bind(
          submissionId,
          form.id,
          contactId,
          JSON.stringify({
            ...input.answers,
            sessionTitle: input.sessionTitle,
            sessionAbstract: input.sessionAbstract,
          }),
        ),
      db
        .prepare(
          "INSERT OR IGNORE INTO crm_pipeline_cards(id,organization_id,contact_id,stage,rationale) VALUES(?,?,?,'identified',?)",
        )
        .bind(
          cardId,
          form.organizationId,
          contactId,
          `Submitted interest form ${form.id}`,
        ),
    );
    await db.batch(statements);
    return context.json(
      {
        ok: true,
        submissionId,
        message: "Thanks — the program team received your interest.",
      },
      201,
    );
  },
);

export default router;
