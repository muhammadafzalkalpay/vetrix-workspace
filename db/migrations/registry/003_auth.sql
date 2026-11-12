-- Registry: sign-in (Better Auth). Adds 4 tables, so the registry has 12.
-- Run with `pnpm db:migrate` on the vetrix_registry database only.
--
-- platform_users is Better Auth's "user" table. Passwords are never stored
-- here: they live hashed (scrypt) in auth_accounts.password.

ALTER TABLE platform_users
  ADD COLUMN name text NOT NULL DEFAULT '',
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN image text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- One row per signed-in browser. Deleting the row signs that browser out.
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  -- The organization this browser is working in, for people in several.
  active_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_platform_user_id_idx ON auth_sessions (platform_user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

-- Ways to sign in: provider_id 'credential' holds the password hash.
CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX auth_accounts_platform_user_id_idx ON auth_accounts (platform_user_id);

-- Short-lived tokens: email verification and password reset links.
CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications (identifier);
CREATE INDEX auth_verifications_expires_at_idx ON auth_verifications (expires_at);

-- Sign-in attempt limits, shared by every Cloud Run instance.
CREATE TABLE auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);
