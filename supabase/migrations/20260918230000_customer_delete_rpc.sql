-- TAXI-502 — Public-schema RPC for Customer delete with FK-aware count.
--
-- Same PostgREST custom-schema workaround as the other M2/M3/M4/M5 RPCs.
-- Three tables reference master.customers via FK:
--   - master.rates           (rate cards pinned to a customer)
--   - operations.duty_slips  (duty history)
--   - master.gst_config      (per-customer GST rate card)
-- Naive DELETE would surface the first raw FK violation it hits. This RPC
-- sums the references across all three tables and returns a friendly
-- single count so the operator can see how many things they'd lose.

CREATE OR REPLACE FUNCTION public.delete_customer(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
DECLARE
  v_rates_count   integer;
  v_duty_count     integer;
  v_gst_count      integer;
  v_total_count    integer;
BEGIN
  SELECT COUNT(*) INTO v_rates_count
    FROM master.rates
   WHERE customer_id = p_id
     AND company_id = public.current_company_id();

  SELECT COUNT(*) INTO v_duty_count
    FROM operations.duty_slips
   WHERE customer_id = p_id
     AND company_id = public.current_company_id();

  SELECT COUNT(*) INTO v_gst_count
    FROM master.gst_config
   WHERE customer_id = p_id
     AND company_id = public.current_company_id();

  v_total_count := v_rates_count + v_duty_count + v_gst_count;

  IF v_total_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete: % record(s) reference this customer.', v_total_count
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM master.customers
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_customer(bigint) TO authenticated;
