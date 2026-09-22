-- M11 — TAXI-1101 rebuild — get_bill_for_pdf v2.
--
-- Extends the v1 RPC (supabase/migrations/20260922070000_get_bill_for_pdf.sql)
-- with everything BillPDF needs to render the docs/billTemplate.pdf layout:
--
--   - company.sac_no, state_code, st_category (header block)
--   - duty_slips.vehicle_make, vehicle_model, duty_type, pickup/drop, etc.
--     (for the multi-row "Duty Description/Particulars" column)
--   - parking_toll_total (sum of duty_slips.other_charges across the bill —
--     shown separately in the totals block per the template)
--   - gst.{is_interstate, igst_rate, cgst_rate, sgst_rate} — needed to
--     recompute IGST on the template's pre-tax base (which excludes
--     parking/toll)
--   - bill_terms_and_conditions from system.settings (footer block)
--   - customer.pan (was missing in v1)

SET search_path TO public, master, operations, billing, core, system;

CREATE OR REPLACE FUNCTION public.get_bill_for_pdf(p_bill_no text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, master, operations, billing, core, system
AS $function$
DECLARE
  v_company_id  bigint;
  v_bill        billing.bills%ROWTYPE;
  v_customer    master.customers%ROWTYPE;
  v_company     core.companies%ROWTYPE;
  v_gst         master.gst_config%ROWTYPE;
  v_parking     numeric(12, 2);
  v_tnc         text;
  v_slips       jsonb;
BEGIN
  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company in session. Sign in again.'
      USING ERRCODE = '42501';
  END IF;

  -- Prefer the issued row when the bill_no was recycled
  -- (BL-0001 cancelled + re-issued → two rows with the same bill_no).
  SELECT * INTO v_bill
    FROM billing.bills
    WHERE company_id = v_company_id
      AND bill_no    = p_bill_no
    ORDER BY (status = 'cancelled'), created_at DESC
    LIMIT 1;
  IF v_bill.id IS NULL THEN
    RAISE EXCEPTION 'Bill % not found in this company.', p_bill_no
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_customer FROM master.customers WHERE id = v_bill.customer_id;
  SELECT * INTO v_company  FROM core.companies  WHERE id = v_company_id;

  -- GST config: prefer the bill's pinned gst_config_id; fall back to
  -- the currently-active config for the (company, customer) pair.
  IF v_bill.gst_config_id IS NOT NULL THEN
    SELECT * INTO v_gst FROM master.gst_config WHERE id = v_bill.gst_config_id;
  END IF;
  IF v_gst.id IS NULL THEN
    SELECT * INTO v_gst
      FROM master.gst_config
      WHERE company_id   = v_company_id
        AND customer_id  = v_bill.customer_id
        AND effective_to IS NULL
        AND is_active    = true
      ORDER BY effective_from DESC
      LIMIT 1;
  END IF;

  -- Parking/Toll = sum of duty_slips.other_charges linked to this bill
  SELECT COALESCE(SUM(ds.other_charges), 0) INTO v_parking
    FROM billing.bill_duty_slips bds
    JOIN operations.duty_slips   ds ON ds.id = bds.duty_slip_id
    WHERE bds.bill_id = v_bill.id;

  -- T&C text from system.settings (may be NULL — BillPDF falls back
  -- to a placeholder line "Terms & conditions not configured").
  SELECT setting_value INTO v_tnc
    FROM system.settings
    WHERE company_id  = v_company_id
      AND setting_key = 'bill_terms_and_conditions';

  -- Duty slips with every field the line-item table needs
  SELECT COALESCE(
           jsonb_agg(row_to_json(s) ORDER BY s.booking_date, s.duty_slip_no),
           '[]'::jsonb
         )
    INTO v_slips
    FROM (
      SELECT
        ds.id,
        ds.duty_slip_no,
        to_char(ds.booking_date,    'YYYY-MM-DD') AS booking_date,
        to_char(ds.duty_start_dt,   'YYYY-MM-DD') AS start_date,
        to_char(ds.duty_end_dt,     'YYYY-MM-DD') AS end_date,
        v.registration_no                          AS vehicle_reg_no,
        v.make                                     AS vehicle_make,
        v.model                                    AS vehicle_model,
        ds.duty_type::text                         AS duty_type,
        ds.pickup_location,
        ds.drop_location,
        ds.opening_km,
        ds.closing_km,
        ds.total_km,
        ds.total_hours,
        ds.base_amount,
        ds.extra_km_amount,
        ds.extra_hour_amount,
        ds.night_halt_amount,
        ds.driver_allowance,
        ds.other_charges,
        ds.other_charges_remarks,
        ds.guest_name,
        ds.total_amount
      FROM billing.bill_duty_slips bds
      JOIN operations.duty_slips   ds ON ds.id = bds.duty_slip_id
      LEFT JOIN master.vehicles    v  ON v.id  = ds.vehicle_id
      WHERE bds.bill_id = v_bill.id
    ) s;

  RETURN jsonb_build_object(
    'bill_no',           v_bill.bill_no,
    'bill_date',         to_char(v_bill.bill_date, 'YYYY-MM-DD'),
    'status',            v_bill.status,
    'remarks',           v_bill.remarks,
    'base_amount',       v_bill.base_amount,
    'extra_amount',      v_bill.extra_amount,
    'parking_toll_total', v_parking,
    'cgst_amount',       v_bill.cgst_amount,
    'sgst_amount',       v_bill.sgst_amount,
    'igst_amount',       v_bill.igst_amount,
    'total_tax',         v_bill.total_tax,
    'total_after_tax',   v_bill.total_after_tax,
    'round_off',         v_bill.round_off,
    'grand_total',       v_bill.grand_total,
    'customer', jsonb_build_object(
      'name',          v_customer.name,
      'company_name',  v_customer.company_name,
      'gstin',         v_customer.gstin,
      'pan',           v_customer.pan,
      'state',         v_customer.state,
      'address_line1', v_customer.address_line1,
      'address_line2', v_customer.address_line2,
      'city',          v_customer.city,
      'pincode',       v_customer.pincode,
      'phone',         v_customer.phone,
      'email',         v_customer.email
    ),
    'company', jsonb_build_object(
      'id',            v_company.id,
      'name',          v_company.name,
      'legal_name',    v_company.legal_name,
      'gstin',         v_company.gstin,
      'pan',           v_company.pan,
      'sac_no',        v_company.sac_no,
      'state_code',    v_company.state_code,
      'st_category',   v_company.st_category,
      'address_line1', v_company.address_line1,
      'address_line2', v_company.address_line2,
      'city',          v_company.city,
      'state',         v_company.state,
      'pincode',       v_company.pincode,
      'phone',         v_company.phone,
      'email',         v_company.email,
      'logo_path',     v_company.logo_path
    ),
    'gst', CASE WHEN v_gst.id IS NULL THEN NULL ELSE jsonb_build_object(
      'is_interstate', v_gst.is_interstate,
      'igst_rate',     v_gst.igst_rate,
      'cgst_rate',     v_gst.cgst_rate,
      'sgst_rate',     v_gst.sgst_rate
    ) END,
    'bill_terms_and_conditions', v_tnc,
    'duty_slips', v_slips
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_bill_for_pdf(text) TO authenticated;

COMMENT ON FUNCTION public.get_bill_for_pdf(text)
  IS 'M11 / TAXI-1101 v2 — bill + customer + company + linked duty
      slips + parking-toll total + GST rates (for template-style
      IGST recompute) + T&C text. One round-trip JSONB.';
