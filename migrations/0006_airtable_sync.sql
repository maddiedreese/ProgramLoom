CREATE TABLE integration_conflicts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration TEXT NOT NULL CHECK (integration IN ('airtable')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  external_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('push','pull')),
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  UNIQUE (organization_id, integration, entity_type, entity_id, status)
);

CREATE TABLE integration_sync_state (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration TEXT NOT NULL CHECK (integration IN ('airtable')),
  resource TEXT NOT NULL,
  cursor TEXT,
  last_started_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, integration, resource)
);

CREATE INDEX idx_integration_conflicts_open
  ON integration_conflicts(organization_id, integration, status, created_at DESC);

CREATE TABLE integration_runtime_state (
  integration TEXT PRIMARY KEY CHECK (integration IN ('airtable')),
  webhook_state TEXT NOT NULL DEFAULT 'idle'
    CHECK (webhook_state IN ('idle','queued','running','again')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
