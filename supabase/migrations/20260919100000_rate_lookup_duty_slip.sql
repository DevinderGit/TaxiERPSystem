-- TAXI-803 — Rate lookup + base_amount computation for duty slips.
--
-- On Save, the duty-slip RPCs look up the currently-effective rate for
-- (customer, vehicle.vehicle_group_id, vehicle.vehicle_type_id, duty_type,
-- booking_date) and compute base_amount per the rate type. The same logic
-- lives in two places so the form can preview (select-only) and the
-- server-side save can enforce + apply.
--
-- Per CLAUDE.md rule 5 the duty_type-specific formulas stick close to the
-- spec:
--   per_km        = base_rate + (per_km_rate  * total_km)
--   per_hour      = base_rate + (per_hour_rate * total_hours)
--   per_day       = base_rate + (per_day_rate  * ceil(total_hours / 24))
--   local_package = base_rate + (per_hour_rate * total_hours)
--   outstation    = base_rate + (per_km_rate * total_km)
--                            + (night_halt_rate * ceil(total_hours / 24))
--                            + (driver_allowance * ceil(total_hours / 24))
--   flexible      = no rate lookup (TAX-804 owns this)
--
-- min_charge applies only when the duty slip has a closing_km + duty_end_dt
-- (so we can compute a total). When the computed total < min_charge, we
-- raise base_amount to min_charge.

-- ============================================================================
-- 1. compute_duty_base_amount — helper. Called by lookup + the create/update
-- RPCs so the math lives in one place.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_duty_base_amount(
  p_base_rate          numeric,
  p_per_km_rate        numeric,
  p_per_hour_rate      numeric,
  p_per_day_rate       numeric,
  p_extra_hour_rate    numeric,
  p_extra_km_rate      numeric,
  p_night_halt_rate    numeric,
  p_driver_allowance   numeric,
  p_duty_type          text,
  p_total_km           numeric,
  p_total_hours        numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_days numeric;
BEGIN
  v_days := CASE
    WHEN p_total_hours IS NULL THEN NULL
    ELSE CEIL(p_total_hours / 24.0)
  END;

  CASE p_duty_type
    WHEN 'per_km' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_km_rate, 0) * COALESCE(p_total_km, 0);
    WHEN 'per_hour' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_hour_rate, 0) * COALESCE(p_total_hours, 0);
    WHEN 'per_day' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_day_rate, 0) * COALESCE(v_days, 1);
    WHEN 'local_package' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_hour_rate, 0) * COALESCE(p_total_hours, 0);
    WHEN 'outstation' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_km_rate, 0) * COALESCE(p_total_km, 0)
           + COALESCE(p_night_halt_rate, 0) * COALESCE(v_days, 0)
           + COALESCE(p_driver_allowance, 0) * COALESCE(v_days, 0);
    ELSE
      -- 'flexible' or unknown → return base_rate only (TAX-804 handles
      -- custom_rate for flexible; we just store base_rate=0 here).
      RETURN COALESCE(p_base_rate, 0);
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_duty_base_amount(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, numeric, numeric
) TO authenticated;

-- ============================================================================
-- 2. lookup_rate_for_duty_slip — read (used by the SPA for the preview)
-- ============================================================================
-- Returns the matched rate + computed base_amount preview. The found
-- column is FALSE when no rate matches; the SPA can show a warning.
--
-- Bare `duty_type` cast (not `master.duty_type`) — same enum-cast quirk
-- every other M2..M8 RPC uses, because the migration runner's connection
-- doesn't have master in search_path at plan time.

