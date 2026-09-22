-- TAXI-108 — Implement billing.fn_calculate_gst() per System Design §5.5.
--
-- BEFORE INSERT trigger on billing.bills that derives CGST/SGST/IGST
-- amounts from master.gst_config and rounds grand_total to a whole
-- rupee. total_tax and total_after_tax are GENERATED columns (from
-- TAXI-104) so they stay consistent with the components.

-- ============================================================================
-- 1. Trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION billing.fn_calculate_gst()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  gst                  master.gst_config%ROWTYPE;
  total_before_tax_calc numeric(12, 2);
  cgst_calc             numeric(12, 2) := 0;
  sgst_calc             numeric(12, 2) := 0;
  igst_calc             numeric(12, 2) := 0;
  total_after_tax_calc  numeric(12, 2);
  final_grand_total     numeric(12, 2);
BEGIN
  -- 1. Total before tax = base + extra (callers provide these two).
  total_before_tax_calc := COALESCE(NEW.base_amount, 0) + COALESCE(NEW.extra_amount, 0);
  NEW.total_before_tax := total_before_tax_calc;

  -- 2. Active GST config for this (company, customer). effective_to IS NULL
  --    means the currently-active row per spec.
  SELECT * INTO gst
    FROM master.gst_config
    WHERE company_id = NEW.company_id
      AND customer_id = NEW.customer_id
      AND effective_to IS NULL
      AND is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;

  IF gst.id IS NULL THEN
    RAISE EXCEPTION
      'No active gst_config for customer % in company %. Configure it in Master → GST Management first.',
      NEW.customer_id, NEW.company_id;
  END IF;

  -- 3. Compute tax components.
  IF gst.is_interstate THEN
    IF gst.igst_rate IS NULL THEN
      RAISE EXCEPTION
        'gst_config id=% is marked is_interstate=true but igst_rate is NULL',
        gst.id;
    END IF;
    igst_calc := ROUND(total_before_tax_calc * gst.igst_rate / 100, 2);
    cgst_calc := 0;
    sgst_calc := 0;
  ELSE
    IF gst.cgst_rate IS NULL OR gst.sgst_rate IS NULL THEN
      RAISE EXCEPTION
        'gst_config id=% is intra-state but cgst_rate or sgst_rate is NULL',
        gst.id;
    END IF;
    cgst_calc := ROUND(total_before_tax_calc * gst.cgst_rate / 100, 2);
    sgst_calc := ROUND(total_before_tax_calc * gst.sgst_rate / 100, 2);
    igst_calc := 0;
  END IF;

  NEW.cgst_amount := cgst_calc;
  NEW.sgst_amount := sgst_calc;
  NEW.igst_amount := igst_calc;
  -- total_tax and total_after_tax are GENERATED ALWAYS AS … STORED
  -- (see TAXI-104 migration), so they stay consistent automatically.

  -- 4. Round grand_total to a whole rupee. round_off carries the small
  --    adjustment so the bill book ties out to the rupee.
  total_after_tax_calc := total_before_tax_calc + cgst_calc + sgst_calc + igst_calc;
  final_grand_total    := ROUND(total_after_tax_calc);
  NEW.round_off        := final_grand_total - total_after_tax_calc;
  NEW.grand_total      := final_grand_total;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS trg_calculate_gst ON billing.bills;

CREATE TRIGGER trg_calculate_gst
BEFORE INSERT ON billing.bills
FOR EACH ROW
EXECUTE FUNCTION billing.fn_calculate_gst();
