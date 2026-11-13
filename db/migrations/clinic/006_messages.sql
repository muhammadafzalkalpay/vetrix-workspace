-- Milestone 4 (messages page): staff can text and email clients, and every
-- message has a creation time, so queued and failed messages sort correctly.

ALTER TABLE messages
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN subject text,
  ADD COLUMN sent_by uuid REFERENCES staff_users(id),
  ADD COLUMN error text;

-- Existing rows: their send time is the best creation time we have.
UPDATE messages SET created_at = sent_at WHERE sent_at IS NOT NULL;

CREATE INDEX messages_location_id_created_at_idx ON messages (location_id, created_at DESC);
