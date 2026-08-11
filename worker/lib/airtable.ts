import type { Env } from "../env";
import { database } from "./authz";
import { eventManagerNotificationStatement } from "./notifications";

const supportedEntityTypes = [
  "organization",
  "event",
  "cfp_form",
  "form_field",
  "event_template",
  "event_program_settings",
  "crm_field",
  "submission",
  "submission_tag",
  "speaker",
  "review_assignment",
  "review_conflict",
  "review_routing_rule",
  "speaker_task",
  "agenda_item",
  "schedule_conflict",
  "crm_contact",
  "crm_import",
  "pipeline_card",
] as const;

type SupportedEntity = (typeof supportedEntityTypes)[number];
type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};
type OutboxRecord = {
  id: string;
  organizationId: string;
  eventId: string | null;
  action: string;
  entityType: SupportedEntity;
  entityId: string;
  payloadJson: string;
  attempts: number;
  availableAt: string;
  completedAt: string | null;
};
type AirtableProjection = {
  table: string;
  fields: Record<string, unknown>;
};

export function isAirtableDeletionAudit(action: string) {
  return action.includes("deleted") || action.endsWith(".assignment_removed");
}

export function airtableRecoveryAction(hasCurrentProjection: boolean) {
  return hasCurrentProjection ? "upsert" : "delete";
}

export function isStaleMergedExternalContact(input: {
  hasLocalEntity: boolean;
  hasExternalMapping: boolean;
  emailOwnerId: string | null;
  entityId: string;
}) {
  return (
    !input.hasLocalEntity &&
    input.hasExternalMapping &&
    Boolean(input.emailOwnerId && input.emailOwnerId !== input.entityId)
  );
}

function outboxRequestsDeletion(outbox: OutboxRecord) {
  if (outbox.action === "delete") return true;
  try {
    const payload = JSON.parse(outbox.payloadJson) as { action?: unknown };
    return (
      typeof payload.action === "string" &&
      isAirtableDeletionAudit(payload.action)
    );
  } catch {
    return false;
  }
}

export const speakerTaskAssignmentSql = `SELECT t.event_id AS eventId,a.speaker_id AS speakerId,t.title,a.status,t.due_at AS dueAt,
        a.response_json AS responseJson,a.updated_at AS updatedAt
 FROM speaker_task_assignments a JOIN onboarding_tasks t ON t.id=a.task_id
 WHERE a.task_id=? AND (? IS NULL OR a.speaker_id=?)
 ORDER BY a.updated_at DESC LIMIT 1`;

export function speakerTaskEntityParts(entityId: string) {
  const separator = entityId.indexOf(":");
  if (separator < 0) return { taskId: entityId, speakerId: null };
  return {
    taskId: entityId.slice(0, separator),
    speakerId: entityId.slice(separator + 1) || null,
  };
}

const pullResources = [
  { entityType: "organization", table: "PL Organizations" },
  { entityType: "event", table: "PL Events" },
  { entityType: "crm_contact", table: "PL CRM Contacts" },
  { entityType: "pipeline_card", table: "PL Pipeline Cards" },
] as const;

