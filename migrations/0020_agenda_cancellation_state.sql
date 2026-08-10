-- Preserve cancelled agenda and calendar history without exposing cancelled
-- items on public surfaces or blocking later agenda publication.

ALTER TABLE agenda_items ADD COLUMN cancelled_at TEXT;
ALTER TABLE agenda_items ADD COLUMN cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_agenda_event_cancelled_status
  ON agenda_items(event_id, cancelled_at, status, starts_at);
