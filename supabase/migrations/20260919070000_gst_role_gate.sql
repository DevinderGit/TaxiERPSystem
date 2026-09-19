-- TAXI-705 — Add role gate inside add_gst_config + update_gst_config.
--
-- The RLS policy gst_config_write_requires_operator exists, but these RPCs
-- are SECURITY DEFINER and run as the function owner — they bypass RLS.
-- Defense in depth: check the caller's role inside the function body and
-- raise a friendly error if they're not owner/operator.

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
  v_caller_role   text;
BEGIN
  -- Defense in depth: SECURITY DEFINER bypasses RLS, so check the
  -- caller's role inside the function body. The SPA UI hides Edit/Save
  -- for accountant/viewer, but a determined caller hitting the RPC
  -- directly would otherwise slip past the write_requires_operator
  -- policy.
  v_caller_role := public.current_user_role();
  IF v_caller_role IS DISTINCT FROM 'owner' AND v_caller_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can edit GST config (your role: %).',
      COALESCE(v_caller_role, 'unknown')
      USING ERRCODE = '42501';
  END IF;

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

CREATE OR REPLACE FUNCTION public.update_gst_config(
  p_id          bigint,
  p_igst_rate   numeric DEFAULT NULL,
  p_cgst_rate   numeric DEFAULT NULL,
  p_sgst_rate   numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_cust_state    text;
  v_comp_state    text;
  v_is_interstate boolean;
  v_caller_role   text;
BEGIN
  -- Same defense in depth as add_gst_config above.
  v_caller_role := public.current_user_role();
  IF v_caller_role IS DISTINCT FROM 'owner' AND v_caller_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can edit GST config (your role: %).',
      COALESCE(v_caller_role, 'unknown')
      USING ERRCODE = '42501';
  END IF;

  -- Re-derive is_interstate from the customer's current state (in case
  -- it changed since the row was created). The trigger fn_set_interstate
  -- also runs on UPDATE, but computing it here lets us validate the
  -- rate fields match.
  SELECT c.state, co.state
    INTO v_cust_state, v_comp_state
    FROM master.gst_config gc
    JOIN master.customers c  ON c.id = gc.customer_id
    JOIN core.companies    co ON co.id = gc.company_id
   WHERE gc.id = p_id
     AND gc.company_id = public.current_company_id();

  IF v_cust_state IS NULL THEN
    RAISE EXCEPTION 'GST config row not found.'
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

  -- Use the arg directly (no COALESCE) so a NULL arg explicitly clears the
  -- column. This is what the inter/intra-state switch needs: when the
  -- customer moves from intra-state (cgst/sgst) to interstate (igst), the
  -- SPA sends p_cgst_rate=NULL and p_sgst_rate=NULL, and we want those
  -- columns to clear in the UPDATE — not stay at the old intra-state
  -- values.
  UPDATE master.gst_config
     SET igst_rate = p_igst_rate,
         cgst_rate = p_cgst_rate,
         sgst_rate = p_sgst_rate
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_gst_config(
  bigint, numeric, numeric, numeric
) TO authenticated;
