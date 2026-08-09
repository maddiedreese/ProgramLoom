PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  avatar_key TEXT,
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  storage_mode TEXT NOT NULL DEFAULT 'native' CHECK (storage_mode IN ('native','airtable')),
  airtable_base_id_encrypted TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent_hash TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','register','invite')),
  token_hash TEXT NOT NULL UNIQUE,
  redirect_path TEXT NOT NULL DEFAULT '/app',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE,
  event_type TEXT NOT NULL DEFAULT 'conference',
  website_url TEXT,
  venue_name TEXT,
  address TEXT,
  timezone TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  logo_key TEXT,
  primary_color TEXT NOT NULL DEFAULT '#315c45',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, slug),
  CHECK (ends_at >= starts_at)
);

CREATE TABLE event_members (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','speaker')),
  invited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id, role)
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin','reviewer','speaker')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, slug)
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, name)
);

CREATE TABLE cfp_forms (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  opens_at TEXT,
  closes_at TEXT,
  edit_closes_at TEXT,
  allow_drafts INTEGER NOT NULL DEFAULT 1,
  submission_limit INTEGER,
  confirmation_subject TEXT,
  confirmation_body TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, slug)
);

CREATE TABLE form_fields (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES cfp_forms(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('welcome','session','speaker','custom')),
  field_type TEXT NOT NULL CHECK (field_type IN ('text','textarea','number','email','url','select','multiselect','checkbox','date','file')),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  placeholder TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  validation_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (form_id, field_key)
);

CREATE TABLE form_conditions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES cfp_forms(id) ON DELETE CASCADE,
  source_field_id TEXT NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  operator TEXT NOT NULL CHECK (operator IN ('equals','not_equals','contains','greater_than','less_than','is_checked')),
  compare_value_json TEXT,
  target_field_id TEXT NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('show','hide','require'))
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES cfp_forms(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submitter_user_id TEXT REFERENCES users(id),
  edit_token_hash TEXT,
  title TEXT NOT NULL DEFAULT '',
  abstract TEXT NOT NULL DEFAULT '',
  format TEXT,
  duration_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','accepted_queue','accepted','decline_queue','declined','withdrawn')),
  answers_json TEXT NOT NULL DEFAULT '{}',
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE submission_tracks (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (submission_id, track_id)
);

CREATE TABLE submission_people (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary','coauthor','moderator','panelist')),
  organization TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE review_rounds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_blind INTEGER NOT NULL DEFAULT 0,
  opens_at TEXT,
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  UNIQUE (event_id, position)
);

CREATE TABLE scorecard_fields (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('numeric','select','text')),
  options_json TEXT,
  min_value REAL,
  max_value REAL,
  weight REAL NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE review_assignments (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recused_at TEXT,
  recusal_reason TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (round_id, submission_id, reviewer_user_id)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES review_assignments(id) ON DELETE CASCADE UNIQUE,
  answers_json TEXT NOT NULL DEFAULT '{}',
  weighted_score REAL,
  recommendation TEXT CHECK (recommendation IN ('approve','maybe','deny')),
  comment TEXT,
  ai_score REAL,
  ai_reasoning TEXT,
  ai_model TEXT,
  human_override INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE speaker_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL COLLATE NOCASE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  pronouns TEXT,
  job_title TEXT,
  company TEXT,
  bio TEXT,
  headshot_key TEXT,
  social_json TEXT NOT NULL DEFAULT '{}',
  logistics_json TEXT NOT NULL DEFAULT '{}',
  portal_status TEXT NOT NULL DEFAULT 'not_invited' CHECK (portal_status IN ('not_invited','invited','active','complete')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, email)
);

CREATE TABLE session_speakers (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  speaker_id TEXT NOT NULL REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'speaker',
  PRIMARY KEY (submission_id, speaker_id)
);

CREATE TABLE onboarding_tasks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('action','form','file_request')),
  due_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE speaker_task_assignments (
  task_id TEXT NOT NULL REFERENCES onboarding_tasks(id) ON DELETE CASCADE,
  speaker_id TEXT NOT NULL REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','submitted','complete','needs_changes')),
  response_json TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, speaker_id)
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submissions(id) ON DELETE CASCADE,
  speaker_id TEXT REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','approved','needs_changes')),
  current_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (file_id, version_number)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('submission','file','speaker','agenda_item','pipeline_card')),
  entity_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT
);

CREATE TABLE agenda_items (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL DEFAULT 'session' CHECK (item_type IN ('session','break','hold')),
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','published')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE schedule_constraints (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  constraint_type TEXT NOT NULL CHECK (constraint_type IN ('speaker_availability','dependency','track_balance','room_capacity')),
  subject_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE email_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  template_key TEXT,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','complained','failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE crm_contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  speaker_profile_id TEXT REFERENCES speaker_profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company TEXT,
  job_title TEXT,
  bio TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, email)
);

CREATE TABLE crm_fields (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text','number','date','select','multiselect','checkbox')),
  options_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (organization_id, name)
);

CREATE TABLE crm_field_values (
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES crm_fields(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL,
  PRIMARY KEY (contact_id, field_id)
);

CREATE TABLE crm_pipeline_cards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('researching','identified','approved','contacted','interested','confirmed','future_fit','declined')),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  rationale TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, contact_id)
);

CREATE TABLE crm_pipeline_history (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES crm_pipeline_cards(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE crm_segments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  segment_type TEXT NOT NULL CHECK (segment_type IN ('dynamic','curated')),
  filter_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name)
);

CREATE TABLE crm_segment_members (
  segment_id TEXT NOT NULL REFERENCES crm_segments(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (segment_id, contact_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE integration_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration TEXT NOT NULL CHECK (integration IN ('airtable','resend','posthog')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE external_records (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_version TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, integration, entity_type, entity_id),
  UNIQUE (organization_id, integration, entity_type, external_id)
);

CREATE INDEX idx_events_org ON events(organization_id);
CREATE INDEX idx_event_members_user ON event_members(user_id, event_id);
CREATE INDEX idx_submissions_event_status ON submissions(event_id, status);
CREATE INDEX idx_review_assignments_reviewer ON review_assignments(reviewer_user_id, round_id, completed_at);
CREATE INDEX idx_speakers_org_name ON speaker_profiles(organization_id, last_name, first_name);
CREATE INDEX idx_agenda_event_time ON agenda_items(event_id, starts_at, room_id);
CREATE INDEX idx_email_status ON email_messages(status, created_at);
CREATE INDEX idx_crm_contacts_org_name ON crm_contacts(organization_id, last_name, first_name);
CREATE INDEX idx_crm_pipeline_stage ON crm_pipeline_cards(organization_id, stage, position);
CREATE INDEX idx_audit_org_created ON audit_events(organization_id, created_at DESC);
CREATE INDEX idx_outbox_ready ON integration_outbox(integration, completed_at, available_at);
