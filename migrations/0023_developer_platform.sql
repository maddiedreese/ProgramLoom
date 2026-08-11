PRAGMA foreign_keys = ON;

ALTER TABLE submissions ADD COLUMN api_deleted_at TEXT;
ALTER TABLE crm_contacts ADD COLUMN api_deleted_at TEXT;

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["read:events"]',
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  hide_pii INTEGER NOT NULL DEFAULT 1 CHECK(hide_pii IN (0,1)),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_tokens_organization_status
  ON api_tokens(organization_id,revoked_at,created_at DESC);
CREATE INDEX idx_api_tokens_prefix
  ON api_tokens(token_prefix,revoked_at);

CREATE TABLE api_idempotency_records (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  route_template TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE(token_id,idempotency_key)
);

CREATE INDEX idx_api_idempotency_expiry
  ON api_idempotency_records(expires_at);

CREATE TABLE api_rate_limits (
  token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(token_id,window_start)
);

CREATE TABLE api_usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  route_template TEXT NOT NULL,
  result_status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_usage_token_time
  ON api_usage_events(token_id,created_at DESC);

CREATE TABLE api_webhook_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  entity_types_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT
);

CREATE INDEX idx_api_webhook_subscriptions_org_enabled
  ON api_webhook_subscriptions(organization_id,enabled,updated_at DESC);

CREATE TABLE api_webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES api_webhook_subscriptions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  audit_event_id TEXT NOT NULL REFERENCES audit_events(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','delivered','retrying','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TEXT,
  delivered_at TEXT,
  response_status INTEGER,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subscription_id,audit_event_id)
);

CREATE INDEX idx_api_webhook_deliveries_dispatch
  ON api_webhook_deliveries(status,next_attempt_at,created_at);
CREATE INDEX idx_api_webhook_deliveries_subscription_time
  ON api_webhook_deliveries(subscription_id,created_at DESC);

CREATE TABLE api_download_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  api_token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_download_grants_expiry
  ON api_download_grants(expires_at);

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  client_secret_hash TEXT,
  scopes_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE oauth_authorization_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oauth_codes_expiry ON oauth_authorization_codes(expires_at);
