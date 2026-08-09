-- Participant-addressed calendar invitations are durable records. Public itinerary
-- feeds remain generated independently from published agenda items.

CREATE TABLE event_calendar_settings (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_rule TEXT NOT NULL DEFAULT 'on_placement' CHECK (delivery_rule IN (
    'on_placement','on_publication','manual'
  )),
  organizer_name TEXT NOT NULL,
  organizer_email TEXT NOT NULL COLLATE NOCASE,
  send_updates_automatically INTEGER NOT NULL DEFAULT 1 CHECK (send_updates_automatically IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE calendar_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
  speaker_id TEXT NOT NULL REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  attendee_email TEXT NOT NULL COLLATE NOCASE,
  attendee_name TEXT NOT NULL,
  uid TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','cancelled')),
  material_hash TEXT NOT NULL,
  last_revision_id TEXT,
  last_message_id TEXT REFERENCES communication_messages(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agenda_item_id, speaker_id),
  UNIQUE (event_id, uid, speaker_id)
);

CREATE TABLE calendar_revisions (
  id TEXT PRIMARY KEY,
  calendar_record_id TEXT NOT NULL REFERENCES calendar_records(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES communication_messages(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  method TEXT NOT NULL CHECK (method IN ('REQUEST','CANCEL')),
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  ics_r2_key TEXT NOT NULL,
  material_hash TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (calendar_record_id, sequence, method)
);

CREATE INDEX idx_calendar_records_event_state
  ON calendar_records(event_id, state, updated_at DESC);
CREATE INDEX idx_calendar_records_agenda
  ON calendar_records(agenda_item_id, speaker_id);
CREATE INDEX idx_calendar_records_attendee
  ON calendar_records(event_id, attendee_email, updated_at DESC);
CREATE INDEX idx_calendar_revisions_record
  ON calendar_revisions(calendar_record_id, created_at DESC);

