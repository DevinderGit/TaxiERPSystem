-- M9 — patch system.fn_audit_row to look up company_id for junction
-- tables that don't have a company_id column of their own. Today only
-- billing.bill_duty_slips is affected (its audit_log row needs
-- company_id, but the trigger reads it from to_jsonb(NEW) which is
-- NULL). The trigger now falls back to a parent-table lookup keyed
-- on the FK column (bill_id → billing.bills.company_id).

SET search_path TO public, billing, system;

CREATE OR REPLACE FUNCTION system.fn_audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'billing'
AS $function$
DECLARE
  v_record_id  bigint;
  v_company_id bigint;
BEGIN
  -- For INSERT/DELETE we know which row; for UPDATE both NEW and OLD
  -- share the same PK, so we read it from NEW (or OLD on DELETE).
  IF TG_OP = 'DELETE' THEN
    v_record_id := (to_jsonb(OLD) ->> 'id')::bigint;
  ELSE
    v_record_id := (to_jsonb(NEW) ->> 'id')::bigint;
  END IF;

  -- Fallback for junction tables that don't have their own `id` column.
  -- Today only billing.bill_duty_slips is in this category; record the
  -- bill_id (the parent FK) so audit lookups by record_id still work.
  IF v_record_id IS NULL THEN
    IF TG_TABLE_NAME = 'bill_duty_slips' THEN
      v_record_id := COALESCE(
        (to_jsonb(NEW) ->> 'bill_id')::bigint,
        (to_jsonb(OLD) ->> 'bill_id')::bigint
      );
    END IF;
  END IF;

  -- Prefer the company_id from NEW/OLD (works for every table that
  -- carries its own company_id column).
  v_company_id := COALESCE(
    (to_jsonb(NEW) ->> 'company_id')::bigint,
    (to_jsonb(OLD) ->> 'company_id')::bigint
  );

  -- Fallback for junction tables that don't carry company_id directly.
  -- Today only billing.bill_duty_slips is in this category; if more
  -- junction tables get audited later, add a CASE branch here.
  IF v_company_id IS NULL THEN
    IF TG_TABLE_NAME = 'bill_duty_slips' THEN
      SELECT b.company_id INTO v_company_id
        FROM billing.bills b
        WHERE b.id = COALESCE((to_jsonb(NEW) ->> 'bill_id')::bigint,
                              (to_jsonb(OLD) ->> 'bill_id')::bigint);
    END IF;
  END IF;

  INSERT INTO system.audit_log (
    company_id, table_name, record_id, action, old_row, new_row, changed_by
  )
  VALUES (
    v_company_id,
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
    auth.uid()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;