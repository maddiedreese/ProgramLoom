-- Persist operational ownership and conflicts while keeping Control Room counts
-- derived from authoritative business records.
ALTER TABLE submissions ADD COLUMN organizer_seen_at TEXT;
ALTER TABLE integration_outbox ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE integration_conflicts ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE SET NULL;

CREATE TABLE review_conflicts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES review_rounds(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES review_assignments(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('recusal','declared','detected')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved','resolved','overridden')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schedule_conflict_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  conflicting_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('room','speaker')),
  summary TEXT NOT NULL,
  attempted_room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  attempted_starts_at TEXT NOT NULL,
  attempted_ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agenda_item_id, conflicting_item_id, conflict_type, status)
);

CREATE TABLE control_room_issue_owners (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, category, entity_type, entity_id)
);

CREATE INDEX idx_submissions_event_seen
  ON submissions(event_id, organizer_seen_at, submitted_at DESC);
CREATE INDEX idx_review_conflicts_event_status
  ON review_conflicts(event_id, status, created_at DESC);
CREATE INDEX idx_review_conflicts_reviewer
  ON review_conflicts(event_id, reviewer_user_id, status);
CREATE UNIQUE INDEX idx_review_conflicts_active_identity
  ON review_conflicts(event_id, COALESCE(round_id,''), submission_id, reviewer_user_id, conflict_type)
  WHERE status='unresolved';
CREATE INDEX idx_schedule_conflicts_event_status
  ON schedule_conflict_records(event_id, status, created_at DESC);
CREATE INDEX idx_control_room_owners_event
  ON control_room_issue_owners(event_id, owner_user_id, category);
CREATE INDEX idx_integration_outbox_event_pending
  ON integration_outbox(event_id, completed_at, available_at);
CREATE INDEX idx_integration_conflicts_event_open
  ON integration_conflicts(event_id, status, created_at DESC);
CREATE INDEX idx_review_assignments_round_state
  ON review_assignments(round_id, completed_at, recused_at, created_at);
CREATE INDEX idx_speaker_tasks_due_state
  ON speaker_task_assignments(status, task_id, speaker_id);
CREATE INDEX idx_agenda_event_publication
  ON agenda_items(event_id, status, updated_at DESC);
