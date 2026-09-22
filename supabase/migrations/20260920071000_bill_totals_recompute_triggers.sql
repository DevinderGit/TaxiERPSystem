-- M9 — TAXI-907 — bill totals recompute triggers.
--
-- Prepares M10 (Add/Remove Duty Slip from a bill) by adding triggers
-- on billing.bill_duty_slips that recompute the parent bill's
-- base_amount, extra_amount, and GST whenever a junction row is
-- inserted or deleted.
--
-- Approach: extract the GST math out of billing.fn_calculate_gst
-- into a reusable helper public.fn_compute_bill_gst(...) so the
-- same calculation runs at bill INSERT time and on every junction
-- mutation. No more duplication.

SET search_path TO public, master, billing;

-- ---------------------------------------------------------------
-- 1. Helper: compute the GST breakdown for a (company, customer,
--    base, extra) tuple. Looks up the currently-active gst_config
--    exactly like fn_calculate_gst does, then returns the 6 tax
--    columns + the gst_config_id that was used.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_compute_bill_gst(
  p_company_id  bigint,
  p_customer_id bigint,
  p_base_amount numeric,
  p_extra_amount numeric
)
RETURNS TABLE (
  cgst_amount       numeric(12,2),
  sgst_amount       numeric(12,2),
  igst_amount       numeric(12,2),
  total_after_tax   numeric(12,2),
  round_off         numeric(12,2),
  grand_total       numeric(12,2),
  gst_config_id     bigint
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_gst              master.gst_config%ROWTYPE;
  v_base             numeric(12,2) := COALESCE(p_base_amount, 0);
  v_extra            numeric(12,2) := COALESCE(p_extra_amount, 0);
  v_pre_tax          numeric(12,2);
  v_cgst             numeric(12,2) := 0;
  v_sgst             numeric(12,2) := 0;
  v_igst             numeric(12,2) := 0;
  v_total_after_tax  numeric(12,2);
  v_grand            numeric(12,2);
  v_round_off        numeric(12,2);
BEGIN
  v_pre_tax := v_base + v_extra;

  SELECT * INTO v_gst
    FROM master.gst_config
    WHERE company_id  = p_company_id
      AND customer_id = p_customer_id
      AND effective_to IS NULL
      AND is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;

  IF v_gst.id IS NULL THEN
    -- No active GST config — the trigger that called this must have
    -- already validated. Return zeros + NULL id so the caller can
    -- detect this state and refuse to write.
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, v_pre_tax,
                        0::numeric, ROUND(v_pre_tax), NULL::bigint;
    RETURN;
  END IF;

  IF v_gst.is_interstate THEN
    IF v_gst.igst_rate IS NULL THEN
      RAISE EXCEPTION 'gst_config id=% is_interstate=true but igst_rate is NULL',
        v_gst.id;
    END IF;
    v_igst := ROUND(v_pre_tax * v_gst.igst_rate / 100, 2);
  ELSE
    IF v_gst.cgst_rate IS NULL OR v_gst.sgst_rate IS NULL THEN
      RAISE EXCEPTION 'gst_config id=% is intra-state but cgst_rate/sgst_rate is NULL',
        v_gst.id;
    END IF;
    v_cgst := ROUND(v_pre_tax * v_gst.cgst_rate / 100, 2);
    v_sgst := ROUND(v_pre_tax * v_gst.sgst_rate / 100, 2);
  END IF;

  v_total_after_tax := v_pre_tax + v_cgst + v_sgst + v_igst;
  v_grand           := ROUND(v_total_after_tax);
  v_round_off       := v_grand - v_total_after_tax;

  RETURN QUERY SELECT v_cgst, v_sgst, v_igst, v_total_after_tax,
                      v_round_off, v_grand, v_gst.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_compute_bill_gst(bigint, bigint, numeric, numeric)
  TO authenticated;

COMMENT ON FUNCTION public.fn_compute_bill_gst(bigint, bigint, numeric, numeric)
  IS 'Returns the 6 tax columns + gst_config_id for a given
      (company, customer, base_amount, extra_amount). Looks up the
      currently-active gst_config (effective_to IS NULL AND
      is_active = true). Used by fn_calculate_gst (BEFORE INSERT
      trigger on billing.bills) and fn_recompute_bill_totals
      (AFTER INSERT/DELETE trigger on billing.bill_duty_slips).';

-- ---------------------------------------------------------------
-- 2. Refactor fn_calculate_gst to use the helper.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.fn_calculate_gst()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_gst_id            bigint;
  v_cgst              numeric(12,2);
  v_sgst              numeric(12,2);
  v_igst              numeric(12,2);
  v_total_after_tax   numeric(12,2);
  v_round_off         numeric(12,2);
  v_grand_total       numeric(12,2);
BEGIN
  -- 1. Total before tax = base + extra (callers provide these two).
  NEW.total_before_tax := COALESCE(NEW.base_amount, 0) + COALESCE(NEW.extra_amount, 0);

  -- 2. Delegate the GST math to the helper (same logic as before —
  --    just refactored for reuse by the bill_duty_slips triggers).
  SELECT cgst_amount, sgst_amount, igst_amount,
         total_after_tax, round_off, grand_total, gst_config_id
    INTO v_cgst, v_sgst, v_igst, v_total_after_tax, v_round_off, v_grand_total, v_gst_id
    FROM public.fn_compute_bill_gst(
      NEW.company_id, NEW.customer_id, NEW.base_amount, NEW.extra_amount
    );

  IF v_gst_id IS NULL THEN
    RAISE EXCEPTION 'No active gst_config for customer % in company %. Configure it in Master → GST Management first.',
      NEW.customer_id, NEW.company_id;
  END IF;

  NEW.cgst_amount     := v_cgst;
  NEW.sgst_amount     := v_sgst;
  NEW.igst_amount     := v_igst;
  -- total_tax and total_after_tax are GENERATED ALWAYS AS … STORED
  -- (see TAXI-104 migration), so they stay consistent automatically.

  NEW.round_off       := v_round_off;
  NEW.grand_total     := v_grand_total;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------
-- 3. New trigger function: fn_recompute_bill_totals runs AFTER
--    INSERT OR DELETE on billing.bill_duty_slips. It re-sums
--    the junction's included_base / included_extra, calls the
--    GST helper, and UPDATEs the parent bill. UPDATE on bills
--    is not itself audited for GST changes (fn_calculate_gst
--    only fires on INSERT) so we have to do the full write here.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.fn_recompute_bill_totals()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_bill_id         bigint;
  v_bill            billing.bills%ROWTYPE;
  v_new_base        numeric(12,2);
  v_new_extra       numeric(12,2);
  v_cgst            numeric(12,2);
  v_sgst            numeric(12,2);
  v_igst            numeric(12,2);
  v_total_after_tax numeric(12,2);
  v_round_off       numeric(12,2);
  v_grand_total     numeric(12,2);
  v_gst_id          bigint;
BEGIN
  -- Identify the parent bill (NEW.bill_id on INSERT, OLD.bill_id on DELETE).
  IF TG_OP = 'DELETE' THEN
    v_bill_id := OLD.bill_id;
  ELSE
    v_bill_id := NEW.bill_id;
  END IF;

  -- Lock the parent bill so concurrent recomputes serialize.
  SELECT * INTO v_bill FROM billing.bills WHERE id = v_bill_id FOR UPDATE;
  IF v_bill.id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Don't recompute totals for a cancelled bill (M10 cancels by
  -- deleting the junction rows in one shot — we don't want that
  -- to fight the cancel RPC).
  IF v_bill.status = 'cancelled' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Sum the remaining junction rows.
  SELECT
      COALESCE(SUM(included_base),  0),
      COALESCE(SUM(included_extra), 0)
    INTO v_new_base, v_new_extra
    FROM billing.bill_duty_slips
    WHERE bill_id = v_bill_id;

  -- GST via the shared helper.
  SELECT cgst_amount, sgst_amount, igst_amount,
         total_after_tax, round_off, grand_total, gst_config_id
    INTO v_cgst, v_sgst, v_igst, v_total_after_tax, v_round_off, v_grand_total, v_gst_id
    FROM public.fn_compute_bill_gst(
      v_bill.company_id, v_bill.customer_id, v_new_base, v_new_extra
    );

  -- If the GST config disappeared since the bill was issued, leave
  -- the existing tax columns untouched rather than zeroing them out.
  IF v_gst_id IS NULL THEN
    UPDATE billing.bills
      SET base_amount = v_new_base,
          extra_amount = v_new_extra,
          total_before_tax = v_new_base + v_new_extra
      WHERE id = v_bill_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE billing.bills
    SET base_amount      = v_new_base,
        extra_amount     = v_new_extra,
        total_before_tax = v_new_base + v_new_extra,
        cgst_amount      = v_cgst,
        sgst_amount      = v_sgst,
        igst_amount      = v_igst,
        round_off        = v_round_off,
        grand_total      = v_grand_total,
        gst_config_id    = v_gst_id
    WHERE id = v_bill_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_recompute_bill_totals ON billing.bill_duty_slips;
CREATE TRIGGER trg_recompute_bill_totals
  AFTER INSERT OR DELETE ON billing.bill_duty_slips
  FOR EACH ROW EXECUTE FUNCTION billing.fn_recompute_bill_totals();