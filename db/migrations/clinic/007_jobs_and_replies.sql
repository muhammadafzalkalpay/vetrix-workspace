-- Milestone 4: scheduled jobs and replies to texts.
-- Messages remember which pet and visit they are about, so a reply ("C",
-- "YES", "REFILL") acts on the right one. job_runs records when a daily job
-- last ran at a location, so a missed or repeated tick never sends twice.

ALTER TABLE messages
  ADD COLUMN patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL;
CREATE INDEX messages_client_id_created_at_idx ON messages (client_id, created_at DESC);

CREATE TABLE job_runs (
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  job text NOT NULL,
  run_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (location_id, job, run_date)
);
