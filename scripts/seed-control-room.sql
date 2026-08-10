-- Local-only operational evidence fixture. Apply after the standard Local Conf
-- seed and migrations. All IDs are reserved for this repeatable fixture.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO submissions
  (id,form_id,event_id,title,abstract,status,decision_state,submitted_at)
VALUES
  ('cr000001-0000-4000-8000-000000000001','da1f08f0-4f32-4121-9a27-cd4a9ac2d2f1','00000000-0000-4000-8000-000000000003','Control Room: new proposal','Seeded operational proposal.','pending','none',CURRENT_TIMESTAMP),
  ('cr000001-0000-4000-8000-000000000002','da1f08f0-4f32-4121-9a27-cd4a9ac2d2f1','00000000-0000-4000-8000-000000000003','Control Room: incomplete review','Seeded review work.','pending','none',CURRENT_TIMESTAMP),
  ('cr000001-0000-4000-8000-000000000003','da1f08f0-4f32-4121-9a27-cd4a9ac2d2f1','00000000-0000-4000-8000-000000000003','Control Room: decision needed','Seeded completed review.','pending','none',CURRENT_TIMESTAMP),
  ('cr000001-0000-4000-8000-000000000004','da1f08f0-4f32-4121-9a27-cd4a9ac2d2f1','00000000-0000-4000-8000-000000000003','Control Room: staged decision','Seeded staged decision.','accepted_queue','acceptance_staged',CURRENT_TIMESTAMP),
  ('cr000001-0000-4000-8000-000000000005','da1f08f0-4f32-4121-9a27-cd4a9ac2d2f1','00000000-0000-4000-8000-000000000003','Control Room: accepted session','Seeded accepted session without placement.','accepted','accepted',CURRENT_TIMESTAMP);

UPDATE submissions SET organizer_seen_at=NULL WHERE id='cr000001-0000-4000-8000-000000000001';
UPDATE submissions SET decision_state='none',status='pending' WHERE id='cr000001-0000-4000-8000-000000000003';
UPDATE submissions SET decision_state='acceptance_staged',status='accepted_queue',decision_message_id=NULL WHERE id='cr000001-0000-4000-8000-000000000004';

INSERT OR IGNORE INTO review_assignments
  (id,round_id,submission_id,reviewer_user_id,completed_at)
VALUES
  ('cr000002-0000-4000-8000-000000000001','1d82ec9a-3608-4960-96e2-f93934d3a231','cr000001-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005',NULL),
  ('cr000002-0000-4000-8000-000000000002','1d82ec9a-3608-4960-96e2-f93934d3a231','cr000001-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005',CURRENT_TIMESTAMP);
UPDATE review_assignments SET completed_at=NULL,recused_at=NULL WHERE id='cr000002-0000-4000-8000-000000000001';
UPDATE review_assignments SET completed_at=CURRENT_TIMESTAMP WHERE id='cr000002-0000-4000-8000-000000000002';

INSERT OR IGNORE INTO review_conflicts
  (id,organization_id,event_id,round_id,assignment_id,submission_id,reviewer_user_id,conflict_type,reason)
VALUES
  ('cr000003-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','1d82ec9a-3608-4960-96e2-f93934d3a231','cr000002-0000-4000-8000-000000000001','cr000001-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','recusal','Seeded unresolved conflict for operational verification.');
UPDATE review_conflicts SET status='unresolved',resolved_by=NULL,resolved_at=NULL WHERE id='cr000003-0000-4000-8000-000000000001';

INSERT OR IGNORE INTO communication_messages
  (id,organization_id,event_id,category,recipient_email,recipient_name,subject,body_html,body_text,
   idempotency_key,status,failed_at,last_error_code,last_error,correlation_id)
VALUES
  ('cr000004-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','speaker_message','control-room-recipient@example.test','Control Room Recipient','Seeded delivery failure','<p>Operational fixture.</p>','Operational fixture.','seed:control-room:delivery','failed',CURRENT_TIMESTAMP,'fixture_failure','Seeded retryable failure.','seed-control-room');

INSERT OR IGNORE INTO speaker_profiles
  (id,organization_id,email,first_name,last_name,portal_status)
VALUES
  ('cr000005-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','control-room-speaker@example.test','Control','Speaker','not_invited');
UPDATE speaker_profiles SET user_id=NULL,headshot_key=NULL,portal_status='not_invited' WHERE id='cr000005-0000-4000-8000-000000000001';
INSERT OR IGNORE INTO session_speakers(submission_id,speaker_id,role)
VALUES('cr000001-0000-4000-8000-000000000005','cr000005-0000-4000-8000-000000000001','speaker');

