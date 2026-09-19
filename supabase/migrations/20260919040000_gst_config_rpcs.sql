-- TAXI-701 — Public-schema RPCs for GST Config CRUD + time-travel-on-edit.
--
-- The trigger fn_set_interstate (TAXI-106) auto-derives is_interstate on
-- INSERT/UPDATE by comparing customer.state to company.state. The
-- validation in add_gst_config mirrors that logic and rejects the row
-- early with a friendly message if the wrong rate fields are populated
-- for the customer's effective inter/intra state.
--
-- Same PostgREST custom-schema workaround as every other M2..M6 RPC.

-- ============================================================================
-- 1. list_gst_configs_for_customer — read
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_gst_configs_for_customer(p_customer_id bigint)
RETURNS TABLE (
  id              bigint,
  is_interstate   boolean,
  igst_rate       numeric,
  cgst_rate       numeric,
  sgst_rate       numeric,
  effective_from  date,
  effective_to    date,
  status         text,
  is_active       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master
AS $$
  SELECT gc.id,
         gc.is_interstate,
         gc.igst_rate, gc.cgst_rate, gc.sgst_rate,
         gc.effective_from, gc.effective_to,
         CASE WHEN gc.effective_to IS NULL THEN 'Active' ELSE 'Closed' END,
         gc.is_active
    FROM master.gst_config gc
   WHERE gc.company_id = public.current_company_id()
     AND gc.customer_id = p_customer_id
   ORDER BY gc.effective_from DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_gst_configs_for_customer(bigint) TO authenticated;

-- ============================================================================
-- 2. add_gst_config — insert
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_gst_config(
  p_customer_id     bigint,
  p_igst_rate       numeric DEFAULT NULL,
  p_cgst_rate       numeric DEFAULT NULL,
  p_sgst_rate       numeric DEFAULT NULL,
  p_effective_from  date    DEFAULT CURRENT_DATE
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id            bigint;
  v_is_interstate boolean;
  v_cust_state    text;
  v_comp_state    text;
BEGIN
  -- Compute what is_interstate WILL be (matching the trigger's logic) so
  -- we can validate the right rate fields are populated.
  SELECT c.state, co.state
    INTO v_cust_state, v_comp_state
    FROM master.customers c
    JOIN core.companies co ON co.id = c.company_id
   WHERE c.id = p_customer_id
     AND c.company_id = public.current_company_id();

  IF v_cust_state IS NULL THEN
    RAISE EXCEPTION 'Customer not found.'
      USING ERRCODE = 'P0002';
  END IF;

  v_is_interstate := (v_cust_state IS DISTINCT FROM v_comp_state);

  IF v_is_interstate THEN
    IF p_igst_rate IS NULL OR p_cgst_rate IS NOT NULL OR p_sgst_rate IS NOT NULL THEN
      RAISE EXCEPTION 'For interstate (customer in %, company in %), set igst_rate only — leave cgst_rate and sgst_rate empty.', v_cust_state, v_comp_state
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_igst_rate IS NOT NULL OR p_cgst_rate IS NULL OR p_sgst_rate IS NULL THEN
      RAISE EXCEPTION 'For intra-state (both in %), set cgst_rate and sgst_rate — leave igst_rate empty.', v_cust_state
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO master.gst_config (
    company_id, customer_id, is_interstate,
    igst_rate, cgst_rate, sgst_rate,
    effective_from, effective_to
  ) VALUES (
    public.current_company_id(), p_customer_id, v_is_interstate,
    p_igst_rate, p_cgst_rate, p_sgst_rate,
    COALESCE(p_effective_from, CURRENT_DATE), NULL
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_gst_config(
  bigint, numeric, numeric, numeric, date
) TO authenticated;

-- ============================================================================
-- 3. update_gst_config_with_time_travel — close old, insert new
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_gst_config_with_time_travel(
  p_id          bigint,
  p_igst_rate   numeric DEFAULT NULL,
  p_cgst_rate   numeric DEFAULT NULL,
  p_sgst_rate   numeric DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_old        master.gst_config%ROWTYPE;
  v_new_id     bigint;
  v_eff_from   date := CURRENT_DATE;
  v_eff_to_old date := CURRENT_DATE - INTERVAL '1 day';
BEGIN
  SELECT * INTO v_old
    FROM master.gst_config
   WHERE id = p_id
     AND company_id = public.current_company_id()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GST config row not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'This config has been closed by a later change (effective_to=%). Only the currently-effective config can be edited.', v_old.effective_to
      USING ERRCODE = 'P0001';
  END IF;

  -- Close the old row.
  UPDATE master.gst_config
     SET effective_to = v_eff_to_old
   WHERE id = p_id;

  -- Insert the new row, carrying forward unchanged fields. The trigger
  -- fn_set_interstate will recompute is_interstate based on the
  -- customer's current state, so we don't carry the old value forward.
  INSERT INTO master.gst_config (
    company_id, customer_id, is_interstate,
    igst_rate, cgst_rate, sgst_rate,
    effective_from, effective_to
  ) VALUES (
    v_old.company_id, v_old.customer_id, v_old.is_interstate,
    COALESCE(p_igst_rate, v_old.igst_rate),
    COALESCE(p_cgst_rate, v_old.cgst_rate),
    COALESCE(p_sgst_rate, v_old.sgst_rate),
    v_eff_from, NULL
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_gst_config_with_time_travel(
  bigint, numeric, numeric, numeric
) TO authenticated;
