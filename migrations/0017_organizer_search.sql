-- Durable, authorization-revalidated recent destinations and bounded search indexes.

CREATE TABLE search_recent_destinations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'event','cfp_form','submission','session','speaker','crm_contact',
    'reviewer','task','file','resource','saved_view','communication'
  )),
  entity_id TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE INDEX idx_search_recent_user_date
  ON search_recent_destinations(user_id,last_accessed_at DESC);
CREATE INDEX idx_events_org_search
  ON events(organization_id,name COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_cfp_forms_event_search
  ON cfp_forms(event_id,name COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_submissions_event_search
  ON submissions(event_id,title COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_agenda_event_search
  ON agenda_items(event_id,title COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_speakers_org_search
  ON speaker_profiles(organization_id,last_name COLLATE NOCASE,first_name COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_crm_contacts_org_search
  ON crm_contacts(organization_id,last_name COLLATE NOCASE,first_name COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_tasks_event_search
  ON onboarding_tasks(event_id,title COLLATE NOCASE,due_at);
CREATE INDEX idx_files_event_search
  ON files(event_id,purpose COLLATE NOCASE,updated_at DESC);
CREATE INDEX idx_resources_event_search
  ON resources(event_id,title COLLATE NOCASE,updated_at DESC);