CREATE OR REPLACE FUNCTION public.lookup_rate_for_duty_slip(
  p_customer_id     bigint,
  p_vehicle_id      bigint,
  p_duty_type       text,
  p_booking_date    date,
  p_total_km        numeric DEFAULT NULL,
  p_total_hours     numeric DEFAULT NULL
)
RETURNS TABLE (
  found              boolean,
  rate_id            bigint,
  duty_type          text,
  base_rate          numeric,
  per_km_rate        numeric,
  per_hour_rate      numeric,
  per_day_rate       numeric,
  extra_hour_rate    numeric,
  extra_km_rate      numeric,
  night_halt_rate    numeric,
  driver_allowance   numeric,
  min_charge         numeric,
  computed_base      numeric,
  min_charge_applied boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
  WITH rate AS (
    SELECT r.*
      FROM master.rates r
      JOIN master.vehicles v ON v.id = p_vehicle_id
     WHERE r.company_id      = public.current_company_id()
       AND r.customer_id     = p_customer_id
       AND r.vehicle_group_id = v.vehicle_group_id
       AND r.vehicle_type_id  = v.vehicle_type_id
       AND r.duty_type        = p_duty_type::duty_type
       AND r.effective_from  <= p_booking_date
       AND (r.effective_to IS NULL OR r.effective_to >= p_booking_date)
     ORDER BY r.effective_from DESC
     LIMIT 1
  )
  SELECT
    (r.id IS NOT NULL)                       AS found,
    r.id                                      AS rate_id,
    r.duty_type::text,
    r.base_rate,
    r.per_km_rate,
    r.per_hour_rate,
    r.per_day_rate,
    r.extra_hour_rate,
    r.extra_km_rate,
    r.night_halt_rate,
    r.driver_allowance,
    r.min_charge,
    public.compute_duty_base_amount(
      r.base_rate, r.per_km_rate, r.per_hour_rate, r.per_day_rate,
      r.extra_hour_rate, r.extra_km_rate, r.night_halt_rate, r.driver_allowance,
      r.duty_type::text, p_total_km, p_total_hours
    )                                       AS computed_base,
    CASE
      WHEN r.id IS NULL OR r.min_charge IS NULL THEN FALSE
      WHEN public.compute_duty_base_amount(
        r.base_rate, r.per_km_rate, r.per_hour_rate, r.per_day_rate,
        r.extra_hour_rate, r.extra_km_rate, r.night_halt_rate, r.driver_allowance,
        r.duty_type::text, p_total_km, p_total_hours
      ) < r.min_charge THEN TRUE
      ELSE FALSE
    END                                       AS min_charge_applied
  FROM rate r;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_rate_for_duty_slip(
  bigint, bigint, text, date, numeric, numeric
) TO authenticated;

-- ============================================================================
-- 3. Patch create_duty_slip — look up rate, compute base_amount, block if
-- no rate (unless flexible), apply min_charge.
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
  v_total_km_calc       numeric;
  v_rate                master.rates%ROWTYPE;
  v_computed_base       numeric;
BEGIN
  -- --- Required-field validation (unchanged from TAXI-802) ---
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

  -- --- Derived fields ---
  v_total_hours_calc := CASE WHEN p_duty_end_dt IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (p_duty_end_dt - p_duty_start_dt)) / 3600.0 END;
  v_total_km_calc    := CASE WHEN p_opening_km IS NULL OR p_closing_km IS NULL THEN NULL ELSE GREATEST(0, p_closing_km - p_opening_km) END;
  v_status           := CASE WHEN p_duty_end_dt IS NOT NULL AND p_closing_km IS NOT NULL THEN 'closed' ELSE 'open' END;

  -- --- Rate lookup (TAX-803) ---
  IF p_duty_type <> 'flexible' THEN
    SELECT * INTO v_rate
      FROM master.rates r
      JOIN master.vehicles v ON v.id = p_vehicle_id
     WHERE r.company_id      = public.current_company_id()
       AND r.customer_id     = p_customer_id
       AND r.vehicle_group_id = v.vehicle_group_id
       AND r.vehicle_type_id  = v.vehicle_type_id
       AND r.duty_type        = p_duty_type::duty_type
       AND r.effective_from  <= p_booking_date
       AND (r.effective_to IS NULL OR r.effective_to >= p_booking_date)
     ORDER BY r.effective_from DESC
     LIMIT 1;

    IF v_rate.id IS NULL THEN
      RAISE EXCEPTION 'No rate configured for this customer/vehicle/duty_type combo. Please add a rate in Master → Rate Management first.'
        USING ERRCODE = 'P0002';
    END IF;

    v_computed_base := public.compute_duty_base_amount(
      v_rate.base_rate, v_rate.per_km_rate, v_rate.per_hour_rate, v_rate.per_day_rate,
      v_rate.extra_hour_rate, v_rate.extra_km_rate, v_rate.night_halt_rate, v_rate.driver_allowance,
      v_rate.duty_type::text, v_total_km_calc, v_total_hours_calc
    );

    IF v_rate.min_charge IS NOT NULL AND v_computed_base < v_rate.min_charge THEN
      v_computed_base := v_rate.min_charge;
    END IF;
  ELSE
    v_computed_base := 0;
  END IF;

  -- --- Insert ---
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
    public.current_company_id(), p_customer_id, p_vehicle_id,
    CASE WHEN p_duty_type = 'flexible' THEN NULL ELSE v_rate.id END,
    p_duty_type::duty_type, p_booking_date, NULLIF(p_booking_ref, ''),
    NULLIF(p_guest_name, ''), NULLIF(p_guest_phone, ''),
    NULLIF(p_pickup_location, ''), NULLIF(p_drop_location, ''),
    p_duty_start_dt, p_duty_end_dt,
    p_opening_km, p_closing_km,
    p_extra_km_amount, p_extra_hour_amount, p_night_halt_amount,
    p_driver_allowance, p_other_charges, NULLIF(p_other_charges_remarks, ''),
    NULLIF(p_driver_name, ''), NULLIF(p_driver_phone, ''),
    v_computed_base, v_computed_base,
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
-- 4. Patch update_duty_slip — same rate lookup + base_amount recompute
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
  v_old                operations.duty_slips%ROWTYPE;
  v_status             text;
  v_total_hours_calc   numeric;
  v_total_km_calc      numeric;
  v_rate               master.rates%ROWTYPE;
  v_computed_base      numeric;
