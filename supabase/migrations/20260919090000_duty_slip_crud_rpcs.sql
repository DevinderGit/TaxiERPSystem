-- TAXI-802 — Public-schema RPCs for Duty Slip CRUD.
--
-- Per the operator's auto-fill principle: most columns are operator-entered
-- in the form (booking-specific); only `rate_id` and `base_amount` are
-- left to TAXI-803 (rate lookup on save). So this migration ships the
-- form-storage path, not the rate-computation path. `base_amount` and
-- `total_amount` are stored as 0 here; TAXI-803 will UPDATE them after
-- looking up the rate.
--
-- Same PostgREST custom-schema workaround as every other M2..M8 RPC.
-- RLS on operations.duty_slips (from TAXI-110) still applies —
-- tenant_isolation + write_requires_operator (owner + operator only).
--
-- Status is auto-derived here: 'closed' if both duty_end_dt and
-- closing_km are present; otherwise 'open'. TAXI-805 will add explicit
-- close + cancel actions; for now, editing the form flips status
-- implicitly via the same rule.

-- ============================================================================
-- 1. get_duty_slip — read (every editable column)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_duty_slip(p_id bigint)
RETURNS TABLE (
  id                  bigint,
  customer_id         bigint,
  vehicle_id          bigint,
  rate_id             bigint,
  duty_type           text,
  booking_date        date,
  booking_ref         text,
  guest_name          text,
  guest_phone         text,
  pickup_location     text,
  drop_location       text,
  duty_start_dt       timestamptz,
  duty_end_dt         timestamptz,
  opening_km          numeric,
  closing_km          numeric,
  extra_km_amount     numeric,
  extra_hour_amount   numeric,
  night_halt_amount   numeric,
  driver_allowance    numeric,
  other_charges       numeric,
  other_charges_remarks text,
  driver_name         text,
  driver_phone        text,
  status              text,
  custom_rate         numeric,
  custom_rate_remarks text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, operations
AS $$
  SELECT ds.id, ds.customer_id, ds.vehicle_id, ds.rate_id,
         ds.duty_type::text, ds.booking_date, ds.booking_ref,
         ds.guest_name, ds.guest_phone, ds.pickup_location, ds.drop_location,
         ds.duty_start_dt, ds.duty_end_dt,
         ds.opening_km, ds.closing_km,
         ds.extra_km_amount, ds.extra_hour_amount, ds.night_halt_amount,
         ds.driver_allowance, ds.other_charges, ds.other_charges_remarks,
         ds.driver_name, ds.driver_phone, ds.status::text,
         ds.custom_rate, ds.custom_rate_remarks
    FROM operations.duty_slips ds
   WHERE ds.id = p_id
     AND ds.company_id = public.current_company_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_duty_slip(bigint) TO authenticated;

-- ============================================================================
-- 2. create_duty_slip — insert
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_duty_slip(
  p_customer_id        bigint,
  p_vehicle_id         bigint,
  p_duty_type          text,
  p_booking_date       date,
  p_duty_start_dt      timestamptz,
  p_duty_end_dt        timestamptz DEFAULT NULL,
  p_booking_ref        text        DEFAULT NULL,
  p_guest_name         text        DEFAULT NULL,
  p_guest_phone        text        DEFAULT NULL,
  p_pickup_location    text        DEFAULT NULL,
  p_drop_location      text        DEFAULT NULL,
  p_opening_km         numeric     DEFAULT NULL,
  p_closing_km         numeric     DEFAULT NULL,
  p_extra_km_amount    numeric     DEFAULT NULL,
  p_extra_hour_amount  numeric     DEFAULT NULL,
  p_night_halt_amount  numeric     DEFAULT NULL,
  p_driver_allowance   numeric     DEFAULT NULL,
  p_other_charges      numeric     DEFAULT NULL,
  p_other_charges_remarks text     DEFAULT NULL,
  p_driver_name        text        DEFAULT NULL,
  p_driver_phone       text        DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
DECLARE
  v_id                  bigint;
  v_status              text;
  v_total_hours_calc    numeric;
BEGIN
  -- --- Required-field validation ---
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required.' USING ERRCODE = '22023';
  END IF;
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle is required.' USING ERRCODE = '22023';
  END IF;
  IF p_duty_type NOT IN ('per_km','per_hour','per_day','local_package','outstation','flexible') THEN
    RAISE EXCEPTION 'Invalid duty_type ''%''.', p_duty_type USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'Booking date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_duty_start_dt IS NULL THEN
    RAISE EXCEPTION 'Duty start date/time is required.' USING ERRCODE = '22023';
  END IF;

  -- --- Cross-field / format validation (per TAXI-806) ---
  IF p_booking_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Booking date cannot be in the future.'
      USING ERRCODE = '22023';
  END IF;
  IF p_opening_km IS NOT NULL AND p_opening_km < 0 THEN
    RAISE EXCEPTION 'Opening km cannot be negative.' USING ERRCODE = '22023';
  END IF;
  IF p_closing_km IS NOT NULL AND p_opening_km IS NOT NULL AND p_closing_km < p_opening_km THEN
    RAISE EXCEPTION 'Closing km (%) cannot be less than opening km (%).', p_closing_km, p_opening_km
      USING ERRCODE = '22023';
  END IF;
  IF p_duty_end_dt IS NOT NULL AND p_duty_end_dt <= p_duty_start_dt THEN
    RAISE EXCEPTION 'Duty end must be after duty start.' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone IS NOT NULL AND p_guest_phone <> '' AND p_guest_phone !~ '^\d{10}$' THEN
    RAISE EXCEPTION 'Guest phone must be 10 digits.' USING ERRCODE = '22023';
  END IF;
  IF p_driver_phone IS NOT NULL AND p_driver_phone <> '' AND p_driver_phone !~ '^\d{10}$' THEN
    RAISE EXCEPTION 'Driver phone must be 10 digits.' USING ERRCODE = '22023';
  END IF;

  -- --- Tenant isolation check: ensure the customer + vehicle belong to
  -- the caller's company. RLS at the table level would block inserts of
  -- other companies' rows, but an explicit check here gives a friendly
  -- error before the FK fires.
  IF NOT EXISTS (SELECT 1 FROM master.customers WHERE id = p_customer_id AND company_id = public.current_company_id()) THEN
    RAISE EXCEPTION 'Customer not found in your company.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM master.vehicles WHERE id = p_vehicle_id AND company_id = public.current_company_id()) THEN
    RAISE EXCEPTION 'Vehicle not found in your company.' USING ERRCODE = 'P0002';
  END IF;

  -- --- Derived fields ---
  v_total_hours_calc := CASE
    WHEN p_duty_end_dt IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (p_duty_end_dt - p_duty_start_dt)) / 3600.0
  END;

  v_status := CASE
    WHEN p_duty_end_dt IS NOT NULL AND p_closing_km IS NOT NULL THEN 'closed'
    ELSE 'open'
  END;

  -- base_amount / total_amount / rate_id intentionally 0 / NULL — TAXI-803
  -- fills these via UPDATE after rate lookup.
  INSERT INTO operations.duty_slips (
    company_id, customer_id, vehicle_id, rate_id,
    duty_type, booking_date, booking_ref,
    guest_name, guest_phone, pickup_location, drop_location,
    duty_start_dt, duty_end_dt,
    opening_km, closing_km,
    extra_km_amount, extra_hour_amount, night_halt_amount,
    driver_allowance, other_charges, other_charges_remarks,
    driver_name, driver_phone,
    base_amount, total_amount,
    total_hours, status
  ) VALUES (
    public.current_company_id(), p_customer_id, p_vehicle_id, NULL,
    p_duty_type::duty_type, p_booking_date, NULLIF(p_booking_ref, ''),
    NULLIF(p_guest_name, ''), NULLIF(p_guest_phone, ''),
    NULLIF(p_pickup_location, ''), NULLIF(p_drop_location, ''),
    p_duty_start_dt, p_duty_end_dt,
    p_opening_km, p_closing_km,
    p_extra_km_amount, p_extra_hour_amount, p_night_halt_amount,
    p_driver_allowance, p_other_charges, NULLIF(p_other_charges_remarks, ''),
    NULLIF(p_driver_name, ''), NULLIF(p_driver_phone, ''),
    0, 0,
    v_total_hours_calc, v_status
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_duty_slip(
  bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text
) TO authenticated;

-- ============================================================================
-- 3. update_duty_slip — update (in-place, per operator's chosen pattern)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_duty_slip(
  p_id                  bigint,
  p_customer_id         bigint,
  p_vehicle_id          bigint,
  p_duty_type           text,
  p_booking_date        date,
  p_duty_start_dt       timestamptz,
  p_duty_end_dt         timestamptz DEFAULT NULL,
  p_booking_ref         text        DEFAULT NULL,
  p_guest_name          text        DEFAULT NULL,
  p_guest_phone         text        DEFAULT NULL,
  p_pickup_location     text        DEFAULT NULL,
  p_drop_location       text        DEFAULT NULL,
  p_opening_km          numeric     DEFAULT NULL,
  p_closing_km          numeric     DEFAULT NULL,
  p_extra_km_amount     numeric     DEFAULT NULL,
  p_extra_hour_amount   numeric     DEFAULT NULL,
  p_night_halt_amount   numeric     DEFAULT NULL,
  p_driver_allowance    numeric     DEFAULT NULL,
  p_other_charges       numeric     DEFAULT NULL,
  p_other_charges_remarks text     DEFAULT NULL,
  p_driver_name         text        DEFAULT NULL,
  p_driver_phone        text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
DECLARE
  v_status              text;
  v_total_hours_calc    numeric;
  v_old                 operations.duty_slips%ROWTYPE;
BEGIN
  -- Lock + read. Refuse to edit cancelled slips.
  SELECT * INTO v_old
    FROM operations.duty_slips
   WHERE id = p_id
     AND company_id = public.current_company_id()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duty slip not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled duty slips cannot be edited.' USING ERRCODE = 'P0001';
  END IF;

  -- (Same validations as create — duplicated for clarity.)
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer is required.' USING ERRCODE = '22023'; END IF;
  IF p_vehicle_id  IS NULL THEN RAISE EXCEPTION 'Vehicle is required.'  USING ERRCODE = '22023'; END IF;
  IF p_duty_type NOT IN ('per_km','per_hour','per_day','local_package','outstation','flexible') THEN
    RAISE EXCEPTION 'Invalid duty_type ''%''.', p_duty_type USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION 'Booking date is required.' USING ERRCODE = '22023'; END IF;
  IF p_duty_start_dt IS NULL THEN RAISE EXCEPTION 'Duty start date/time is required.' USING ERRCODE = '22023'; END IF;
  IF p_booking_date > CURRENT_DATE THEN RAISE EXCEPTION 'Booking date cannot be in the future.' USING ERRCODE = '22023'; END IF;
  IF p_opening_km IS NOT NULL AND p_opening_km < 0 THEN RAISE EXCEPTION 'Opening km cannot be negative.' USING ERRCODE = '22023'; END IF;
  IF p_closing_km IS NOT NULL AND p_opening_km IS NOT NULL AND p_closing_km < p_opening_km THEN
    RAISE EXCEPTION 'Closing km (%) cannot be less than opening km (%).', p_closing_km, p_opening_km USING ERRCODE = '22023';
  END IF;
  IF p_duty_end_dt IS NOT NULL AND p_duty_end_dt <= p_duty_start_dt THEN RAISE EXCEPTION 'Duty end must be after duty start.' USING ERRCODE = '22023'; END IF;
  IF p_guest_phone IS NOT NULL AND p_guest_phone <> '' AND p_guest_phone !~ '^\d{10}$' THEN RAISE EXCEPTION 'Guest phone must be 10 digits.' USING ERRCODE = '22023'; END IF;
  IF p_driver_phone IS NOT NULL AND p_driver_phone <> '' AND p_driver_phone !~ '^\d{10}$' THEN RAISE EXCEPTION 'Driver phone must be 10 digits.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM master.customers WHERE id = p_customer_id AND company_id = public.current_company_id()) THEN RAISE EXCEPTION 'Customer not found in your company.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM master.vehicles WHERE id = p_vehicle_id AND company_id = public.current_company_id()) THEN RAISE EXCEPTION 'Vehicle not found in your company.' USING ERRCODE = 'P0002'; END IF;

  v_total_hours_calc := CASE
    WHEN p_duty_end_dt IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (p_duty_end_dt - p_duty_start_dt)) / 3600.0
  END;

  -- Per TAXI-805: status auto-flips. If the operator added duty_end_dt +
  -- closing_km on edit, the slip becomes 'closed'. They can't manually
  -- set 'cancelled' here — that's a separate TAXI-805 cancel action.
  v_status := CASE
    WHEN v_old.status = 'billed' THEN 'billed'  -- never demote a billed slip
    WHEN p_duty_end_dt IS NOT NULL AND p_closing_km IS NOT NULL THEN 'closed'
    ELSE 'open'
  END;

  UPDATE operations.duty_slips
     SET customer_id         = p_customer_id,
         vehicle_id          = p_vehicle_id,
         duty_type           = p_duty_type::duty_type,
         booking_date        = p_booking_date,
         booking_ref         = NULLIF(p_booking_ref, ''),
         guest_name          = NULLIF(p_guest_name, ''),
         guest_phone         = NULLIF(p_guest_phone, ''),
         pickup_location     = NULLIF(p_pickup_location, ''),
         drop_location       = NULLIF(p_drop_location, ''),
         duty_start_dt       = p_duty_start_dt,
         duty_end_dt         = p_duty_end_dt,
         opening_km          = p_opening_km,
         closing_km          = p_closing_km,
         extra_km_amount     = p_extra_km_amount,
         extra_hour_amount   = p_extra_hour_amount,
         night_halt_amount   = p_night_halt_amount,
         driver_allowance    = p_driver_allowance,
         other_charges       = p_other_charges,
         other_charges_remarks = NULLIF(p_other_charges_remarks, ''),
         driver_name         = NULLIF(p_driver_name, ''),
         driver_phone        = NULLIF(p_driver_phone, ''),
         total_hours         = v_total_hours_calc,
         status              = v_status
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_duty_slip(
  bigint, bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text
) TO authenticated;
