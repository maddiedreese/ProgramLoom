CREATE TABLE review_round_reviewers (
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capacity INTEGER NOT NULL DEFAULT 20 CHECK (capacity BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (round_id, reviewer_user_id)
);

CREATE INDEX idx_review_round_reviewers_reviewer
  ON review_round_reviewers(reviewer_user_id, round_id);

CREATE TRIGGER review_assignment_capacity_guard
BEFORE INSERT ON review_assignments
WHEN EXISTS (
  SELECT 1 FROM review_round_reviewers
  WHERE round_id = NEW.round_id
    AND reviewer_user_id = NEW.reviewer_user_id
)
AND (
  SELECT COUNT(*) FROM review_assignments
  WHERE round_id = NEW.round_id
    AND reviewer_user_id = NEW.reviewer_user_id
    AND recused_at IS NULL
) >= (
  SELECT capacity FROM review_round_reviewers
  WHERE round_id = NEW.round_id
    AND reviewer_user_id = NEW.reviewer_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'reviewer_capacity_exceeded');
END;

ALTER TABLE event_speakers
  ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (status IN ('proposed','invited','confirmed','withdrawn'));

CREATE INDEX idx_event_speakers_event_status
  ON event_speakers(event_id, status, speaker_id);
