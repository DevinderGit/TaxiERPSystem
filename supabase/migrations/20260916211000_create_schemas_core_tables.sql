-- TAXI-101 — Create the six schemas, core.companies, core.user_profiles,
-- and the auth.users → user_profiles auto-create trigger.
--
-- Per System Design §4.1, §4.2, §4.12 and Code Architecture §3.
-- Naming: YYYYMMDDHHMMSS_description.sql per TaskList M1 intro.

-- ============================================================================
-- 1. Schemas
-- ============================================================================
-- Supabase's local stack already creates auth, storage, realtime,
-- graphql_public, supabase_functions, _realtime, etc. We add our six.
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS master;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS accounts;
CREATE SCHEMA IF NOT EXISTS system;

-- ============================================================================
-- 2. Enums
-- ============================================================================
CREATE TYPE user_role AS ENUM ('owner', 'operator', 'accountant', 'viewer');

-- ============================================================================
-- 3. core.companies — tenant boundary, 1 row per deployment typical
-- ============================================================================
CREATE TABLE core.companies (
  id            bigserial PRIMARY KEY,
  name          text        NOT NULL,
  legal_name    text,
  owner_name    text,
  gstin         text        UNIQUE,
  pan           text,
  address_line1 text        NOT NULL,
  address_line2 text,
  city          text        NOT NULL,
  state         text        NOT NULL,
  pincode       text        NOT NULL,
  phone         text,
  email         text,
  logo_path     text,
  is_active     boolean     DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Seed: one demo company so user_profiles trigger has a parent.
-- Operator overwrites via Master → Company Detail (TAXI-301).
INSERT INTO core.companies (
  name, legal_name, owner_name, gstin, pan,
  address_line1, city, state, pincode, phone, email
) VALUES (
  'Demo Taxi Co.',
  'Demo Taxi Co. (P) Ltd.',
  'Operator',
  '99AAAAA9999A9Z9',  -- 15-char placeholder; replace via Company Detail
  'AAAAA9999A',
  '123 MG Road',
  'New Delhi',
  'Delhi',
  '110001',
  '+91-9999999999',
  'operator@example.com'
);

-- ============================================================================
-- 4. core.user_profiles — 1:1 with auth.users
-- ============================================================================
CREATE TABLE core.user_profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id bigint      NOT NULL REFERENCES core.companies(id),
  full_name  text        NOT NULL,
  role       user_role   NOT NULL DEFAULT 'viewer',
  is_active  boolean     DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_user_profiles_company ON core.user_profiles(company_id);
CREATE INDEX idx_user_profiles_role ON core.user_profiles(role);

-- ============================================================================
-- 5. updated_at helper + per-table triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_updated_at
BEFORE UPDATE ON core.companies
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON core.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 6. Auto-create user_profiles row on auth.users insert
-- ============================================================================
-- The trigger must run as a privileged role (SECURITY DEFINER) because
-- auth.users is owned by supabase_auth_admin. In local dev the postgres
-- role is superuser so this works. In production this is replaced by
-- a Supabase Auth hook (configured in config.toml, TAXI-202).
CREATE OR REPLACE FUNCTION public.fn_create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id bigint;
  v_full_name  text;
BEGIN
  -- Single-tenant deploy: pick the lowest-id active company.
  -- M3 lets the owner create more companies; M2's RoleGuard gates
  -- which company a given profile is bound to via company_id.
  SELECT id INTO v_company_id
    FROM core.companies
    WHERE is_active = true
    ORDER BY id ASC
    LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION
      'No active company in core.companies. Create one via Master → Company Detail before adding users.';
  END IF;

  -- Honour an optional full_name passed through signup metadata
  -- (Supabase Auth admin.invite / signUp with options.data).
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', '');

  INSERT INTO core.user_profiles (id, company_id, full_name, role)
  VALUES (NEW.id, v_company_id, v_full_name, 'viewer')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop the trigger if it already exists (so re-running db reset is clean).
DROP TRIGGER IF EXISTS trg_create_user_profile ON auth.users;

CREATE TRIGGER trg_create_user_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.fn_create_user_profile();
