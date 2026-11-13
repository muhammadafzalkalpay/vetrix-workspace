-- Milestone 3: the AI front desk.
-- A "call" row now covers any front desk conversation: a phone call or a
-- text thread. Turns hold the transcript in the clinic database; they are
-- deleted with the call under the location's retention setting.

ALTER TABLE calls
  ADD COLUMN channel text NOT NULL DEFAULT 'voice' CHECK (channel IN ('voice', 'sms')),
  ADD COLUMN sandbox boolean NOT NULL DEFAULT false,
  ADD COLUMN triage_level text NOT NULL DEFAULT 'routine' CHECK (triage_level IN ('routine', 'urgent', 'emergency')),
  ADD COLUMN summary text,
  ADD COLUMN ended_at timestamptz,
  -- Conversation state between turns (phase, chosen pet, offered times).
  ADD COLUMN state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX calls_location_id_triage_idx ON calls (location_id, triage_level, started_at DESC);

CREATE TABLE call_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  seq int NOT NULL CHECK (seq > 0),
  speaker text NOT NULL CHECK (speaker IN ('caller', 'ai', 'system')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, seq)
);

-- Staff tasks gain a title and a due time; urgent alerts surface on the dashboard.
ALTER TABLE staff_tasks
  ADD COLUMN title text,
  ADD COLUMN due_at timestamptz;

-- Triage events record the evidence (the matched phrase or cue).
ALTER TABLE triage_events
  ADD COLUMN evidence text;
