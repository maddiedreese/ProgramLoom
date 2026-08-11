PRAGMA foreign_keys = ON;

CREATE TABLE review_routing_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100 CHECK(priority >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  group_operator TEXT NOT NULL DEFAULT 'and' CHECK(group_operator IN ('and','or')),
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  reviewers_per_submission INTEGER NOT NULL DEFAULT 2 CHECK(reviewers_per_submission BETWEEN 1 AND 20),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,name)
);

CREATE TABLE review_routing_condition_groups (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES review_routing_rules(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  condition_operator TEXT NOT NULL DEFAULT 'and' CHECK(condition_operator IN ('and','or')),
  UNIQUE(rule_id,position)
);

CREATE TABLE review_routing_conditions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES review_routing_condition_groups(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('form','track','format','tag','custom_field')),
  field_id TEXT,
  operator TEXT NOT NULL CHECK(operator IN ('equals','not_equals','contains','not_contains','in','is_set','is_not_set')),
  value_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE(group_id,position)
);

CREATE TABLE review_routing_excluded_reviewers (
  rule_id TEXT NOT NULL REFERENCES review_routing_rules(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(rule_id,reviewer_user_id)
);

CREATE TABLE review_routing_rule_tags (
  rule_id TEXT NOT NULL REFERENCES review_routing_rules(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES submission_tags(id) ON DELETE CASCADE,
  PRIMARY KEY(rule_id,tag_id)
);

CREATE TABLE review_routing_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('submission','manual','preview')),
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submission_count INTEGER NOT NULL DEFAULT 0 CHECK(submission_count >= 0),
  matched_count INTEGER NOT NULL DEFAULT 0 CHECK(matched_count >= 0),
  assignment_count INTEGER NOT NULL DEFAULT 0 CHECK(assignment_count >= 0),
  skipped_conflict_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_conflict_count >= 0),
  skipped_capacity_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_capacity_count >= 0),
  unmatched_count INTEGER NOT NULL DEFAULT 0 CHECK(unmatched_count >= 0),
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  failure_reason TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE review_routing_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES review_routing_runs(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES review_routing_rules(id) ON DELETE SET NULL,
  round_id TEXT REFERENCES review_rounds(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('matched','unmatched','assigned','already_assigned','conflict_skipped','capacity_skipped','no_eligible_reviewer')),
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE submission_routing_state (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  matched_rule_id TEXT REFERENCES review_routing_rules(id) ON DELETE SET NULL,
  round_id TEXT REFERENCES review_rounds(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('matched','unmatched','partially_assigned','assigned')),
  assignment_count INTEGER NOT NULL DEFAULT 0 CHECK(assignment_count >= 0),
  required_assignment_count INTEGER NOT NULL DEFAULT 0 CHECK(required_assignment_count >= 0),
  last_run_id TEXT REFERENCES review_routing_runs(id) ON DELETE SET NULL,
  last_routed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE submission_owners (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  source_rule_id TEXT REFERENCES review_routing_rules(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_review_routing_rules_event_priority
  ON review_routing_rules(event_id,enabled,priority,id);
CREATE INDEX idx_review_routing_groups_rule_position
  ON review_routing_condition_groups(rule_id,position);
CREATE INDEX idx_review_routing_conditions_group_position
  ON review_routing_conditions(group_id,position);
CREATE INDEX idx_review_routing_runs_event_time
  ON review_routing_runs(event_id,started_at DESC,id);
CREATE INDEX idx_review_routing_results_run_submission
  ON review_routing_results(run_id,submission_id,outcome);
CREATE INDEX idx_submission_routing_state_event_status
  ON submission_routing_state(event_id,status,last_routed_at DESC);
CREATE INDEX idx_submission_owners_event_owner
  ON submission_owners(event_id,owner_user_id,updated_at DESC);
