-- Associate CRM outreach with an event and the durable communication outbox.
ALTER TABLE crm_email_campaigns ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE crm_email_recipients ADD COLUMN communication_message_id TEXT REFERENCES communication_messages(id) ON DELETE SET NULL;
ALTER TABLE communication_messages ADD COLUMN reply_to TEXT;

CREATE INDEX idx_crm_campaigns_event
  ON crm_email_campaigns(event_id, created_at DESC);
CREATE UNIQUE INDEX idx_crm_recipient_communication
  ON crm_email_recipients(communication_message_id)
  WHERE communication_message_id IS NOT NULL;
