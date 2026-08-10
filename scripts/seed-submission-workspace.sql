-- Local-only high-volume evidence fixture for bounded workspace queries.
-- Apply after migrations and the standard Local Conf seed.
PRAGMA foreign_keys = ON;

DELETE FROM submissions WHERE id LIKE 'workspace-load-%';

WITH RECURSIVE sequence(value) AS (
  SELECT 1
  UNION ALL
  SELECT value + 1 FROM sequence WHERE value < 1200
)
INSERT INTO submissions
  (id,form_id,event_id,title,abstract,format,duration_minutes,status,
   decision_state,answers_json,submitted_at,created_at,updated_at)
SELECT
  printf('workspace-load-%04d',value),
  'da1f08f0-4f32-4121-9a27-cd4a9ac2d2f1',
  '00000000-0000-4000-8000-000000000003',
  printf('Workspace load proposal %04d',value),
  printf('Persisted performance fixture for proposal %04d.',value),
  CASE value % 4 WHEN 0 THEN 'Workshop' WHEN 1 THEN 'Talk' WHEN 2 THEN 'Panel' ELSE 'Lightning talk' END,
  CASE value % 4 WHEN 0 THEN 90 WHEN 1 THEN 45 WHEN 2 THEN 60 ELSE 10 END,
  CASE value % 6 WHEN 0 THEN 'draft' WHEN 1 THEN 'accepted_queue' WHEN 2 THEN 'decline_queue' ELSE 'pending' END,
  CASE value % 6 WHEN 1 THEN 'acceptance_staged' WHEN 2 THEN 'rejection_staged' ELSE 'none' END,
  json_object(
    'session_title',printf('Workspace load proposal %04d',value),
    'session_format',CASE value % 4 WHEN 0 THEN 'Workshop' WHEN 1 THEN 'Talk' WHEN 2 THEN 'Panel' ELSE 'Lightning talk' END
  ),
  CASE WHEN value % 6 = 0 THEN NULL ELSE datetime('now',printf('-%d minutes',value)) END,
  datetime('now',printf('-%d minutes',value)),
  datetime('now',printf('-%d minutes',value))
FROM sequence;

WITH RECURSIVE sequence(value) AS (
  SELECT 1
  UNION ALL
  SELECT value + 1 FROM sequence WHERE value < 1200
)
INSERT INTO submission_people
  (id,submission_id,email,name,role,organization)
SELECT
  printf('workspace-person-%04d',value),
  printf('workspace-load-%04d',value),
  printf('workspace-speaker-%04d@example.test',value),
  printf('Workspace Speaker %04d',value),
  'primary',
  printf('Fixture Organization %02d',value % 24)
FROM sequence;

INSERT INTO submission_tags
  (id,organization_id,event_id,name,color,created_by)
VALUES
  ('workspace-tag-priority','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','Priority fixture','#315c45','00000000-0000-4000-8000-000000000001')
ON CONFLICT(event_id,name) DO NOTHING;

INSERT OR IGNORE INTO submission_tag_assignments(submission_id,tag_id,assigned_by)
SELECT id,'workspace-tag-priority','00000000-0000-4000-8000-000000000001'
FROM submissions WHERE id LIKE 'workspace-load-%' AND CAST(substr(id,-4) AS INTEGER) % 5 = 0;