export async function queueAirtableAudits(
  env: Env,
  requestId: string,
): Promise<number> {
  if (!env.DB) return 0;
  const db = database(env);
  const placeholders = supportedEntityTypes.map(() => "?").join(",");
  const audits = await db
    .prepare(
      `SELECT a.id,a.organization_id AS organizationId,a.event_id AS eventId,
              a.action,a.entity_type AS entityType,a.entity_id AS entityId
       FROM audit_events a
       JOIN organizations o ON o.id=a.organization_id
       WHERE a.request_id=? AND o.storage_mode='airtable'
         AND a.entity_type IN (${placeholders})`,
    )
    .bind(requestId, ...supportedEntityTypes)
    .all<{
      id: string;
      organizationId: string;
      eventId: string | null;
      action: string;
      entityType: SupportedEntity;
      entityId: string;
    }>();
  if (!audits.results.length) return 0;
  const statements = audits.results.map((audit) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO integration_outbox
           (id,organization_id,event_id,integration,action,entity_type,entity_id,payload_json,idempotency_key)
           VALUES(?,?,?,'airtable',?,?,?,?,?)`,
      )
      .bind(
        `airtable-${audit.id}`,
        audit.organizationId,
        audit.eventId,
        isAirtableDeletionAudit(audit.action) ? "delete" : "upsert",
        audit.entityType,
        audit.entityId,
        JSON.stringify({ auditId: audit.id, action: audit.action }),
        `airtable:audit:${audit.id}`,
      ),
  );
  for (let offset = 0; offset < statements.length; offset += 80)
    await db.batch(statements.slice(offset, offset + 80));
  await sendOutboxMessages(
    env,
    audits.results.map((audit) => `airtable-${audit.id}`),
  );
  return audits.results.length;
}

export async function dispatchPendingAirtableOutbox(
  env: Env,
  limit = 50,
): Promise<number> {
  if (!env.DB || !env.JOBS) return 0;
  const rows = await database(env)
    .prepare(
      `SELECT id FROM integration_outbox
       WHERE integration='airtable' AND completed_at IS NULL AND available_at<=? AND attempts<12
       ORDER BY created_at LIMIT ?`,
    )
    .bind(new Date().toISOString(), limit)
    .all<{ id: string }>();
  await sendOutboxMessages(
    env,
    rows.results.map((row) => row.id),
  );
  return rows.results.length;
}

async function sendOutboxMessages(env: Env, ids: string[]) {
  if (!env.JOBS || !ids.length) return;
  for (let index = 0; index < ids.length; index += 100) {
    await env.JOBS.sendBatch(
      ids.slice(index, index + 100).map((outboxId) => ({
        body: { kind: "airtable_outbox", outboxId },
      })),
    );
  }
}

export async function processAirtableOutbox(
  env: Env,
  outboxId: string,
): Promise<void> {
  requireAirtable(env);
  const db = database(env);
  const outbox = await db
    .prepare(
      `SELECT id,organization_id AS organizationId,event_id AS eventId,action,entity_type AS entityType,
              entity_id AS entityId,payload_json AS payloadJson,attempts,
              available_at AS availableAt,completed_at AS completedAt
       FROM integration_outbox WHERE id=? AND integration='airtable'`,
    )
    .bind(outboxId)
    .first<OutboxRecord>();
  if (!outbox || outbox.completedAt) return;
  // A queue retry can arrive before the durable backoff expires. Acknowledge it;
  // the scheduled dispatcher will enqueue it once it is available again.
  if (new Date(outbox.availableAt).getTime() > Date.now()) return;
  const priorConflict = await db
    .prepare(
      `SELECT id FROM integration_conflicts WHERE organization_id=? AND integration='airtable'
       AND entity_type=? AND entity_id=? AND status='open' LIMIT 1`,
    )
    .bind(outbox.organizationId, outbox.entityType, outbox.entityId)
    .first<{ id: string }>();
  try {
    if (outbox.entityType === "crm_import") {
      await syncCrmCollection(env, outbox.organizationId);
    } else if (outboxRequestsDeletion(outbox)) {
      await deleteExternalEntity(env, outbox);
    } else {
      await upsertExternalEntity(env, outbox);
    }
    await db.batch([
      db
        .prepare(
          "UPDATE integration_outbox SET completed_at=?,last_error=NULL WHERE id=?",
        )
        .bind(new Date().toISOString(), outbox.id),
      db
        .prepare(resolvedConflictCompactionSql)
        .bind(outbox.organizationId, outbox.entityType, outbox.entityId),
      db
        .prepare(
          `UPDATE integration_conflicts SET status='resolved',resolved_at=?
           WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=? AND status='open'`,
        )
        .bind(
          new Date().toISOString(),
          outbox.organizationId,
          outbox.entityType,
          outbox.entityId,
        ),
      ...(priorConflict
        ? [
            eventManagerNotificationStatement(db, {
              organizationId: outbox.organizationId,
              eventId: outbox.eventId ?? undefined,
              category: "integration",
              notificationType: "integration.recovered",
              severity: "info",
              title: "Airtable synchronization recovered",
              body: "The previously conflicted record synchronized successfully.",
              actionUrl: `/app?organization=${outbox.organizationId}#airtable-integration`,
              entityType: outbox.entityType,
              entityId: outbox.entityId,
              coalesceKey: `airtable-recovered:${outbox.entityType}:${outbox.entityId}`,
            }),
          ]
        : []),
    ]);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Airtable synchronization failed.";
    const delaySeconds = Math.min(3600, 30 * 2 ** outbox.attempts);
    await db.batch([
      db
        .prepare(
          "UPDATE integration_outbox SET attempts=attempts+1,last_error=?,available_at=? WHERE id=?",
        )
        .bind(
          message.slice(0, 1000),
          new Date(Date.now() + delaySeconds * 1000).toISOString(),
          outbox.id,
        ),
      conflictStatement(db, {
        organizationId: outbox.organizationId,
        eventId: outbox.eventId,
        entityType: outbox.entityType,
        entityId: outbox.entityId,
        direction: "push",
        reason: message,
        payload: JSON.parse(outbox.payloadJson || "{}") as Record<
          string,
          unknown
        >,
      }),
      eventManagerNotificationStatement(db, {
        organizationId: outbox.organizationId,
        eventId: outbox.eventId ?? undefined,
        category: "airtable",
        notificationType: "airtable.sync_conflict",
        severity: "blocking",
        title: "An Airtable record could not synchronize",
        body: "Review the integration conflict before retrying this record.",
        actionUrl: `/app?organization=${outbox.organizationId}#airtable-integration`,
        entityType: outbox.entityType,
        entityId: outbox.entityId,
        coalesceKey: `airtable-conflict:${outbox.entityType}:${outbox.entityId}`,
      }),
    ]);
    throw error;
  }
}

// A record may fail, recover, and fail again. The schema permits only one row
// per identity and status, so compact the older resolved snapshot before the
// current open conflict transitions to resolved.
export const resolvedConflictCompactionSql = `DELETE FROM integration_conflicts
 WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=? AND status='resolved'`;

