-- Repair historical state created when replacement uploads retained completion
-- timestamps and when agenda publication did not yet enforce content approval.
UPDATE speaker_task_assignments
SET completed_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE status <> 'complete' AND completed_at IS NOT NULL;

UPDATE agenda_items
SET status = 'draft',
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'published'
  AND cancelled_at IS NULL
  AND submission_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM submissions s
    JOIN session_content_state cs
      ON cs.submission_id = s.id AND cs.status = 'approved'
    WHERE s.id = agenda_items.submission_id
      AND s.event_id = agenda_items.event_id
      AND s.status = 'accepted'
  );
