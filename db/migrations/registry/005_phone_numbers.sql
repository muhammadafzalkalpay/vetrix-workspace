-- Milestone 3: which clinic location answers each phone number.
-- Twilio calls our webhooks with the number that was dialled or texted; this
-- table routes it to the organization (and so its clinic database) and the
-- location inside it.

CREATE TABLE phone_numbers (
  e164 text PRIMARY KEY CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_numbers_organization_id_idx ON phone_numbers (organization_id);
