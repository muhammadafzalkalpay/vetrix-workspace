-- Vetrix shared registry database: 8 tables.
-- Run this in the vetrix_registry database. Run the whole file once, in order.

CREATE EXTENSION IF NOT EXISTS citext;

-- Step 1
CREATE TABLE verticals (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'coming_soon', 'retired'))
);

CREATE TABLE platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled'))
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed'))
);

-- Step 2
CREATE TABLE config_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_id text NOT NULL REFERENCES verticals(id),
  pack_version text NOT NULL,
  schema_version int NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  UNIQUE (vertical_id, pack_version)
);

CREATE TABLE config_pack_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_pack_id uuid NOT NULL REFERENCES config_packs(id) ON DELETE CASCADE,
  file_key text NOT NULL,
  content jsonb NOT NULL,
  checksum text NOT NULL,
  UNIQUE (config_pack_id, file_key)
);

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  UNIQUE (organization_id, platform_user_id)
);
CREATE INDEX organization_members_platform_user_id_idx ON organization_members (platform_user_id);

-- One database per organization.
CREATE TABLE tenant_databases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
  database_ref text NOT NULL,
  region text NOT NULL,
  schema_version text,
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'migrating', 'suspended'))
);

CREATE TABLE tenant_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_database_id uuid NOT NULL REFERENCES tenant_databases(id) ON DELETE CASCADE,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'applied', 'failed')),
  applied_at timestamptz,
  UNIQUE (tenant_database_id, version)
);

-- Should return 8.
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
