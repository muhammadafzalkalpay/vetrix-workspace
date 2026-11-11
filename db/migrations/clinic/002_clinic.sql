-- Vetrix clinic database: 57 tables.
-- Run this in the vetrix_demo_clinic database. Run the whole file once, in order.
-- platform_user_ref, config_pack_ref and vertical_id point to the registry.
-- They are stored IDs, because a foreign key cannot cross databases.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 3: locations and settings (11 tables)
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_id text NOT NULL,
  vertical_locked boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  address text,
  timezone text NOT NULL,
  main_phone text,
  website text,
  live_at timestamptz,
  status text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'live', 'paused', 'closed'))
);

CREATE TABLE location_species (
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  species text NOT NULL,
  PRIMARY KEY (location_id, species)
);

CREATE TABLE location_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  CHECK (closes_at > opens_at),
  UNIQUE (location_id, weekday, opens_at)
);

CREATE TABLE location_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text,
  UNIQUE (location_id, holiday_date)
);

CREATE TABLE location_after_hours (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  er_name text,
  er_phone text,
  er_address text,
  behaviour text NOT NULL DEFAULT 'er_and_book_next' CHECK (behaviour IN ('er_only', 'er_and_book_next'))
);

CREATE TABLE location_policies (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  cancellation_window_hours int NOT NULL DEFAULT 24 CHECK (cancellation_window_hours >= 0),
  cancellation_fee numeric(10, 2),
  surgery_deposit numeric(10, 2),
  new_client_policy text,
  payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  refill_turnaround text,
  records_release_policy text,
  telehealth_enabled boolean NOT NULL DEFAULT false,
  recording_retention_months int NOT NULL DEFAULT 12 CHECK (recording_retention_months > 0)
);

CREATE TABLE location_phone_settings (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  forward_number text,
  greeting_text text,
  ai_persona_name text NOT NULL DEFAULT 'Riley',
  emergency_transfer_number text,
  staff_transfer_number text,
  voicemail_fallback text
);

CREATE TABLE location_messaging_settings (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  sms_sender_name text,
  consent_language text,
  opt_out_handling text,
  quiet_start time NOT NULL DEFAULT '20:00',
  quiet_end time NOT NULL DEFAULT '08:00'
);

CREATE TABLE location_pack_configs (
  location_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  config_pack_ref uuid NOT NULL,
  pack_version text NOT NULL,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE onboarding_steps (
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  step_number smallint NOT NULL CHECK (step_number BETWEEN 1 AND 10),
  mandatory boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),
  completed_at timestamptz,
  PRIMARY KEY (location_id, step_number)
);

CREATE TABLE go_live_checks (
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  PRIMARY KEY (location_id, check_key)
);

-- Step 4: staff access (5 tables)
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE permissions (
  id text PRIMARY KEY,
  description text
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions (permission_id);

CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_ref uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled'))
);

CREATE TABLE staff_location_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  UNIQUE (staff_user_id, location_id, role_id)
);
CREATE INDEX staff_location_roles_location_id_idx ON staff_location_roles (location_id);
CREATE INDEX staff_location_roles_role_id_idx ON staff_location_roles (role_id);

