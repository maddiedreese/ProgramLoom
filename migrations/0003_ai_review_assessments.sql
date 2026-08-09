CREATE TABLE submission_ai_assessments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasoning TEXT NOT NULL,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  overridden_score REAL CHECK (overridden_score IS NULL OR overridden_score BETWEEN 0 AND 100),
  override_reason TEXT,
  overridden_by TEXT REFERENCES users(id),
  overridden_at TEXT
);

CREATE INDEX idx_ai_assessments_submission ON submission_ai_assessments(submission_id, created_at DESC);
