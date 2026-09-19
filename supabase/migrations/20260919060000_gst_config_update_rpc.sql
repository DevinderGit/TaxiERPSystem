-- TAXI-702 (operator-requested) — Switch GST config edits to in-place UPDATE.
--
-- Operator feedback: "after editing do not add new row update that row itself"
-- The previous update_gst_config_with_time_travel RPC closed the old row
-- (effective_to = CURRENT_DATE - 1) and INSERTed a new one — i.e. time-travel.
-- That preserved historical accuracy (a bill from yesterday still uses
-- yesterday's GST rate) but added complexity the operator doesn't need for
-- their day-to-day edit workflow.
--
-- This migration drops the time-travel RPC and adds a simple in-place
-- UPDATE: edit overwrites the current row's rate columns. Historical
-- rows (effective_to IS NOT NULL) are no longer produced by edits; if the
-- operator wants history they'll need a future ticket.
--
-- Per operator's choice: rates (master.rates) keep their time-travel RPC
-- (update_rate_with_time_travel). Only gst_config switches to in-place.

DROP FUNCTION IF EXISTS public.update_gst_config_with_time_travel(
  bigint, numeric, numeric, numeric
);

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
BEGIN
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