-- Step 5: clients and patients (7 tables)
-- households and clients point to each other, so primary_client_id gets its key after clients exists.
CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  primary_client_id uuid,
  address text
);
CREATE INDEX households_location_id_idx ON households (location_id);
CREATE INDEX households_primary_client_id_idx ON households (primary_client_id);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  household_id uuid REFERENCES households(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  mobile text NOT NULL,
  email citext,
  alt_phone text,
  address text,
  preferred_channel text NOT NULL DEFAULT 'sms' CHECK (preferred_channel IN ('sms', 'email', 'call')),
  sms_consent boolean NOT NULL DEFAULT false,
  sms_consent_at timestamptz,
  sms_consent_source text,
  marketing_consent boolean NOT NULL DEFAULT false,
  notes text,
  no_show_count int NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
  source text NOT NULL CHECK (source IN ('phone_ai', 'web', 'import', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, mobile)
);
CREATE INDEX clients_household_id_idx ON clients (household_id);

ALTER TABLE households
  ADD CONSTRAINT households_primary_client_id_fkey
  FOREIGN KEY (primary_client_id) REFERENCES clients(id);

CREATE TABLE client_flags (
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  flag text NOT NULL CHECK (flag IN ('vip', 'payment_issue', 'difficult', 'do_not_contact', 'do_not_call')),
  PRIMARY KEY (client_id, flag)
);

CREATE TABLE client_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('sms', 'marketing')),
  granted boolean NOT NULL,
  source text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_consents_client_id_idx ON client_consents (client_id, captured_at DESC);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  species text NOT NULL CHECK (species IN ('dog', 'cat', 'rabbit', 'bird', 'reptile', 'other')),
  breed text,
  sex text CHECK (sex IN ('male', 'female')),
  neutered boolean,
  date_of_birth date,
  approx_age_months int CHECK (approx_age_months >= 0),
  weight_kg numeric(6, 2) CHECK (weight_kg > 0),
  color_markings text,
  microchip_number text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deceased', 'transferred', 'inactive')),
  provisional boolean NOT NULL DEFAULT false,
  deceased_date date,
  medical_alerts text,
  active_prescriptions boolean NOT NULL DEFAULT false,
  last_wellness_exam_at date,
  last_dental_at date,
  last_surgery_at date,
  referring_clinic text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_client_id_idx ON patients (client_id);
CREATE INDEX patients_location_id_status_idx ON patients (location_id, status);

CREATE TABLE patient_temperament_flags (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  flag text NOT NULL CHECK (flag IN ('anxious', 'aggressive', 'needs_muzzle', 'cat_carrier_required', 'fear_free')),
  PRIMARY KEY (patient_id, flag)
);

CREATE TABLE patient_contacts (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  receives_reminders boolean NOT NULL DEFAULT true,
  PRIMARY KEY (patient_id, client_id)
);
CREATE INDEX patient_contacts_client_id_idx ON patient_contacts (client_id);

-- Step 6: providers, services and resources (11 tables)
CREATE TABLE providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  staff_user_id uuid REFERENCES staff_users(id),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('dvm', 'technician', 'assistant', 'csr', 'manager')),
  bookable boolean NOT NULL DEFAULT true,
  max_concurrent smallint NOT NULL DEFAULT 1 CHECK (max_concurrent >= 0)
);
CREATE INDEX providers_location_id_idx ON providers (location_id);
CREATE INDEX providers_staff_user_id_idx ON providers (staff_user_id);

CREATE TABLE provider_skills (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  PRIMARY KEY (provider_id, skill_id)
);

CREATE TABLE provider_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX provider_schedules_provider_id_idx ON provider_schedules (provider_id, weekday);

CREATE TABLE provider_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  blocked_range tstzrange NOT NULL,
  reason text
);
CREATE INDEX provider_schedule_exceptions_provider_id_idx ON provider_schedule_exceptions (provider_id);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  pack_service_id text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  duration_min int NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  buffer_before_min int NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min int NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  provider_role text,
  room_type text,
  requires_doctor_on_premises boolean NOT NULL DEFAULT false,
  drop_off boolean NOT NULL DEFAULT false,
  drop_off_window text,
  fasting_required boolean NOT NULL DEFAULT false,
  requires_preop_bloodwork boolean NOT NULL DEFAULT false,
  prerequisites jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_low_usd numeric(10, 2),
  price_high_usd numeric(10, 2),
  bookable_by_ai boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  CHECK (price_high_usd IS NULL OR price_low_usd IS NULL OR price_high_usd >= price_low_usd),
  UNIQUE (location_id, pack_service_id)
);

CREATE TABLE service_species (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  species text NOT NULL,
  PRIMARY KEY (service_id, species)
);

