-- M11 — TAXI-1102 — get_duty_slip_for_pdf RPC
--
-- Returns one duty slip + customer + vehicle (with group/type) +
-- company + T&C text in one JSONB blob for DutySlipPDF.
--
-- Same pattern as get_bill_for_pdf (TAX-1101 v2): one round-trip,
-- avoids the PostgREST schema-exposure problem (operations.duty_slips,
-- master.*, core.companies, system.settings all live outside the
-- public schema).
--
-- Does NOT raise on cancelled slips — the SPA gates printing at the
-- UI layer per spec step 12 ("Cancelled duty slips cannot be printed").
-- The RPC just returns the row with status='cancelled' so the caller
-- can show a friendly error.

SET search_path TO public, master, operations, core, system;

CREATE OR REPLACE FUNCTION public.get_duty_slip_for_pdf(p_duty_slip_no text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, master, operations, core, system
AS $function$
DECLARE
  v_company_id bigint;
  v_slip       operations.duty_slips%ROWTYPE;
  v_customer   master.customers%ROWTYPE;
  v_company    core.companies%ROWTYPE;
  v_vehicle    master.vehicles%ROWTYPE;
  v_vg_name    text;
  v_vt_name    text;
  v_tnc        text;
BEGIN
  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company in session. Sign in again.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_slip
    FROM operations.duty_slips
    WHERE company_id   = v_company_id
      AND duty_slip_no = p_duty_slip_no
    LIMIT 1;
  IF v_slip.id IS NULL THEN
    RAISE EXCEPTION 'Duty slip % not found in this company.', p_duty_slip_no
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_customer FROM master.customers WHERE id = v_slip.customer_id;
  SELECT * INTO v_company  FROM core.companies  WHERE id = v_company_id;
  SELECT * INTO v_vehicle  FROM master.vehicles  WHERE id = v_slip.vehicle_id;

  SELECT name INTO v_vg_name FROM master.vehicle_groups WHERE id = v_vehicle.vehicle_group_id;
  SELECT name INTO v_vt_name FROM master.vehicle_types  WHERE id = v_vehicle.vehicle_type_id;

  SELECT setting_value INTO v_tnc
    FROM system.settings
    WHERE company_id  = v_company_id
      AND setting_key = 'bill_terms_and_conditions';

  RETURN jsonb_build_object(
    'id',                    v_slip.id,
    'duty_slip_no',          v_slip.duty_slip_no,
    'booking_date',          to_char(v_slip.booking_date, 'YYYY-MM-DD'),
    'booking_ref',           v_slip.booking_ref,
    'status',                v_slip.status,
    'duty_type',             v_slip.duty_type::text,
    'duty_start_dt',         to_char(v_slip.duty_start_dt, 'YYYY-MM-DD HH24:MI'),
    'duty_end_dt',           to_char(v_slip.duty_end_dt,   'YYYY-MM-DD HH24:MI'),
    'opening_km',            v_slip.opening_km,
    'closing_km',            v_slip.closing_km,
    'total_km',              v_slip.total_km,
    'total_hours',           v_slip.total_hours,
    'pickup_location',       v_slip.pickup_location,
    'drop_location',         v_slip.drop_location,
    'guest_name',            v_slip.guest_name,
    'guest_phone',           v_slip.guest_phone,
    'driver_name',           v_slip.driver_name,
    'driver_phone',          v_slip.driver_phone,
    'base_amount',           v_slip.base_amount,
    'extra_km_amount',       v_slip.extra_km_amount,
    'extra_hour_amount',     v_slip.extra_hour_amount,
    'night_halt_amount',     v_slip.night_halt_amount,
    'driver_allowance',      v_slip.driver_allowance,
    'other_charges',         v_slip.other_charges,
    'other_charges_remarks', v_slip.other_charges_remarks,
    'custom_rate',           v_slip.custom_rate,
    'custom_rate_remarks',   v_slip.custom_rate_remarks,
    'total_amount',          v_slip.total_amount,
    'bill_id',               v_slip.bill_id,
    'customer', jsonb_build_object(
      'name',          v_customer.name,
      'company_name',  v_customer.company_name,
      'gstin',         v_customer.gstin,
      'phone',         v_customer.phone,
      'email',         v_customer.email,
      'state',         v_customer.state,
      'address_line1', v_customer.address_line1,
      'city',          v_customer.city,
      'pincode',       v_customer.pincode
    ),
    'vehicle', jsonb_build_object(
      'registration_no', v_vehicle.registration_no,
      'make',            v_vehicle.make,
      'model',           v_vehicle.model,
      'color',           v_vehicle.color,
      'year',            v_vehicle.year,
      'vehicle_group_name', v_vg_name,
      'vehicle_type_name',  v_vt_name
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
    'bill_terms_and_conditions', v_tnc
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_duty_slip_for_pdf(text) TO authenticated;

COMMENT ON FUNCTION public.get_duty_slip_for_pdf(text)
  IS 'M11 / TAXI-1102 — duty slip + customer + vehicle (group/type
      joined) + company + T&C text. One round-trip JSONB.';
