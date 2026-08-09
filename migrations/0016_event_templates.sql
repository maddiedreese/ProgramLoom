-- Reusable event configuration, template provenance, and recoverable creation operations.

CREATE TABLE event_program_settings (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  reviewer_routing_json TEXT NOT NULL DEFAULT '{}',
  reminder_rules_json TEXT NOT NULL DEFAULT '[]',
  locations_json TEXT NOT NULL DEFAULT '[]',
  formats_json TEXT NOT NULL DEFAULT '[]',
  content_workflow_json TEXT NOT NULL DEFAULT '{}',
  crm_handoff_defaults_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE event_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  domains_json TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, slug)
);

CREATE TABLE event_creation_operations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('event','organization_template','starter_template')),
  source_id TEXT NOT NULL,
  target_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  selected_domains_json TEXT NOT NULL,
  translated_deadlines_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','succeeded','failed')),
  failure_code TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

ALTER TABLE events ADD COLUMN source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN source_template_id TEXT REFERENCES event_templates(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN creation_operation_id TEXT REFERENCES event_creation_operations(id) ON DELETE SET NULL;

CREATE INDEX idx_event_templates_organization
  ON event_templates(organization_id, updated_at DESC);
CREATE INDEX idx_event_template_source
  ON event_templates(source_event_id, updated_at DESC);
CREATE INDEX idx_event_creation_operations_organization
  ON event_creation_operations(organization_id, created_at DESC);
CREATE INDEX idx_events_creation_provenance
  ON events(organization_id, source_event_id, source_template_id);