CREATE TABLE service_skills (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  PRIMARY KEY (service_id, skill_id)
);

CREATE TABLE service_equipment (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  equipment_type text NOT NULL,
  quantity smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (service_id, equipment_type)
);

CREATE TABLE service_preferred_providers (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, provider_id)
);
CREATE INDEX service_preferred_providers_provider_id_idx ON service_preferred_providers (provider_id);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  type text NOT NULL CHECK (type IN ('exam', 'cat_exam', 'surgery', 'dental', 'radiology', 'treatment', 'comfort', 'isolation', 'kennel')),
  name text NOT NULL,
  capacity smallint NOT NULL DEFAULT 1 CHECK (capacity > 0),
  UNIQUE (location_id, name)
);

-- One row per physical unit.
CREATE TABLE equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  type text NOT NULL,
  name text NOT NULL,
  exclusive boolean NOT NULL DEFAULT false,
  UNIQUE (location_id, name)
);
CREATE INDEX equipment_location_id_type_idx ON equipment (location_id, type);

-- Step 7: reminders and messages (5 tables)
CREATE TABLE reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  pack_rule_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (location_id, pack_rule_id)
);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES reminder_rules(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  due_at date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'booked', 'stopped', 'completed')),
  touches_sent smallint NOT NULL DEFAULT 0 CHECK (touches_sent >= 0),
  stopped_at timestamptz,
  stop_reason text,
  UNIQUE (rule_id, patient_id, due_at)
);
CREATE INDEX reminders_patient_id_idx ON reminders (patient_id);
CREATE INDEX reminders_status_due_at_idx ON reminders (status, due_at);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'ai_call')),
  template_key text NOT NULL,
  body text NOT NULL,
  provider_message_id text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'simulated', 'sent', 'delivered', 'failed', 'suppressed', 'held')),
  sent_at timestamptz
);
CREATE INDEX messages_location_id_sent_at_idx ON messages (location_id, sent_at DESC);
CREATE INDEX messages_client_id_idx ON messages (client_id);

CREATE TABLE reminder_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id),
  touch_number smallint NOT NULL CHECK (touch_number > 0),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'suppressed', 'cancelled')),
  suppression_reason text,
  UNIQUE (reminder_id, touch_number)
);
CREATE INDEX reminder_touches_message_id_idx ON reminder_touches (message_id);
CREATE INDEX reminder_touches_status_scheduled_for_idx ON reminder_touches (status, scheduled_for);

CREATE TABLE message_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  body text NOT NULL,
  intent text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_replies_message_id_idx ON message_replies (message_id);

-- Step 8: appointments and waitlist (6 tables)
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  service_id uuid NOT NULL REFERENCES services(id),
  provider_id uuid REFERENCES providers(id),
  room_id uuid REFERENCES rooms(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled')),
  booked_by text NOT NULL CHECK (booked_by IN ('ai', 'staff', 'web', 'client')),
  reason_text text,
  triage_level text NOT NULL DEFAULT 'routine' CHECK (triage_level IN ('routine', 'urgent', 'emergency')),
  drop_off boolean NOT NULL DEFAULT false,
  fasting_confirmed boolean NOT NULL DEFAULT false,
  preop_bloodwork_valid boolean NOT NULL DEFAULT false,
  notes_for_staff text,
  reminder_id uuid REFERENCES reminders(id),
  confirmation_sent_at timestamptz,
  confirmed_at timestamptz,
  late_cancel boolean NOT NULL DEFAULT false,
  cancellation_reason text,
  CHECK (end_at > start_at)
);
CREATE INDEX appointments_location_id_start_at_idx ON appointments (location_id, start_at);
CREATE INDEX appointments_location_id_status_idx ON appointments (location_id, status);
CREATE INDEX appointments_patient_id_idx ON appointments (patient_id, start_at DESC);
CREATE INDEX appointments_client_id_idx ON appointments (client_id);
CREATE INDEX appointments_service_id_idx ON appointments (service_id);
CREATE INDEX appointments_provider_id_idx ON appointments (provider_id);
CREATE INDEX appointments_room_id_idx ON appointments (room_id);
CREATE INDEX appointments_reminder_id_idx ON appointments (reminder_id);