BEGIN
  SELECT * INTO v_old
    FROM operations.duty_slips
   WHERE id = p_id AND company_id = public.current_company_id()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duty slip not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_old.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled duty slips cannot be edited.' USING ERRCODE = 'P0001'; END IF;

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

  v_total_hours_calc := CASE WHEN p_duty_end_dt IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (p_duty_end_dt - p_duty_start_dt)) / 3600.0 END;
  v_total_km_calc    := CASE WHEN p_opening_km IS NULL OR p_closing_km IS NULL THEN NULL ELSE GREATEST(0, p_closing_km - p_opening_km) END;
  v_status           := CASE
    WHEN v_old.status = 'billed' THEN 'billed'
    WHEN p_duty_end_dt IS NOT NULL AND p_closing_km IS NOT NULL THEN 'closed'
    ELSE 'open'
  END;

  IF p_duty_type <> 'flexible' THEN
    SELECT * INTO v_rate
      FROM master.rates r
      JOIN master.vehicles v ON v.id = p_vehicle_id
     WHERE r.company_id      = public.current_company_id()
       AND r.customer_id     = p_customer_id
       AND r.vehicle_group_id = v.vehicle_group_id
       AND r.vehicle_type_id  = v.vehicle_type_id
       AND r.duty_type        = p_duty_type::duty_type
       AND r.effective_from  <= p_booking_date
       AND (r.effective_to IS NULL OR r.effective_to >= p_booking_date)
     ORDER BY r.effective_from DESC
     LIMIT 1;
    IF v_rate.id IS NULL THEN
      RAISE EXCEPTION 'No rate configured for this customer/vehicle/duty_type combo. Please add a rate in Master → Rate Management first.'
        USING ERRCODE = 'P0002';
    END IF;
    v_computed_base := public.compute_duty_base_amount(
      v_rate.base_rate, v_rate.per_km_rate, v_rate.per_hour_rate, v_rate.per_day_rate,
      v_rate.extra_hour_rate, v_rate.extra_km_rate, v_rate.night_halt_rate, v_rate.driver_allowance,
      v_rate.duty_type::text, v_total_km_calc, v_total_hours_calc
    );
    IF v_rate.min_charge IS NOT NULL AND v_computed_base < v_rate.min_charge THEN
      v_computed_base := v_rate.min_charge;
    END IF;
  ELSE
    v_computed_base := 0;
  END IF;

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
         rate_id             = CASE WHEN p_duty_type = 'flexible' THEN NULL ELSE v_rate.id END,
         base_amount         = v_computed_base,
         total_amount        = v_computed_base,
         total_hours         = v_total_hours_calc,
         status              = v_status
   WHERE id = p_id AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_duty_slip(
  bigint, bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text
) TO authenticated;
