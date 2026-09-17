-- TAXI-110 — Implement RLS policies + helper functions per System Design §4.12.
--
-- Three flavours of table get RLS here:
--   A. core.companies — the tenant table; uses `id` (no `company_id` of its own).
--   B. Tables with company_id (everything else except the junction).
--   C. billing.bill_duty_slips — junction, no company_id; tenant isolation
--      uses an EXISTS join through billing.bills.

-- ============================================================================
-- 1. Helper functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF((auth.jwt() ->> 'company_id'), '')::bigint;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() ->> 'user_role', 'viewer');
$$;

-- ============================================================================
-- 1b. Table-level GRANTs for the PostgREST roles
-- ============================================================================
-- RLS gates rows; the GRANT gates the table itself. Default Supabase
-- initialisation only grants on the `public` schema; our custom
-- schemas need explicit grants for `authenticated` to reach them at all.
-- RLS policies below then control which rows each role can see.
DO $$
DECLARE
  s text;
  schemas text[] := ARRAY['core', 'master', 'operations', 'billing', 'accounts', 'system'];
BEGIN
  FOREACH s IN ARRAY schemas LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', s);
    EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO authenticated', s);
  END LOOP;
END;
$$;

-- ============================================================================
-- 2A. core.companies — tenant table uses `id`, not `company_id`
-- ============================================================================
ALTER TABLE core.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_tenant_isolation ON core.companies;
DROP POLICY IF EXISTS companies_write_requires_operator ON core.companies;
DROP POLICY IF EXISTS companies_update_requires_operator_or_accountant ON core.companies;

CREATE POLICY companies_tenant_isolation ON core.companies FOR ALL
  USING (id = public.current_company_id())
  WITH CHECK (id = public.current_company_id());

CREATE POLICY companies_write_requires_operator ON core.companies FOR INSERT
  WITH CHECK (public.current_user_role() IN ('owner', 'operator'));

CREATE POLICY companies_update_requires_operator_or_accountant ON core.companies FOR UPDATE
  USING (public.current_user_role() IN ('owner', 'operator', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('owner', 'operator', 'accountant'));

-- ============================================================================
-- 2B. Tables WITH company_id — generated via DO block
-- ============================================================================
DO $$
DECLARE
  t          text;
  pol_prefix text;
  tables text[] := ARRAY[
    'core.user_profiles',
    'master.customers',
    'master.vehicles',
    'master.vehicle_groups',
    'master.vehicle_types',
    'master.rates',
    'master.gst_config',
    'master.document_sequences',
    'operations.duty_slips',
    'billing.bills',
    'accounts.ledger_entries'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    pol_prefix := split_part(t, '.', 2);

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %s', pol_prefix, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write_requires_operator ON %s', pol_prefix, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update_requires_operator_or_accountant ON %s', pol_prefix, t);

    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %s FOR ALL '
      'USING (company_id = public.current_company_id()) '
      'WITH CHECK (company_id = public.current_company_id())',
      pol_prefix, t
    );

    EXECUTE format(
      'CREATE POLICY %I_write_requires_operator ON %s FOR INSERT '
      'WITH CHECK (public.current_user_role() IN (''owner'',''operator''))',
      pol_prefix, t
    );

    EXECUTE format(
      'CREATE POLICY %I_update_requires_operator_or_accountant ON %s FOR UPDATE '
      'USING (public.current_user_role() IN (''owner'',''operator'',''accountant'')) '
      'WITH CHECK (public.current_user_role() IN (''owner'',''operator'',''accountant''))',
      pol_prefix, t
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- 2C. billing.bill_duty_slips — junction, no company_id of its own
-- ============================================================================
ALTER TABLE billing.bill_duty_slips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bill_duty_slips_tenant_isolation ON billing.bill_duty_slips;
DROP POLICY IF EXISTS bill_duty_slips_write_requires_operator ON billing.bill_duty_slips;
DROP POLICY IF EXISTS bill_duty_slips_update_requires_operator_or_accountant ON billing.bill_duty_slips;

CREATE POLICY bill_duty_slips_tenant_isolation ON billing.bill_duty_slips FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM billing.bills b
       WHERE b.id = billing.bill_duty_slips.bill_id
         AND b.company_id = public.current_company_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM billing.bills b
       WHERE b.id = billing.bill_duty_slips.bill_id
         AND b.company_id = public.current_company_id()
    )
  );

CREATE POLICY bill_duty_slips_write_requires_operator ON billing.bill_duty_slips FOR INSERT
  WITH CHECK (public.current_user_role() IN ('owner', 'operator'));

CREATE POLICY bill_duty_slips_update_requires_operator_or_accountant ON billing.bill_duty_slips FOR UPDATE
  USING (public.current_user_role() IN ('owner', 'operator', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('owner', 'operator', 'accountant'));
