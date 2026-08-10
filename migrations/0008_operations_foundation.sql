-- Durable communications, notifications, domain-event, and operational-job foundations.
-- These tables are additive so existing delivery and Airtable history remains intact.

CREATE TABLE communication_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'submission_confirmation','draft_reminder','deadline_reminder',
    'reviewer_invitation','reviewer_reminder','change_request',
    'decision_acceptance','decision_waitlist','decision_rejection',
    'speaker_invitation','onboarding_reminder','content_reminder',
    'scheduling_notice','calendar_invitation','calendar_update',
    'calendar_cancellation','speaker_message','crm_outreach'
  )),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  merge_fields_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, category, name)
);

CREATE TABLE communication_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES communication_templates(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL COLLATE NOCASE,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  sensitive_data_json TEXT,
  sensitive_expires_at TEXT,
  attachment_manifest_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared','queued','processing','sent','delivered','bounced',
    'failed','cancelled'
  )),
  provider_id TEXT,
  provider_event_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  scheduled_for TEXT,
  queued_at TEXT,
  processing_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  bounced_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  last_attempt_at TEXT,
  last_error_code TEXT,
  last_error TEXT,
  prepared_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE communication_attempts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES communication_messages(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','accepted','failed','bounced','delivered')),
  error_code TEXT,
  error_message TEXT,
  request_id TEXT,
  job_id TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE (message_id, attempt_number)
);

CREATE TABLE communication_delivery_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES communication_messages(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_event_type TEXT NOT NULL,
  provider_created_at TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload_hash TEXT NOT NULL
);

CREATE TABLE domain_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'submission','review','decision','speaker','task','file','content',
    'agenda','delivery','queue','airtable','integration'
  )),
  notification_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','blocking')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  coalesce_key TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  archived_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_notifications_active_coalesce
  ON notifications(recipient_user_id, coalesce_key)
  WHERE coalesce_key IS NOT NULL AND archived_at IS NULL;

CREATE TABLE notification_preferences (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0,1)),
  email_enabled INTEGER NOT NULL DEFAULT 0 CHECK (email_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_notification_preferences_scope
  ON notification_preferences(organization_id, COALESCE(event_id, ''), user_id, category);

CREATE TABLE operational_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  job_kind TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','processing','succeeded','retrying','exhausted','cancelled'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  last_error TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE integration_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  integration TEXT NOT NULL,
  incident_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning','blocking')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','recovered')),
  summary TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recovered_at TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  correlation_id TEXT,
  UNIQUE (organization_id, integration, incident_key)
);

ALTER TABLE audit_events ADD COLUMN correlation_id TEXT;

CREATE INDEX idx_communication_templates_event_category
  ON communication_templates(event_id, category, updated_at DESC);
CREATE INDEX idx_communication_messages_event_status_date
  ON communication_messages(event_id, status, created_at DESC);
CREATE INDEX idx_communication_messages_recipient
  ON communication_messages(event_id, recipient_email, created_at DESC);
CREATE INDEX idx_communication_messages_scheduled
  ON communication_messages(status, scheduled_for, created_at);
CREATE INDEX idx_communication_attempts_message
  ON communication_attempts(message_id, attempt_number DESC);
CREATE INDEX idx_domain_events_ready
  ON domain_events(status, available_at, created_at);
CREATE INDEX idx_notifications_recipient_unread
  ON notifications(recipient_user_id, read_at, last_occurred_at DESC);
CREATE INDEX idx_notifications_event_category
  ON notifications(event_id, category, severity, last_occurred_at DESC);
CREATE INDEX idx_operational_jobs_ready
  ON operational_jobs(status, available_at, created_at);
CREATE INDEX idx_operational_jobs_event_status
  ON operational_jobs(event_id, status, updated_at DESC);
CREATE INDEX idx_integration_incidents_open
  ON integration_incidents(organization_id, status, last_seen_at DESC);
CREATE INDEX idx_audit_event_correlation
  ON audit_events(correlation_id, created_at DESC);
