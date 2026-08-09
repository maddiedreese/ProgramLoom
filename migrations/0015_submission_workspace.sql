-- Reusable submission views, taxonomy, and confirmed bulk-operation state.
ALTER TABLE form_fields ADD COLUMN searchable INTEGER NOT NULL DEFAULT 0
  CHECK (searchable IN (0,1));

CREATE TABLE submission_tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT '#68756b',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,name)
);

CREATE TABLE submission_tag_assignments (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES submission_tags(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(submission_id,tag_id)
);

CREATE TABLE submission_saved_views (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'personal'
    CHECK (visibility IN ('personal','organization')),
  config_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,owner_user_id,name)
);

CREATE TABLE submission_view_defaults (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_id TEXT NOT NULL REFERENCES submission_saved_views(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(event_id,user_id)
);

CREATE TABLE submission_bulk_previews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selection_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  matched_count INTEGER NOT NULL CHECK(matched_count >= 0),
  sample_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_submission_tags_event_name
  ON submission_tags(event_id,name);
CREATE INDEX idx_submission_tag_assignments_tag
  ON submission_tag_assignments(tag_id,submission_id);
CREATE INDEX idx_saved_views_event_visibility
  ON submission_saved_views(event_id,visibility,updated_at DESC);
CREATE INDEX idx_saved_views_owner
  ON submission_saved_views(event_id,owner_user_id,updated_at DESC);
CREATE INDEX idx_bulk_previews_expiry
  ON submission_bulk_previews(expires_at,consumed_at);
CREATE INDEX idx_submissions_event_form_date
  ON submissions(event_id,form_id,submitted_at DESC,id);
CREATE INDEX idx_submissions_event_format
  ON submissions(event_id,format,status);
CREATE INDEX idx_reviews_assignment_score
  ON reviews(assignment_id,submitted_at,weighted_score);
