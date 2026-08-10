-- Reconcile file-request tasks that were assigned before accepted speakers
-- received durable upload records. Future acceptances create these atomically.

INSERT INTO files
  (id, organization_id, event_id, submission_id, speaker_id, task_id, purpose)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-' ||
    '4' || substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  e.organization_id,
  task.event_id,
  (
    SELECT submission.id
    FROM session_speakers session_speaker
    JOIN submissions submission ON submission.id = session_speaker.submission_id
    WHERE session_speaker.speaker_id = assignment.speaker_id
      AND submission.event_id = task.event_id
      AND submission.status = 'accepted'
    ORDER BY submission.created_at, submission.id
    LIMIT 1
  ),
  assignment.speaker_id,
  task.id,
  task.title
FROM speaker_task_assignments assignment
JOIN onboarding_tasks task ON task.id = assignment.task_id
JOIN events e ON e.id = task.event_id
WHERE task.task_type = 'file_request'
  AND EXISTS (
    SELECT 1
    FROM session_speakers session_speaker
    JOIN submissions submission ON submission.id = session_speaker.submission_id
    WHERE session_speaker.speaker_id = assignment.speaker_id
      AND submission.event_id = task.event_id
      AND submission.status = 'accepted'
  )
  AND NOT EXISTS (
    SELECT 1 FROM files existing
    WHERE existing.event_id = task.event_id
      AND existing.speaker_id = assignment.speaker_id
      AND existing.task_id = task.id
  );