INSERT OR IGNORE INTO onboarding_tasks(id,event_id,title,description,task_type,due_at,position)
VALUES('cr000006-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','Upload final slides','Seeded overdue file request.','file_request','2026-08-01T17:00:00.000Z',99);
INSERT OR IGNORE INTO speaker_task_assignments(task_id,speaker_id,status)
VALUES('cr000006-0000-4000-8000-000000000001','cr000005-0000-4000-8000-000000000001','needs_changes');
UPDATE speaker_task_assignments SET status='needs_changes',completed_at=NULL WHERE task_id='cr000006-0000-4000-8000-000000000001' AND speaker_id='cr000005-0000-4000-8000-000000000001';
INSERT OR IGNORE INTO files(id,organization_id,event_id,submission_id,speaker_id,task_id,purpose,status)
VALUES('cr000007-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','cr000001-0000-4000-8000-000000000005','cr000005-0000-4000-8000-000000000001','cr000006-0000-4000-8000-000000000001','Final presentation slides','needs_changes');
UPDATE files SET status='needs_changes' WHERE id='cr000007-0000-4000-8000-000000000001';

INSERT OR IGNORE INTO session_content_state(submission_id,status)
VALUES('cr000001-0000-4000-8000-000000000005','in_review');
UPDATE session_content_state SET status='in_review',updated_at=CURRENT_TIMESTAMP WHERE submission_id='cr000001-0000-4000-8000-000000000005';

INSERT OR IGNORE INTO agenda_items(id,event_id,item_type,title,starts_at,ends_at,status)
VALUES('cr000008-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','break','Control Room unpublished break','2027-06-10T19:00:00.000Z','2027-06-10T19:30:00.000Z','draft');
UPDATE agenda_items SET status='draft' WHERE id='cr000008-0000-4000-8000-000000000001';
INSERT OR IGNORE INTO schedule_conflict_records
  (id,organization_id,event_id,agenda_item_id,conflicting_item_id,conflict_type,summary,attempted_starts_at,attempted_ends_at)
VALUES
  ('cr000009-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','3c71234a-4fee-4f0d-8b25-17546ecb8721','6c0f3a43-500d-4a9d-97f6-1313f12b2b13','speaker','Seeded shared-speaker overlap.','2027-06-10T21:00:00.000Z','2027-06-10T22:00:00.000Z');
UPDATE schedule_conflict_records SET status='open',resolved_by=NULL,resolved_at=NULL WHERE id='cr000009-0000-4000-8000-000000000001';

INSERT OR IGNORE INTO operational_jobs
  (id,organization_id,event_id,job_kind,entity_type,entity_id,status,attempts,max_attempts,correlation_id,last_error_code,last_error)
VALUES
  ('cr000010-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','seeded_queue_job','submission','cr000001-0000-4000-8000-000000000005','exhausted',5,5,'seed-control-room','fixture_failure','Seeded exhausted job.');
UPDATE operational_jobs SET status='exhausted',attempts=max_attempts WHERE id='cr000010-0000-4000-8000-000000000001';

INSERT OR IGNORE INTO integration_outbox
  (id,organization_id,event_id,integration,action,entity_type,entity_id,payload_json,idempotency_key,last_error)
VALUES
  ('cr000011-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','airtable','upsert','submission','cr000001-0000-4000-8000-000000000005','{}','seed:control-room:airtable-outbox','Seeded Airtable retry.');
UPDATE integration_outbox SET completed_at=NULL,last_error='Seeded Airtable retry.' WHERE id='cr000011-0000-4000-8000-000000000001';
INSERT OR IGNORE INTO integration_conflicts
  (id,organization_id,event_id,integration,entity_type,entity_id,direction,reason,payload_json)
VALUES
  ('cr000012-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','airtable','submission','cr000001-0000-4000-8000-000000000005','push','Seeded reconciliation conflict.','{}');
UPDATE integration_conflicts SET status='open',resolved_at=NULL WHERE id='cr000012-0000-4000-8000-000000000001';

INSERT OR IGNORE INTO integration_incidents
  (id,organization_id,event_id,integration,incident_key,severity,summary,correlation_id)
VALUES
  ('cr000013-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','seeded_scheduler','control-room-fixture','blocking','Seeded scheduled-job failure requiring intervention.','seed-control-room');
UPDATE integration_incidents SET status='open',recovered_at=NULL WHERE id='cr000013-0000-4000-8000-000000000001';
