-- M11 — TAXI-1101 — get_bill_for_pdf RPC
--
-- Returns everything BillPDF needs in a single JSONB blob:
--   { bill_*, customer_*, company_*, duty_slips: [...] }
--
-- Why a JSONB RPC and not multiple .from() calls: PostgREST only
-- exposes the `public` schema (see db.schemas in supabase/config.toml),
-- so .from('bills') fails with "Could not find the table 'public.bills'
-- in the schema cache". Every M0-M10 page reads via RPCs — this RPC
-- keeps the same pattern and gives the PDF renderer one round-trip
-- instead of five.
--
-- The companion duty-slip RPC lands in TAXI-1102.

SET search_path TO public, master, operations, billing, core;

CREATE OR REPLACE FUNCTION public.get_bill_for_pdf(p_bill_no text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, master, operations, billing, core
AS $function$
DECLARE
  v_company_id  bigint;
  v_bill        billing.bills%ROWTYPE;
  v_customer    master.customers%ROWTYPE;
  v_company     core.companies%ROWTYPE;
  v_slips       jsonb;
BEGIN
  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company in session. Sign in again.'
      USING ERRCODE = '42501';
  END IF;

  -- Prefer the issued row when the bill_no was recycled (BL-0001
  -- cancelled + re-issued → two rows with the same bill_no).
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

  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.booking_date, s.duty_slip_no), '[]'::jsonb)
    INTO v_slips
    FROM (
      SELECT
        ds.duty_slip_no,
        to_char(ds.booking_date, 'YYYY-MM-DD')        AS booking_date,
        v.registration_no                              AS vehicle_reg_no,
        ds.total_km,
        ds.total_hours,
        bds.included_base                              AS base_amount,
        bds.included_extra                             AS extra_amount,
        bds.included_total                             AS total_amount
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
    'total_before_tax',  v_bill.total_before_tax,
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
      'address_line1', v_customer.address_line1,
      'address_line2', v_customer.address_line2,
      'city',          v_customer.city,
      'state',         v_customer.state,
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
      'address_line1', v_company.address_line1,
      'address_line2', v_company.address_line2,
      'city',          v_company.city,
      'state',         v_company.state,
      'pincode',       v_company.pincode,
      'phone',         v_company.phone,
      'email',         v_company.email,
      'logo_path',     v_company.logo_path
    ),
    'duty_slips', v_slips
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_bill_for_pdf(text) TO authenticated;

COMMENT ON FUNCTION public.get_bill_for_pdf(text)
  IS 'M11 / TAXI-1101 — single JSONB blob with everything BillPDF
      needs (bill row + customer + company + linked duty slips). One
      round-trip; avoids the PostgREST schema-exposure problem
      (tables live in billing./master./operations./core., only the
      public schema is exposed via PostgREST).';
