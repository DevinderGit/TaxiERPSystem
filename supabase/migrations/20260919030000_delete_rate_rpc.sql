-- TAXI-602 (operator-requested) — Public-schema RPC for Rate hard-delete.
--
-- Only one table references master.rates via FK: operations.duty_slips
-- (via rate_id). A future ledger_entries.rate_id would also need to be
-- counted here, but that doesn't exist yet.
--
-- Same PostgREST custom-schema workaround as the other M2/M3/M4/M5/M6 RPCs.
-- RLS on master.rates (from TAXI-110) still applies — write_requires_operator.

CREATE OR REPLACE FUNCTION public.delete_rate(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
DECLARE
  v_usage_count integer;
BEGIN
  SELECT COUNT(*) INTO v_usage_count
    FROM operations.duty_slips
   WHERE rate_id = p_id
     AND company_id = public.current_company_id();

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete: % duty slip(s) reference this rate.', v_usage_count
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM master.rates
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_rate(bigint) TO authenticated;
