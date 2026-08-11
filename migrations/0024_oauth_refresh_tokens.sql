PRAGMA foreign_keys = ON;

CREATE TABLE oauth_refresh_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  api_token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL,
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  replaced_by_id TEXT REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oauth_refresh_tokens_expiry
  ON oauth_refresh_tokens(expires_at,revoked_at);