async function upsertExternalEntity(env: Env, outbox: OutboxRecord) {
  const projection = await projectEntity(
    database(env),
    outbox.entityType,
    outbox.entityId,
  );
  if (!projection) {
    // An upsert can legitimately reach the queue after its source record was
    // removed. Treat the current durable state as authoritative so retries
    // converge instead of leaving an unrecoverable conflict behind.
    await deleteExternalEntity(env, outbox);
    return;
  }
  const result = await airtableRequest<{ records: AirtableRecord[] }>(
    env,
    `/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(projection.table)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ["ProgramLoom ID"] },
        typecast: false,
        records: [
          {
            fields: cleanFields({
              "ProgramLoom ID": outbox.entityId,
              ...projection.fields,
            }),
          },
        ],
      }),
    },
  );
  const record = result.records[0];
  if (!record)
    throw new Error("Airtable did not return the synchronized record.");
  await database(env)
    .prepare(
      `INSERT INTO external_records
       (organization_id,integration,entity_type,entity_id,external_id,external_version,synced_at)
       VALUES(?,'airtable',?,?,?,?,?)
       ON CONFLICT(organization_id,integration,entity_type,entity_id)
       DO UPDATE SET external_id=excluded.external_id,external_version=excluded.external_version,synced_at=excluded.synced_at`,
    )
    .bind(
      outbox.organizationId,
      outbox.entityType,
      outbox.entityId,
      record.id,
      record.createdTime,
      new Date().toISOString(),
    )
    .run();
}

async function deleteExternalEntity(env: Env, outbox: OutboxRecord) {
  const db = database(env);
  const external = await db
    .prepare(
      `SELECT external_id AS externalId FROM external_records
       WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=?`,
    )
    .bind(outbox.organizationId, outbox.entityType, outbox.entityId)
    .first<{ externalId: string }>();
  if (!external) return;
  const table = tableForEntity(outbox.entityType);
  if (!table) return;
  await airtableRequest(
    env,
    `/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${external.externalId}`,
    { method: "DELETE" },
  );
  await db
    .prepare(
      `DELETE FROM external_records
       WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=?`,
    )
    .bind(outbox.organizationId, outbox.entityType, outbox.entityId)
    .run();
}

async function syncCrmCollection(env: Env, organizationId: string) {
  const contacts = await database(env)
    .prepare("SELECT id FROM crm_contacts WHERE organization_id=? ORDER BY id")
    .bind(organizationId)
    .all<{ id: string }>();
  for (const contact of contacts.results) {
    await upsertExternalEntity(env, {
      id: `collection-${contact.id}`,
      organizationId,
      eventId: null,
      action: "upsert",
      entityType: "crm_contact",
      entityId: contact.id,
      payloadJson: "{}",
      attempts: 0,
      availableAt: new Date().toISOString(),
      completedAt: null,
    });
  }
}

async function projectEntity(
  db: D1Database,
  entityType: SupportedEntity,
  entityId: string,
): Promise<AirtableProjection | null> {
  switch (entityType) {
    case "organization": {
      const row = await db
        .prepare(
          "SELECT name,slug,storage_mode AS storageMode,updated_at AS updatedAt FROM organizations WHERE id=?",
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Organizations", {
            Name: row.name,
            Slug: row.slug,
            "Storage Mode": row.storageMode,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "event": {
      const row = await db
        .prepare(
          `SELECT organization_id AS organizationId,name,slug,timezone,starts_at AS startsAt,ends_at AS endsAt,
           venue_name AS venue,status,source_event_id AS sourceEventId,source_template_id AS sourceTemplateId,
           creation_operation_id AS creationOperationId,updated_at AS updatedAt FROM events WHERE id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Events", {
            "Organization ID": row.organizationId,
            Name: row.name,
            Slug: row.slug,
            Timezone: row.timezone,
            "Starts At": normalizeDate(row.startsAt),
            "Ends At": normalizeDate(row.endsAt),
            Venue: row.venue,
            "Source Event ID": row.sourceEventId,
            "Source Template ID": row.sourceTemplateId,
            "Creation Operation ID": row.creationOperationId,
            Status: row.status,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "cfp_form": {
      const row = await db
        .prepare(
          "SELECT event_id AS eventId,name,slug,opens_at AS opensAt,closes_at AS closesAt,published_at AS publishedAt,allow_drafts AS allowDrafts,submission_limit AS submissionLimit,updated_at AS updatedAt FROM cfp_forms WHERE id=?",
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL CFP Forms", {
            "Event ID": row.eventId,
            Name: row.name,
            Slug: row.slug,
            "Opens At": normalizeDate(row.opensAt),
            "Closes At": normalizeDate(row.closesAt),
            Published: Boolean(row.publishedAt),
            "Configuration JSON": JSON.stringify({
              allowDrafts: Boolean(row.allowDrafts),
              submissionLimit: row.submissionLimit,
            }),
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "form_field": {
      const row = await db
        .prepare(
          `SELECT f.event_id AS eventId,ff.form_id AS formId,ff.section,
           ff.field_type AS fieldType,ff.field_key AS fieldKey,ff.label,
           ff.description,ff.placeholder,ff.required,ff.searchable,
           ff.options_json AS optionsJson,ff.validation_json AS validationJson,
           ff.position FROM form_fields ff JOIN cfp_forms f ON f.id=ff.form_id
           WHERE ff.id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Form Fields", {
            "Event ID": row.eventId,
            "Form ID": row.formId,
            Section: row.section,
            Type: row.fieldType,
            Key: row.fieldKey,
            Label: row.label,
            Description: row.description,
            Placeholder: row.placeholder,
            Required: Boolean(row.required),
            Searchable: Boolean(row.searchable),
            "Options JSON": row.optionsJson,
            "Validation JSON": row.validationJson,
            Position: row.position,
          })
        : null;
    }
    case "event_template": {
      const row = await db
        .prepare(
          `SELECT organization_id AS organizationId,source_event_id AS sourceEventId,name,slug,description,
           version,domains_json AS domainsJson,configuration_json AS configurationJson,updated_at AS updatedAt
           FROM event_templates WHERE id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Event Templates", {
            "Organization ID": row.organizationId,
            "Source Event ID": row.sourceEventId,
            Name: row.name,
            Slug: row.slug,
            Description: row.description,
            Version: row.version,
            "Domains JSON": row.domainsJson,
            "Configuration JSON": row.configurationJson,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "event_program_settings": {
      const row = await db
        .prepare(
          `SELECT event_id AS eventId,reviewer_routing_json AS reviewerRoutingJson,
           reminder_rules_json AS reminderRulesJson,locations_json AS locationsJson,
           formats_json AS formatsJson,content_workflow_json AS contentWorkflowJson,
           crm_handoff_defaults_json AS crmHandoffDefaultsJson,updated_at AS updatedAt
           FROM event_program_settings WHERE event_id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Event Program Settings", {
            "Event ID": row.eventId,
            "Reviewer Routing JSON": row.reviewerRoutingJson,
            "Reminder Rules JSON": row.reminderRulesJson,
            "Locations JSON": row.locationsJson,
            "Formats JSON": row.formatsJson,
            "Content Workflow JSON": row.contentWorkflowJson,
            "CRM Handoff Defaults JSON": row.crmHandoffDefaultsJson,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "crm_field": {
      const row = await db
        .prepare(
          `SELECT organization_id AS organizationId,name,field_type AS fieldType,
           options_json AS optionsJson,position FROM crm_fields WHERE id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL CRM Fields", {
            "Organization ID": row.organizationId,
            Name: row.name,
            Type: row.fieldType,
            "Options JSON": row.optionsJson,
            Position: row.position,
          })
        : null;
    }
    case "submission": {
      const row = await db
        .prepare(
          `SELECT s.event_id AS eventId,s.form_id AS formId,s.title,s.abstract,s.status,
           s.decision_state AS decisionState,s.answers_json AS answersJson,
           s.submitted_at AS submittedAt,s.updated_at AS updatedAt,
           COALESCE((SELECT json_group_array(json_object('id',tag.id,'name',tag.name,'color',tag.color))
             FROM submission_tag_assignments sta JOIN submission_tags tag ON tag.id=sta.tag_id
             WHERE sta.submission_id=s.id),'[]') AS tagsJson
           FROM submissions s WHERE s.id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Submissions", {
            "Event ID": row.eventId,
            "Form ID": row.formId,
            Title: row.title,
            Abstract: row.abstract,
            Status: row.status,
            "Decision State": row.decisionState,
            "Tags JSON": row.tagsJson,
            "Answers JSON": row.answersJson,
            "Submitted At": normalizeDate(row.submittedAt),
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "submission_tag": {
      const row = await db
        .prepare(
          `SELECT organization_id AS organizationId,event_id AS eventId,name,color,created_at AS createdAt
           FROM submission_tags WHERE id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Submission Tags", {
            "Organization ID": row.organizationId,
            "Event ID": row.eventId,
            Name: row.name,
            Color: row.color,
            "Created At": normalizeDate(row.createdAt),
          })
        : null;
    }
    case "speaker": {
      const row = await db
        .prepare(
          "SELECT organization_id AS organizationId,email,first_name AS firstName,last_name AS lastName,job_title AS jobTitle,company,bio,social_json AS socialJson,logistics_json AS logisticsJson,portal_status AS portalStatus,updated_at AS updatedAt FROM speaker_profiles WHERE id=?",
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Speakers", {
            "Organization ID": row.organizationId,
            Email: row.email,
            "First Name": row.firstName,
            "Last Name": row.lastName,
            "Job Title": row.jobTitle,
            Company: row.company,
            Biography: row.bio,
            "Social JSON": row.socialJson,
            "Logistics JSON": row.logisticsJson,
            "Portal Status": row.portalStatus,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "review_assignment": {
      const row = await db
        .prepare(
          `SELECT ra.round_id AS roundId,ra.submission_id AS submissionId,ra.reviewer_user_id AS reviewerId,
                  r.weighted_score AS weightedScore,r.recommendation,r.comment,r.updated_at AS updatedAt,
                  ai.score AS aiScore,ai.reasoning AS aiReasoning,ai.overridden_score AS overriddenScore
           FROM review_assignments ra
           LEFT JOIN reviews r ON r.assignment_id=ra.id
           LEFT JOIN submission_ai_assessments ai ON ai.submission_id=ra.submission_id AND ai.round_id=ra.round_id
           WHERE ra.id=? ORDER BY ai.created_at DESC LIMIT 1`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Reviews", {
            "Round ID": row.roundId,
            "Submission ID": row.submissionId,
            "Reviewer ID": row.reviewerId,
            "Weighted Score": row.weightedScore,
            Recommendation: row.recommendation,
            Comment: row.comment,
            "AI Score": row.aiScore,
            "AI Reasoning": row.aiReasoning,
            "Human Override":
              row.overriddenScore !== null && row.overriddenScore !== undefined,
            "Updated At": normalizeDate(row.updatedAt ?? new Date()),
          })
        : null;
    }
    case "review_conflict": {
      const row = await db
        .prepare(
          `SELECT event_id AS eventId,round_id AS roundId,assignment_id AS assignmentId,
                  submission_id AS submissionId,reviewer_user_id AS reviewerId,
                  conflict_type AS conflictType,reason,status,resolution_note AS resolutionNote,
                  resolved_at AS resolvedAt,created_at AS createdAt
           FROM review_conflicts WHERE id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Review Conflicts", {
            "Event ID": row.eventId,
            "Round ID": row.roundId,
            "Assignment ID": row.assignmentId,
            "Submission ID": row.submissionId,
            "Reviewer ID": row.reviewerId,
            Type: row.conflictType,
            Reason: row.reason,
            Status: row.status,
            "Resolution Note": row.resolutionNote,
            "Resolved At": normalizeDate(row.resolvedAt),
            "Created At": normalizeDate(row.createdAt),
          })
        : null;
    }
    case "review_routing_rule": {
      const row = await db
        .prepare(
          `SELECT r.organization_id AS organizationId,r.event_id AS eventId,r.name,r.description,r.priority,
                  r.enabled,r.group_operator AS groupOperator,r.round_id AS roundId,
                  r.reviewers_per_submission AS reviewersPerSubmission,r.owner_user_id AS ownerUserId,
                  r.updated_at AS updatedAt,
                  COALESCE((SELECT json_group_array(json_object(
                    'position',g.position,'operator',g.condition_operator,
                    'conditions',(SELECT json_group_array(json_object(
                      'source',c.source,'fieldId',c.field_id,'operator',c.operator,'value',json(c.value_json),'position',c.position
                    )) FROM review_routing_conditions c WHERE c.group_id=g.id ORDER BY c.position)
                  )) FROM review_routing_condition_groups g WHERE g.rule_id=r.id ORDER BY g.position),'[]') AS conditionsJson,
                  COALESCE((SELECT json_group_array(reviewer_user_id) FROM review_routing_excluded_reviewers WHERE rule_id=r.id),'[]') AS excludedReviewerIds,
                  COALESCE((SELECT json_group_array(tag_id) FROM review_routing_rule_tags WHERE rule_id=r.id),'[]') AS tagIds
           FROM review_routing_rules r WHERE r.id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Review Routing Rules", {
            "Organization ID": row.organizationId,
            "Event ID": row.eventId,
            Name: row.name,
            Description: row.description,
            Priority: row.priority,
            Enabled: Boolean(row.enabled),
            "Group Operator": row.groupOperator,
            "Round ID": row.roundId,
            "Reviewers Per Submission": row.reviewersPerSubmission,
            "Owner User ID": row.ownerUserId,
            "Conditions JSON": row.conditionsJson,
            "Excluded Reviewer IDs": row.excludedReviewerIds,
            "Tag IDs": row.tagIds,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "speaker_task": {
      const { taskId, speakerId } = speakerTaskEntityParts(entityId);
      const row = await db
        .prepare(speakerTaskAssignmentSql)
        .bind(taskId, speakerId, speakerId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Speaker Tasks", {
            "Event ID": row.eventId,
            "Speaker ID": row.speakerId,
            Title: row.title,
            Status: row.status,
            "Due At": normalizeDate(row.dueAt),
            "Response JSON": row.responseJson,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "agenda_item": {
      const row = await db
        .prepare(
          "SELECT event_id AS eventId,submission_id AS submissionId,track_id AS trackId,room_id AS roomId,title,starts_at AS startsAt,ends_at AS endsAt,status,updated_at AS updatedAt FROM agenda_items WHERE id=?",
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Agenda Items", {
            "Event ID": row.eventId,
            "Session ID": row.submissionId,
            "Track ID": row.trackId,
            "Room ID": row.roomId,
            Title: row.title,
            "Starts At": normalizeDate(row.startsAt),
            "Ends At": normalizeDate(row.endsAt),
            Status: row.status,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "schedule_conflict": {
      const row = await db
        .prepare(
          `SELECT event_id AS eventId,agenda_item_id AS agendaItemId,
                  conflicting_item_id AS conflictingItemId,conflict_type AS conflictType,
                  summary,attempted_room_id AS roomId,attempted_starts_at AS startsAt,
                  attempted_ends_at AS endsAt,status,resolved_at AS resolvedAt,created_at AS createdAt
           FROM schedule_conflict_records WHERE id=?`,
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Schedule Conflicts", {
            "Event ID": row.eventId,
            "Agenda Item ID": row.agendaItemId,
            "Conflicting Item ID": row.conflictingItemId,
            Type: row.conflictType,
            Summary: row.summary,
            "Room ID": row.roomId,
            "Starts At": normalizeDate(row.startsAt),
            "Ends At": normalizeDate(row.endsAt),
            Status: row.status,
            "Resolved At": normalizeDate(row.resolvedAt),
            "Created At": normalizeDate(row.createdAt),
          })
        : null;
    }
    case "crm_contact": {
      const row = await db
        .prepare(
          "SELECT organization_id AS organizationId,email,first_name AS firstName,last_name AS lastName,company,job_title AS jobTitle,bio,tags_json AS tagsJson,source,updated_at AS updatedAt FROM crm_contacts WHERE id=?",
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL CRM Contacts", {
            "Organization ID": row.organizationId,
            Email: row.email,
            "First Name": row.firstName,
            "Last Name": row.lastName,
            Company: row.company,
            "Job Title": row.jobTitle,
            Biography: row.bio,
            "Tags JSON": row.tagsJson,
            Source: row.source,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    case "pipeline_card": {
      const row = await db
        .prepare(
          "SELECT organization_id AS organizationId,contact_id AS contactId,stage,score,rationale,updated_at AS updatedAt FROM crm_pipeline_cards WHERE id=?",
        )
        .bind(entityId)
        .first<Record<string, unknown>>();
      return row
        ? projection("PL Pipeline Cards", {
            "Organization ID": row.organizationId,
            "Contact ID": row.contactId,
            Stage: row.stage,
            Score: row.score,
            Rationale: row.rationale,
            "Updated At": normalizeDate(row.updatedAt),
          })
        : null;
    }
    default:
      return null;
  }
}

export async function reconcileAirtableOrganizations(
  env: Env,
): Promise<number> {
  requireAirtable(env);
  const organizations = await database(env)
    .prepare(
      "SELECT id FROM organizations WHERE storage_mode='airtable' ORDER BY id",
    )
    .all<{ id: string }>();
  for (const organization of organizations.results) {
    await reconcileAirtableOrganization(env, organization.id);
  }
  return organizations.results.length;
}

export async function reconcileAirtableOrganization(
  env: Env,
  organizationId: string,
): Promise<void> {
  requireAirtable(env);
  const db = database(env);
  if (
    !(await db
      .prepare(
        "SELECT id FROM organizations WHERE id=? AND storage_mode='airtable'",
      )
      .bind(organizationId)
      .first())
  )
    return;
  for (const resource of pullResources) {
    const startedAt = new Date().toISOString();
    await markSyncStarted(db, organizationId, resource.table, startedAt);
    try {
      const formula =
        resource.entityType === "organization"
          ? `{ProgramLoom ID}='${formulaEscape(organizationId)}'`
          : `{Organization ID}='${formulaEscape(organizationId)}'`;
      const records = await listAirtableRecords(env, resource.table, formula);
      for (const record of records) {
        try {
          await applyAirtableRecord(
            env,
            organizationId,
            resource.entityType,
            resource.table,
            record,
          );
        } catch (error) {
          const entityId = String(record.fields["ProgramLoom ID"] ?? record.id);
          await conflictStatement(db, {
            organizationId,
            entityType: resource.entityType,
            entityId,
            externalId: record.id,
            direction: "pull",
            reason:
              error instanceof Error
                ? error.message
                : "Airtable reconciliation failed.",
            payload: record.fields,
          }).run();
        }
      }
      await reconcileAirtableDeletions(
        db,
        organizationId,
        resource.entityType,
        records.map((record) => record.id),
      );
      await db
        .prepare(
          `INSERT INTO integration_sync_state
           (organization_id,integration,resource,last_started_at,last_success_at,last_error)
           VALUES(?,'airtable',?,?,?,NULL)
           ON CONFLICT(organization_id,integration,resource)
           DO UPDATE SET last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,last_error=NULL,updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(
          organizationId,
          resource.table,
          startedAt,
          new Date().toISOString(),
        )
        .run();
    } catch (error) {
      await db
        .prepare(
          "UPDATE integration_sync_state SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND integration='airtable' AND resource=?",
        )
        .bind(
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Reconciliation failed.",
          organizationId,
          resource.table,
        )
        .run();
      throw error;
    }
  }
}

async function reconcileAirtableDeletions(
  db: D1Database,
  organizationId: string,
  entityType: (typeof pullResources)[number]["entityType"],
  presentExternalIds: string[],
) {
  const mappings = await db
    .prepare(
      `SELECT entity_id AS entityId,external_id AS externalId
       FROM external_records
       WHERE organization_id=? AND integration='airtable' AND entity_type=?`,
    )
    .bind(organizationId, entityType)
    .all<{ entityId: string; externalId: string }>();
  const present = new Set(presentExternalIds);
  const missing = mappings.results.filter(
    (mapping) => !present.has(mapping.externalId),
  );
  for (const mapping of missing) {
    if (entityType === "organization") {
      await conflictStatement(db, {
        organizationId,
        entityType,
        entityId: mapping.entityId,
        externalId: mapping.externalId,
        direction: "pull",
        reason:
          "The authoritative organization row was removed. Restore it or change the workspace storage mode before deleting the workspace.",
        payload: {},
      }).run();
      continue;
    }
    const table =
      entityType === "event"
        ? "events"
        : entityType === "crm_contact"
          ? "crm_contacts"
          : "crm_pipeline_cards";
    await db.batch([
      db
        .prepare(`DELETE FROM ${table} WHERE id=? AND organization_id=?`)
        .bind(mapping.entityId, organizationId),
      db
        .prepare(
          `DELETE FROM external_records
           WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=?`,
        )
        .bind(organizationId, entityType, mapping.entityId),
      db
        .prepare(
          `INSERT INTO audit_events
           (id,organization_id,action,entity_type,entity_id,before_json,after_json,request_id)
           VALUES(?,?,'airtable.deleted',?,?,?,NULL,?)`,
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          entityType,
          mapping.entityId,
          JSON.stringify({ externalId: mapping.externalId }),
          `airtable-reconcile-${crypto.randomUUID()}`,
        ),
    ]);
  }
}

async function applyAirtableRecord(
  env: Env,
  organizationId: string,
  entityType: (typeof pullResources)[number]["entityType"],
  table: string,
  record: AirtableRecord,
) {
  const db = database(env);
  let entityId = optionalString(record.fields["ProgramLoom ID"]);
  if (!entityId) {
    entityId = crypto.randomUUID();
    await airtableRequest(
      env,
      `/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${record.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fields: { "ProgramLoom ID": entityId },
          typecast: false,
        }),
      },
    );
  }
  const fields = record.fields;
  if (entityType === "organization") {
    const name = requiredString(fields.Name, "Name");
    const slug = requiredString(fields.Slug, "Slug");
    await db
      .prepare(
        "UPDATE organizations SET name=?,slug=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND storage_mode='airtable'",
      )
      .bind(name, slug, organizationId)
      .run();
  } else if (entityType === "event") {
    const startsAt = requiredDate(fields["Starts At"], "Starts At");
    const endsAt = requiredDate(fields["Ends At"], "Ends At");
    if (endsAt <= startsAt) throw new Error("Ends At must be after Starts At.");
    const owner = await db
      .prepare("SELECT created_by AS createdBy FROM organizations WHERE id=?")
      .bind(organizationId)
      .first<{ createdBy: string }>();
    if (!owner) throw new Error("Organization is unavailable.");
    await db
      .prepare(
        `INSERT INTO events
         (id,organization_id,name,slug,event_type,venue_name,timezone,starts_at,ends_at,status,created_by,updated_at)
         VALUES(?,?,?,?,'conference',?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,venue_name=excluded.venue_name,
           timezone=excluded.timezone,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,updated_at=CURRENT_TIMESTAMP
         WHERE events.organization_id=excluded.organization_id`,
      )
      .bind(
        entityId,
        organizationId,
        requiredString(fields.Name, "Name"),
        requiredString(fields.Slug, "Slug"),
        optionalString(fields.Venue),
        requiredString(fields.Timezone, "Timezone"),
        startsAt,
        endsAt,
        enumValue(fields.Status, ["draft", "active", "archived"], "Status"),
        owner.createdBy,
      )
      .run();
  } else if (entityType === "crm_contact") {
    const email = requiredString(fields.Email, "Email").toLowerCase();
    const [localEntity, externalMapping, emailOwner] = await Promise.all([
      db
        .prepare("SELECT id FROM crm_contacts WHERE id=? AND organization_id=?")
        .bind(entityId, organizationId)
        .first<{ id: string }>(),
      db
        .prepare(
          `SELECT external_id AS externalId FROM external_records
           WHERE organization_id=? AND integration='airtable' AND entity_type='crm_contact' AND entity_id=?`,
        )
        .bind(organizationId, entityId)
        .first<{ externalId: string }>(),
      db
        .prepare(
          "SELECT id FROM crm_contacts WHERE organization_id=? AND email=? COLLATE NOCASE",
        )
        .bind(organizationId, email)
        .first<{ id: string }>(),
    ]);
    if (
      isStaleMergedExternalContact({
        hasLocalEntity: Boolean(localEntity),
        hasExternalMapping: externalMapping?.externalId === record.id,
        emailOwnerId: emailOwner?.id ?? null,
        entityId,
      })
    ) {
      await airtableRequest(
        env,
        `/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${record.id}`,
        { method: "DELETE" },
      );
      const recoveredAt = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `DELETE FROM external_records
             WHERE organization_id=? AND integration='airtable' AND entity_type='crm_contact' AND entity_id=?`,
          )
          .bind(organizationId, entityId),
        db
          .prepare(resolvedConflictCompactionSql)
          .bind(organizationId, entityType, entityId),
        db
          .prepare(
            `UPDATE integration_conflicts SET status='resolved',resolved_at=?
             WHERE organization_id=? AND integration='airtable' AND entity_type=? AND entity_id=? AND status='open'`,
          )
          .bind(recoveredAt, organizationId, entityType, entityId),
        db
          .prepare(
            `INSERT INTO audit_events
             (id,organization_id,action,entity_type,entity_id,before_json,after_json,request_id)
             VALUES(?,?,'airtable.stale_merged_contact_removed','crm_contact',?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            organizationId,
            entityId,
            JSON.stringify({ externalId: record.id, email }),
            JSON.stringify({ mergedInto: emailOwner!.id, recoveredAt }),
            `airtable-reconcile-${crypto.randomUUID()}`,
          ),
        eventManagerNotificationStatement(db, {
          organizationId,
          category: "integration",
          notificationType: "integration.recovered",
          severity: "info",
          title: "Airtable synchronization recovered",
          body: "A stale contact left by a completed merge was removed from Airtable.",
          actionUrl: `/app?organization=${organizationId}#airtable-integration`,
          entityType,
          entityId,
          coalesceKey: `airtable-recovered:${entityType}:${entityId}`,
        }),
      ]);
      return;
    }
    const tags = parseStringArray(fields["Tags JSON"]);
    await db
      .prepare(
        `INSERT INTO crm_contacts
         (id,organization_id,email,first_name,last_name,company,job_title,bio,tags_json,source,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
           company=excluded.company,job_title=excluded.job_title,bio=excluded.bio,tags_json=excluded.tags_json,
           source=excluded.source,updated_at=CURRENT_TIMESTAMP
         WHERE crm_contacts.organization_id=excluded.organization_id`,
      )
      .bind(
        entityId,
        organizationId,
        email,
        requiredString(fields["First Name"], "First Name"),
        requiredString(fields["Last Name"], "Last Name"),
        optionalString(fields.Company),
        optionalString(fields["Job Title"]),
        optionalString(fields.Biography),
        JSON.stringify(tags),
        optionalString(fields.Source) ?? "airtable",
      )
      .run();
  } else {
    const contactId = requiredString(fields["Contact ID"], "Contact ID");
    if (
      !(await db
        .prepare("SELECT id FROM crm_contacts WHERE id=? AND organization_id=?")
        .bind(contactId, organizationId)
        .first())
    )
      throw new Error(
        "Contact ID does not reference a contact in this workspace.",
      );
    await db
      .prepare(
        `INSERT INTO crm_pipeline_cards(id,organization_id,contact_id,stage,score,rationale,updated_at)
         VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET contact_id=excluded.contact_id,stage=excluded.stage,score=excluded.score,
           rationale=excluded.rationale,updated_at=CURRENT_TIMESTAMP
         WHERE crm_pipeline_cards.organization_id=excluded.organization_id`,
      )
      .bind(
        entityId,
        organizationId,
        contactId,
        enumValue(
          fields.Stage,
          [
            "researching",
            "identified",
            "approved",
            "contacted",
            "interested",
            "confirmed",
            "future_fit",
            "declined",
          ],
          "Stage",
        ),
        optionalNumber(fields.Score),
        optionalString(fields.Rationale),
      )
      .run();
  }
  await db
    .prepare(
      `INSERT INTO external_records
       (organization_id,integration,entity_type,entity_id,external_id,external_version,synced_at)
       VALUES(?,'airtable',?,?,?,?,?)
       ON CONFLICT(organization_id,integration,entity_type,entity_id)
       DO UPDATE SET external_id=excluded.external_id,external_version=excluded.external_version,synced_at=excluded.synced_at`,
    )
    .bind(
      organizationId,
      entityType,
      entityId,
      record.id,
      record.createdTime,
      new Date().toISOString(),
    )
    .run();
}

async function listAirtableRecords(env: Env, table: string, formula: string) {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const query = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
    });
    if (offset) query.set("offset", offset);
    const page = await airtableRequest<{
      records: AirtableRecord[];
      offset?: string;
    }>(
      env,
      `/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${query}`,
    );
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

export async function verifyAirtableWebhook(
  env: Env,
  rawBody: string,
  receivedMac: string | undefined,
) {
  if (!env.AIRTABLE_WEBHOOK_MAC_SECRET || !receivedMac) return false;
  const secret = Uint8Array.from(
    atob(env.AIRTABLE_WEBHOOK_MAC_SECRET),
    (character) => character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const expected = `hmac-sha256=${[...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  return timingSafeEqual(expected, receivedMac);
}

export async function queueAirtableReconciliation(env: Env) {
  if (!env.JOBS || !env.DB) return false;
  const db = database(env);
  await db
    .prepare(
      "INSERT OR IGNORE INTO integration_runtime_state (integration,webhook_state) VALUES ('airtable','idle')",
    )
    .run();
  const current = await db
    .prepare(
      "SELECT webhook_state AS webhookState FROM integration_runtime_state WHERE integration='airtable'",
    )
    .first<{ webhookState: "idle" | "queued" | "running" | "again" }>();
  if (current?.webhookState === "queued" || current?.webhookState === "again")
    return false;
  if (current?.webhookState === "running") {
    await db
      .prepare(
        "UPDATE integration_runtime_state SET webhook_state='again',updated_at=CURRENT_TIMESTAMP WHERE integration='airtable'",
      )
      .run();
    return false;
  }
  await db
    .prepare(
      "UPDATE integration_runtime_state SET webhook_state='queued',updated_at=CURRENT_TIMESTAMP WHERE integration='airtable'",
    )
    .run();
  try {
    await env.JOBS.send({ kind: "airtable_reconcile" }, { delaySeconds: 10 });
    return true;
  } catch (error) {
    await db
      .prepare(
        "UPDATE integration_runtime_state SET webhook_state='idle',updated_at=CURRENT_TIMESTAMP WHERE integration='airtable'",
      )
      .run();
    throw error;
  }
}

export async function beginAirtableReconciliation(env: Env) {
  await database(env)
    .prepare(
      `INSERT INTO integration_runtime_state (integration,webhook_state)
       VALUES ('airtable','running')
       ON CONFLICT(integration) DO UPDATE SET webhook_state='running',updated_at=CURRENT_TIMESTAMP`,
    )
    .run();
}

export async function finishAirtableReconciliation(env: Env) {
  const db = database(env);
  const current = await db
    .prepare(
      "SELECT webhook_state AS webhookState FROM integration_runtime_state WHERE integration='airtable'",
    )
    .first<{ webhookState: string }>();
  await db
    .prepare(
      "UPDATE integration_runtime_state SET webhook_state='idle',updated_at=CURRENT_TIMESTAMP WHERE integration='airtable'",
    )
    .run();
  if (current?.webhookState === "again") await queueAirtableReconciliation(env);
}

export async function refreshAirtableWebhook(env: Env) {
  if (!env.AIRTABLE_WEBHOOK_ID) return;
  await airtableRequest(
    env,
    `/v0/bases/${env.AIRTABLE_BASE_ID}/webhooks/${env.AIRTABLE_WEBHOOK_ID}/payloads?limit=1`,
  );
}

export async function integrationStatus(env: Env, organizationId: string) {
  const db = database(env);
  const [outbox, conflicts, states, external] = await Promise.all([
    db
      .prepare(
        `SELECT SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN completed_at IS NULL AND last_error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
                MAX(completed_at) AS lastCompletedAt
         FROM integration_outbox WHERE organization_id=? AND integration='airtable'`,
      )
      .bind(organizationId)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id,entity_type AS entityType,entity_id AS entityId,direction,reason,created_at AS createdAt
         FROM integration_conflicts WHERE organization_id=? AND integration='airtable' AND status='open'
         ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        `SELECT resource,last_started_at AS lastStartedAt,last_success_at AS lastSuccessAt,last_error AS lastError
         FROM integration_sync_state WHERE organization_id=? AND integration='airtable' ORDER BY resource`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        `SELECT COUNT(*) AS count,MAX(synced_at) AS lastSyncedAt FROM external_records
         WHERE organization_id=? AND integration='airtable'`,
      )
      .bind(organizationId)
      .first<Record<string, unknown>>(),
  ]);
  return {
    configured: Boolean(env.AIRTABLE_ACCESS_TOKEN && env.AIRTABLE_BASE_ID),
    pending: Number(outbox?.pending ?? 0),
    failed: Number(outbox?.failed ?? 0),
    lastCompletedAt: outbox?.lastCompletedAt ?? null,
    externalRecords: Number(external?.count ?? 0),
    lastSyncedAt: external?.lastSyncedAt ?? null,
    conflicts: conflicts.results,
    resources: states.results,
  };
}

async function markSyncStarted(
  db: D1Database,
  organizationId: string,
  resource: string,
  startedAt: string,
) {
  await db
    .prepare(
      `INSERT INTO integration_sync_state
       (organization_id,integration,resource,last_started_at)
       VALUES(?,'airtable',?,?)
       ON CONFLICT(organization_id,integration,resource)
       DO UPDATE SET last_started_at=excluded.last_started_at,updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(organizationId, resource, startedAt)
    .run();
}

function conflictStatement(
  db: D1Database,
  input: {
    organizationId: string;
    eventId?: string | null;
    entityType: string;
    entityId: string;
    externalId?: string;
    direction: "push" | "pull";
    reason: string;
    payload: Record<string, unknown>;
  },
) {
  return db
    .prepare(
      `INSERT INTO integration_conflicts
       (id,organization_id,event_id,integration,entity_type,entity_id,external_id,direction,reason,payload_json)
       VALUES(?,?,?,'airtable',?,?,?,?,?,?)
       ON CONFLICT(organization_id,integration,entity_type,entity_id,status)
       DO UPDATE SET external_id=excluded.external_id,direction=excluded.direction,reason=excluded.reason,
         payload_json=excluded.payload_json,created_at=CURRENT_TIMESTAMP,resolved_at=NULL`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.eventId ?? null,
      input.entityType,
      input.entityId,
      input.externalId ?? null,
      input.direction,
      input.reason.slice(0, 1000),
      JSON.stringify(input.payload),
    );
}

async function airtableRequest<T = unknown>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  requireAirtable(env);
  const response = await fetch(`https://api.airtable.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.AIRTABLE_ACCESS_TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    // Airtable error bodies can echo field values. Keep provider responses out
    // of operational records and structured logs.
    await response.body?.cancel();
    throw new Error(`Airtable request failed with status ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function requireAirtable(env: Env) {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  if (!env.AIRTABLE_ACCESS_TOKEN || !env.AIRTABLE_BASE_ID)
    throw new Error("Airtable synchronization is not configured.");
}

function tableForEntity(entityType: SupportedEntity) {
  const tables: Partial<Record<SupportedEntity, string>> = {
    organization: "PL Organizations",
    event: "PL Events",
    cfp_form: "PL CFP Forms",
    form_field: "PL Form Fields",
    event_template: "PL Event Templates",
    event_program_settings: "PL Event Program Settings",
    crm_field: "PL CRM Fields",
    submission: "PL Submissions",
    submission_tag: "PL Submission Tags",
    speaker: "PL Speakers",
    review_assignment: "PL Reviews",
    review_conflict: "PL Review Conflicts",
    speaker_task: "PL Speaker Tasks",
    agenda_item: "PL Agenda Items",
    schedule_conflict: "PL Schedule Conflicts",
    crm_contact: "PL CRM Contacts",
    pipeline_card: "PL Pipeline Cards",
  };
  return tables[entityType];
}

function projection(table: string, fields: Record<string, unknown>) {
  return { table, fields };
}

function cleanFields(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requiredDate(value: unknown, label: string) {
  const normalized = normalizeDate(value);
  if (!normalized) throw new Error(`${label} must be a valid date and time.`);
  return normalized;
}

function requiredString(value: unknown, label: string) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Score must be numeric.");
  if (number < 0 || number > 100)
    throw new Error("Score must be between 0 and 100.");
  return number;
}

function enumValue<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T {
  if (!options.includes(String(value) as T))
    throw new Error(`${label} is not a supported value.`);
  return String(value) as T;
}

function parseStringArray(value: unknown) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === "string")
    )
      throw new Error();
    return parsed;
  } catch {
    throw new Error("Tags JSON must be an array of strings.");
  }
}

function formulaEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
