-- TAXI-109 — Implement system.fn_audit_row() per System Design §9.2.
--
-- Generic AFTER INSERT/UPDATE/DELETE trigger function attached to every
-- business table. Captures old + new row snapshots as JSONB and writes
-- them to system.audit_log.
--
-- SECURITY DEFINER so the function can insert into audit_log from any
-- caller's RLS context — combined with the deny-all RLS policy below,
-- the trigger is the only writer to audit_log.

-- ============================================================================
-- 1. Trigger function (generic)
-- ============================================================================
CREATE OR REPLACE FUNCTION system.fn_audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id bigint;
BEGIN
  -- For INSERT/DELETE we know which row; for UPDATE both NEW and OLD
  -- share the same PK, so we read it from NEW (or OLD on DELETE).
  IF TG_OP = 'DELETE' THEN
    v_record_id := (to_jsonb(OLD) ->> 'id')::bigint;
  ELSE
    v_record_id := (to_jsonb(NEW) ->> 'id')::bigint;
  END IF;

  INSERT INTO system.audit_log (
    company_id, table_name, record_id, action, old_row, new_row, changed_by
  )
  SELECT
    COALESCE(
      (to_jsonb(NEW) ->> 'company_id')::bigint,
      (to_jsonb(OLD) ->> 'company_id')::bigint
    ),
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
    auth.uid();

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- ============================================================================
-- 2. Attach trigger to every business table
-- ============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'master.customers',
    'master.vehicles',
    'master.vehicle_groups',
    'master.vehicle_types',
    'master.rates',
    'master.gst_config',
    'master.document_sequences',
    'operations.duty_slips',
    'billing.bills',
    'billing.bill_duty_slips',
    'accounts.ledger_entries'
  ];
  trigname text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    trigname := 'trg_audit_' || replace(split_part(t, '.', 2), '_', '_');
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', trigname, t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION system.fn_audit_row()',
      trigname, t
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- 3. RLS on system.audit_log — deny direct writes; trigger is the only writer
-- ============================================================================
ALTER TABLE system.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_deny_all ON system.audit_log;
CREATE POLICY audit_log_deny_all ON system.audit_log
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Force RLS even for table owners (the spec says audit_log is append-only).
ALTER TABLE system.audit_log FORCE ROW LEVEL SECURITY;
