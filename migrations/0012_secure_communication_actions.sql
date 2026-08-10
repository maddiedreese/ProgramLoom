-- One-time action tokens let durable messages carry sensitive links without
-- persisting raw credentials in dedicated token columns or logs.
CREATE TABLE communication_action_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES communication_messages(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('submission_edit')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_communication_action_tokens_entity
  ON communication_action_tokens(event_id, entity_type, entity_id, expires_at DESC);
CREATE INDEX idx_communication_action_tokens_active
  ON communication_action_tokens(token_hash, expires_at)
  WHERE used_at IS NULL;