-- One row holds exactly one provider, room, or equipment item.
CREATE TABLE appointment_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  provider_id uuid REFERENCES providers(id),
  room_id uuid REFERENCES rooms(id),
  equipment_id uuid REFERENCES equipment(id),
  held_range tstzrange NOT NULL,
  is_exclusive boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  CHECK (num_nonnulls(provider_id, room_id, equipment_id) = 1),
  CHECK (NOT isempty(held_range))
);
CREATE INDEX appointment_resources_appointment_id_idx ON appointment_resources (appointment_id);
CREATE INDEX appointment_resources_location_id_idx ON appointment_resources (location_id);
CREATE INDEX appointment_resources_provider_id_idx ON appointment_resources (provider_id);
CREATE INDEX appointment_resources_room_id_idx ON appointment_resources (room_id);
CREATE INDEX appointment_resources_equipment_id_idx ON appointment_resources (equipment_id);

-- These block double-booking of exclusive resources.
-- Shared-capacity rooms use is_exclusive = false and a locked count check in the booking service.
ALTER TABLE appointment_resources ADD CONSTRAINT no_provider_overlap
  EXCLUDE USING gist (provider_id WITH =, held_range WITH &&)
  WHERE (active AND is_exclusive AND provider_id IS NOT NULL);
ALTER TABLE appointment_resources ADD CONSTRAINT no_room_overlap
  EXCLUDE USING gist (room_id WITH =, held_range WITH &&)
  WHERE (active AND is_exclusive AND room_id IS NOT NULL);
ALTER TABLE appointment_resources ADD CONSTRAINT no_equipment_overlap
  EXCLUDE USING gist (equipment_id WITH =, held_range WITH &&)
  WHERE (active AND is_exclusive AND equipment_id IS NOT NULL);

CREATE TABLE appointment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('ai', 'staff', 'client', 'system')),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_status_history_appointment_id_idx ON appointment_status_history (appointment_id, changed_at);

CREATE TABLE appointment_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  touch text NOT NULL CHECK (touch IN ('t_48h', 't_24h', 'fasting_evening')),
  message_id uuid REFERENCES messages(id),
  response text,
  responded_at timestamptz,
  UNIQUE (appointment_id, touch)
);
CREATE INDEX appointment_confirmations_message_id_idx ON appointment_confirmations (message_id);

CREATE TABLE waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  service_id uuid NOT NULL REFERENCES services(id),
  preferred_provider_id uuid REFERENCES providers(id),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'filled', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_entries_location_id_status_idx ON waitlist_entries (location_id, status, created_at);
CREATE INDEX waitlist_entries_patient_id_idx ON waitlist_entries (patient_id);
CREATE INDEX waitlist_entries_service_id_idx ON waitlist_entries (service_id);
CREATE INDEX waitlist_entries_preferred_provider_id_idx ON waitlist_entries (preferred_provider_id);

CREATE TABLE waitlist_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_entry_id uuid NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  source_appointment_id uuid NOT NULL REFERENCES appointments(id),
  slot_range tstzrange NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'ai_call')),
  claim_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'claimed', 'slot_taken', 'expired')),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz
);
CREATE INDEX waitlist_offers_waitlist_entry_id_idx ON waitlist_offers (waitlist_entry_id);
CREATE INDEX waitlist_offers_source_appointment_id_idx ON waitlist_offers (source_appointment_id);

