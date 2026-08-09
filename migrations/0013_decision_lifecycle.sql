-- Decision state is independent from the legacy workflow status so waitlists
-- and communication staging do not overload submission review status.
ALTER TABLE submissions ADD COLUMN decision_state TEXT NOT NULL DEFAULT 'none'
  CHECK (decision_state IN (
    'none','acceptance_staged','waitlist_staged','rejection_staged',
    'accepted','waitlisted','rejected'
  ));
ALTER TABLE submissions ADD COLUMN decision_staged_at TEXT;
ALTER TABLE submissions ADD COLUMN decision_staged_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN decision_message_id TEXT REFERENCES communication_messages(id) ON DELETE SET NULL;

UPDATE submissions SET decision_state=CASE status
  WHEN 'accepted_queue' THEN 'acceptance_staged'
  WHEN 'decline_queue' THEN 'rejection_staged'
  WHEN 'accepted' THEN 'accepted'
  WHEN 'declined' THEN 'rejected'
  ELSE 'none'
END;

CREATE TABLE submission_decision_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  message_id TEXT REFERENCES communication_messages(id) ON DELETE SET NULL,
  changed_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_submissions_event_decision
  ON submissions(event_id, decision_state, updated_at DESC);
CREATE INDEX idx_submission_decision_history_submission
  ON submission_decision_history(submission_id, created_at DESC);

