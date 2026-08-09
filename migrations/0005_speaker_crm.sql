ALTER TABLE crm_contacts ADD COLUMN pronouns TEXT;
ALTER TABLE crm_contacts ADD COLUMN phone TEXT;
ALTER TABLE crm_contacts ADD COLUMN region TEXT;
ALTER TABLE crm_contacts ADD COLUMN headshot_key TEXT;
ALTER TABLE crm_contacts ADD COLUMN social_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE event_speakers (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  speaker_id TEXT NOT NULL REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'crm',
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, speaker_id)
);

CREATE TABLE crm_contact_notes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES crm_contacts(id) ON DELETE CASCADE,
  pipeline_card_id TEXT REFERENCES crm_pipeline_cards(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((contact_id IS NOT NULL) != (pipeline_card_id IS NOT NULL))
);

CREATE TABLE crm_interest_forms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE,
  title TEXT NOT NULL,
  description TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('speakers_only','sessions_and_speakers')),
  opens_at TEXT,
  closes_at TEXT,
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  fields_json TEXT NOT NULL DEFAULT '[]',
  manager_ids_json TEXT NOT NULL DEFAULT '[]',
  notification_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, slug)
);

CREATE TABLE crm_interest_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES crm_interest_forms(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE crm_email_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'outreach' CHECK (template_type IN ('outreach','event_invite','follow_up')),
  reply_to TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name)
);

CREATE TABLE crm_email_campaigns (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES crm_email_templates(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to TEXT,
  recipient_count INTEGER NOT NULL CHECK (recipient_count > 0),
  status TEXT NOT NULL CHECK (status IN ('sending','sent','partial','failed')),
  sent_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE crm_email_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES crm_email_campaigns(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES crm_contacts(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  rendered_subject TEXT NOT NULL,
  rendered_body TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','complained','failed')),
  last_error TEXT,
  sent_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_speakers_event ON event_speakers(event_id, created_at);
CREATE INDEX idx_crm_notes_contact ON crm_contact_notes(contact_id, created_at DESC);
CREATE INDEX idx_crm_notes_card ON crm_contact_notes(pipeline_card_id, created_at DESC);
CREATE INDEX idx_crm_interest_forms_org ON crm_interest_forms(organization_id, created_at DESC);
CREATE INDEX idx_crm_campaigns_org ON crm_email_campaigns(organization_id, created_at DESC);
CREATE INDEX idx_crm_recipients_campaign ON crm_email_recipients(campaign_id, status);
