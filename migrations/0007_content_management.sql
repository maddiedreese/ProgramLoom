ALTER TABLE events ADD COLUMN file_uploads_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (file_uploads_enabled IN (0,1));

ALTER TABLE files ADD COLUMN task_id TEXT REFERENCES onboarding_tasks(id) ON DELETE SET NULL;

CREATE TABLE session_content_state (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_revisions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id),
  restored_from_id TEXT REFERENCES content_revisions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (submission_id, version_number)
);

CREATE TABLE content_exports (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','ready','failed')),
  grouping TEXT NOT NULL CHECK (grouping IN ('session','speaker','flat')),
  selected_file_ids_json TEXT NOT NULL,
  r2_key TEXT,
  size_bytes INTEGER,
  error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE file_share_links (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX idx_files_event_task ON files(event_id, task_id, speaker_id);
CREATE INDEX idx_content_revisions_submission ON content_revisions(submission_id, version_number DESC);
CREATE INDEX idx_content_exports_event ON content_exports(event_id, created_at DESC);
