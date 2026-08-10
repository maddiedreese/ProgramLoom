-- Notification-center query coverage and durable optional-channel delivery state.

CREATE TABLE notification_channel_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email')),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared','queued','sent','failed','cancelled','skipped'
  )),
  message_id TEXT REFERENCES communication_messages(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (notification_id, channel)
);

CREATE INDEX idx_notifications_recipient_filter
  ON notifications(recipient_user_id,archived_at,event_id,category,severity,read_at,last_occurred_at DESC);
CREATE INDEX idx_notifications_retention
  ON notifications(archived_at,expires_at,last_occurred_at);
CREATE INDEX idx_notification_delivery_ready
  ON notification_channel_deliveries(status,created_at);
