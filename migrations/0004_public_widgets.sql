CREATE TABLE widget_configs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  widget_type TEXT NOT NULL CHECK (widget_type IN ('sessions','speakers','agenda','itinerary','gallery')),
  public_key TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_widget_configs_event ON widget_configs(event_id, widget_type);