-- Step 9: calls, triage and staff tasks (5 tables)
CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  client_id uuid REFERENCES clients(id),
  patient_id uuid REFERENCES patients(id),
  appointment_id uuid REFERENCES appointments(id),
  provider_call_id text UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  caller_number text,
  outcome text,
  transfer_outcome text NOT NULL DEFAULT 'none' CHECK (transfer_outcome IN ('none', 'transferred', 'failed', 'er_referred')),
  after_hours boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  duration_sec int CHECK (duration_sec >= 0)
);
CREATE INDEX calls_location_id_started_at_idx ON calls (location_id, started_at DESC);
CREATE INDEX calls_client_id_idx ON calls (client_id);
CREATE INDEX calls_patient_id_idx ON calls (patient_id);
CREATE INDEX calls_appointment_id_idx ON calls (appointment_id);

CREATE TABLE call_recordings (
  call_id uuid PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  delete_after timestamptz NOT NULL
);

CREATE TABLE call_transcripts (
  call_id uuid PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  delete_after timestamptz NOT NULL
);

CREATE TABLE triage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('urgent', 'emergency')),
  trigger_id text NOT NULL,
  action_taken text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX triage_events_call_id_idx ON triage_events (call_id);

CREATE TABLE staff_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  call_id uuid REFERENCES calls(id),
  client_id uuid REFERENCES clients(id),
  patient_id uuid REFERENCES patients(id),
  type text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  controlled_substance boolean NOT NULL DEFAULT false,
  details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX staff_tasks_location_id_status_idx ON staff_tasks (location_id, status, created_at);
CREATE INDEX staff_tasks_call_id_idx ON staff_tasks (call_id);
CREATE INDEX staff_tasks_client_id_idx ON staff_tasks (client_id);
CREATE INDEX staff_tasks_patient_id_idx ON staff_tasks (patient_id);

-- Step 10: pet care, imports and audit (7 tables)
CREATE TABLE vaccine_types (
  id text PRIMARY KEY,
  name text NOT NULL,
  species text NOT NULL,
  default_interval_months int NOT NULL CHECK (default_interval_months > 0),
  core boolean NOT NULL DEFAULT false
);

CREATE TABLE vaccine_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_id text NOT NULL REFERENCES vaccine_types(id),
  administered_at date NOT NULL,
  due_at date NOT NULL,
  interval_months smallint NOT NULL CHECK (interval_months > 0),
  administered_by text NOT NULL CHECK (administered_by IN ('this_clinic', 'external')),
  UNIQUE (patient_id, vaccine_id, administered_at)
);
CREATE INDEX vaccine_records_vaccine_id_idx ON vaccine_records (vaccine_id);
CREATE INDEX vaccine_records_due_at_idx ON vaccine_records (due_at);

CREATE TABLE prevention_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  product_type text NOT NULL CHECK (product_type IN ('flea_tick', 'heartworm', 'combo')),
  product_name text NOT NULL,
  dose_interval_days smallint NOT NULL CHECK (dose_interval_days > 0),
  doses_supplied smallint NOT NULL CHECK (doses_supplied > 0),
  supply_start_at date NOT NULL,
  supply_end_at date NOT NULL,
  CHECK (supply_end_at >= supply_start_at)
);
CREATE INDEX prevention_products_patient_id_idx ON prevention_products (patient_id);
CREATE INDEX prevention_products_supply_end_at_idx ON prevention_products (supply_end_at);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'previewed', 'importing', 'completed', 'failed')),
  clients_created int NOT NULL DEFAULT 0 CHECK (clients_created >= 0),
  pets_created int NOT NULL DEFAULT 0 CHECK (pets_created >= 0),
  pets_due_30d int NOT NULL DEFAULT 0 CHECK (pets_due_30d >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_jobs_location_id_idx ON import_jobs (location_id, created_at DESC);

CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number int NOT NULL CHECK (row_number > 0),
  raw_row jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'skipped', 'failed')),
  error text,
  UNIQUE (import_job_id, row_number)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id),
  actor_type text NOT NULL CHECK (actor_type IN ('ai', 'staff', 'client', 'system')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_location_id_occurred_at_idx ON audit_logs (location_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  scope text NOT NULL,
  response_code int,
  expires_at timestamptz NOT NULL
);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

-- Should return 57.
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
