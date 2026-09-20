-- Operator-directed cleanup (M8 + M6 follow-ups):
--   1. Drop duty_type from rates: rates become a per-(customer, vehicle) rate
--      card. duty_type is selected on the duty slip (Local / Outstation /
--      Flexible).
--   2. Simplify the duty_type enum to 3 values: local, outstation, flexible.
--   3. Add custom_rate_items JSONB on duty_slips (flexible popup items).
--   4. Remove the future-booking-date check (operator wants to pre-create
--      bookings for upcoming trips).
--   5. Update create_duty_slip / update_duty_slip / lookup_rate_for_duty_slip
--      to match.
--   6. Drop update_rate_with_time_travel + the partial unique index on
--      master.rates (operator wants simple in-place UPDATE, no time-travel).

-- ============================================================================
-- 1. 'local' value is added by the prior migration
-- (20260919110000_add_local_duty_type.sql) — this migration runs after.
-- ============================================================================

-- ============================================================================
-- 2. Migrate existing rows to 'local' (so the old enum values can be
-- dropped in step 3).
-- ============================================================================
UPDATE master.rates          SET duty_type = 'local' WHERE duty_type IN ('per_km','per_hour','per_day','local_package');
UPDATE operations.duty_slips SET duty_type = 'local' WHERE duty_type IN ('per_km','per_hour','per_day','local_package');

-- Drop duplicate rate rows that now collide on (company_id, customer_id,
-- vehicle_group_id, vehicle_type_id) since duty_type is no longer part
-- of the key. Keep the lowest-id row.
DELETE FROM master.rates r1
USING master.rates r2
WHERE r1.company_id       = r2.company_id
  AND r1.customer_id      = r2.customer_id
  AND r1.vehicle_group_id = r2.vehicle_group_id
  AND r1.vehicle_type_id  = r2.vehicle_type_id
  AND r1.id > r2.id;

-- ============================================================================
-- 3. (Skip) Drop old enum values — Postgres 17 does not support
-- `ALTER TYPE ... DROP VALUE`. The old values (per_km / per_hour /
-- per_day / local_package) remain in the enum as historical artifacts;
-- the duty-slip RPCs now reject anything that isn't local / outstation /
-- flexible, and the rate form only shows the 3 new duty_type options.
-- ============================================================================

-- ============================================================================
-- 4. Drop duty_type from master.rates (NULL now allowed; the partial
-- unique index from TAXI-602 keeps the per-combo uniqueness invariant
-- for currently-effective rows).
-- ============================================================================
ALTER TABLE master.rates ALTER COLUMN duty_type DROP NOT NULL;

-- (The original full UNIQUE constraint on (company_id, customer_id,
-- vehicle_group_id, vehicle_type_id, duty_type, effective_from) was
-- already dropped by TAXI-602's partial-unique-index migration — see
-- `20260919020000_rates_partial_unique.sql`. No further action needed
-- on constraints; the partial index already enforces "one currently-
-- effective row per (company, customer, vehicle_group, vehicle_type)".)

-- ============================================================================
-- 5. Add custom_rate_items JSONB on duty_slips (flexible popup storage).
-- ============================================================================
ALTER TABLE operations.duty_slips
  ADD COLUMN IF NOT EXISTS custom_rate_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- 6. Drop the time-travel RPC + the partial unique index (operator wants
-- simple in-place UPDATE, no previous-rate history needed).
-- ============================================================================
DROP FUNCTION IF EXISTS public.update_rate_with_time_trial(bigint, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.update_rate_with_time_travel(bigint, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric);
DROP INDEX IF EXISTS master.rates_one_current_per_combo;

-- ============================================================================
-- 7. New simple update_rate RPC (in-place UPDATE).
-- ============================================================================
-- Keeps the same arity/signature as update_rate_with_time_travel so the
-- RateFormModal handler doesn't need to change beyond swapping the RPC
-- name. We DROP + re-CREATE under the same name (`update_rate`) — the
-- SPA can keep calling `update_rate_with_time_travel` until the frontend
-- swap; the SPA swap is in the next migration's frontend change.

CREATE OR REPLACE FUNCTION public.update_rate(
  p_id            bigint,
  p_base_rate          numeric DEFAULT NULL,
  p_per_km_rate        numeric DEFAULT NULL,
  p_per_hour_rate      numeric DEFAULT NULL,
  p_per_day_rate       numeric DEFAULT NULL,
  p_extra_hour_rate    numeric DEFAULT NULL,
  p_extra_km_rate      numeric DEFAULT NULL,
  p_night_halt_rate    numeric DEFAULT NULL,
  p_driver_allowance   numeric DEFAULT NULL,
  p_min_charge         numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
BEGIN
  UPDATE master.rates
     SET base_rate        = COALESCE(p_base_rate,        base_rate),
         per_km_rate      = COALESCE(p_per_km_rate,      per_km_rate),
         per_hour_rate    = COALESCE(p_per_hour_rate,    per_hour_rate),
         per_day_rate     = COALESCE(p_per_day_rate,     per_day_rate),
         extra_hour_rate  = COALESCE(p_extra_hour_rate,  extra_hour_rate),
         extra_km_rate    = COALESCE(p_extra_km_rate,    extra_km_rate),
         night_halt_rate  = COALESCE(p_night_halt_rate,  night_halt_rate),
         driver_allowance = COALESCE(p_driver_allowance, driver_allowance),
         min_charge       = COALESCE(p_min_charge,       min_charge)
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_rate(
  bigint, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) TO authenticated;

-- ============================================================================
-- 8. Updated compute_duty_base_amount — handle the new 3 duty_types.
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
  v_days := CASE WHEN p_total_hours IS NULL THEN NULL ELSE CEIL(p_total_hours / 24.0) END;

  CASE p_duty_type
    WHEN 'local' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_km_rate, 0) * COALESCE(p_total_km, 0)
           + COALESCE(p_per_hour_rate, 0) * COALESCE(p_total_hours, 0)
           + COALESCE(p_per_day_rate, 0) * COALESCE(v_days, 1);
    WHEN 'outstation' THEN
      RETURN COALESCE(p_base_rate, 0)
           + COALESCE(p_per_km_rate, 0) * COALESCE(p_total_km, 0)
           + COALESCE(p_night_halt_rate, 0) * COALESCE(v_days, 0)
           + COALESCE(p_driver_allowance, 0) * COALESCE(v_days, 0);
    WHEN 'flexible' THEN
      -- base_amount for flexible is computed from custom_rate_items in
      -- create/update_duty_slip; here we return base_rate only.
      RETURN COALESCE(p_base_rate, 0);
    ELSE
      RETURN COALESCE(p_base_rate, 0);
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_duty_base_amount(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, numeric, numeric
) TO authenticated;

-- ============================================================================
-- 9. Updated lookup_rate_for_duty_slip — drop duty_type from the join.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lookup_rate_for_duty_slip(
  p_customer_id     bigint,
  p_vehicle_id      bigint,
  p_booking_date    date,
  p_total_km        numeric DEFAULT NULL,
  p_total_hours     numeric DEFAULT NULL
)
RETURNS TABLE (
  found              boolean,
  rate_id            bigint,
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
       AND r.effective_from  <= p_booking_date
       AND (r.effective_to IS NULL OR r.effective_to >= p_booking_date)
     ORDER BY r.effective_from DESC
     LIMIT 1
  )
  SELECT
    (r.id IS NOT NULL)                       AS found,
    r.id                                      AS rate_id,
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
      'local', p_total_km, p_total_hours
    )                                       AS computed_base,
    CASE
      WHEN r.id IS NULL OR r.min_charge IS NULL THEN FALSE
      WHEN public.compute_duty_base_amount(
        r.base_rate, r.per_km_rate, r.per_hour_rate, r.per_day_rate,
        r.extra_hour_rate, r.extra_km_rate, r.night_halt_rate, r.driver_allowance,
        'local', p_total_km, p_total_hours
      ) < r.min_charge THEN TRUE
      ELSE FALSE
    END                                       AS min_charge_applied
  FROM rate r;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_rate_for_duty_slip(
  bigint, bigint, date, numeric, numeric
) TO authenticated;

-- ============================================================================
-- 10. Updated create_duty_slip — 3 duty_types, custom_rate_items support,
-- allow future booking_date.
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
  p_driver_phone       text        DEFAULT NULL,
  p_custom_rate_items  jsonb       DEFAULT NULL
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
  v_flexible_sum        numeric;
BEGIN
  -- --- Required-field validation ---
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer is required.' USING ERRCODE = '22023'; END IF;
  IF p_vehicle_id  IS NULL THEN RAISE EXCEPTION 'Vehicle is required.'  USING ERRCODE = '22023'; END IF;
  IF p_duty_type NOT IN ('local','outstation','flexible') THEN
    RAISE EXCEPTION 'Invalid duty_type ''%''.', p_duty_type USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION 'Booking date is required.' USING ERRCODE = '22023'; END IF;
  IF p_duty_start_dt IS NULL THEN RAISE EXCEPTION 'Duty start date/time is required.' USING ERRCODE = '22023'; END IF;
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

  -- --- Rate lookup (TAX-803, updated for the 3 duty_types) ---
  IF p_duty_type IN ('local', 'outstation') THEN
    SELECT * INTO v_rate
      FROM master.rates r
      JOIN master.vehicles v ON v.id = p_vehicle_id
     WHERE r.company_id      = public.current_company_id()
       AND r.customer_id     = p_customer_id
       AND r.vehicle_group_id = v.vehicle_group_id
       AND r.vehicle_type_id  = v.vehicle_type_id
       AND r.effective_from  <= p_booking_date
       AND (r.effective_to IS NULL OR r.effective_to >= p_booking_date)
     ORDER BY r.effective_from DESC
     LIMIT 1;
    IF v_rate.id IS NULL THEN
      RAISE EXCEPTION 'No rate configured for this customer/vehicle combo. Please add a rate in Master → Rate Management first.'
        USING ERRCODE = 'P0002';
    END IF;
    v_computed_base := public.compute_duty_base_amount(
      v_rate.base_rate, v_rate.per_km_rate, v_rate.per_hour_rate, v_rate.per_day_rate,
      v_rate.extra_hour_rate, v_rate.extra_km_rate, v_rate.night_halt_rate, v_rate.driver_allowance,
      p_duty_type, v_total_km_calc, v_total_hours_calc
    );
    IF v_rate.min_charge IS NOT NULL AND v_computed_base < v_rate.min_charge THEN
      v_computed_base := v_rate.min_charge;
    END IF;
  ELSIF p_duty_type = 'flexible' THEN
    -- Flexible: base_amount is the sum of custom_rate_items.amount, or 0
    -- if the operator didn't enter any items. The popup (TAXI-804) captures
    -- custom_rate_remarks and the items array.
    v_flexible_sum := COALESCE((
      SELECT SUM( (item->>'amount')::numeric )
        FROM jsonb_array_elements(COALESCE(p_custom_rate_items, '[]'::jsonb)) AS item
    ), 0);
    v_computed_base := v_flexible_sum;
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
    total_hours, status,
    custom_rate_items
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
    v_total_hours_calc, v_status,
    COALESCE(p_custom_rate_items, '[]'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_duty_slip(
  bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text, jsonb
) TO authenticated;

-- ============================================================================
-- 11. Updated update_duty_slip — same changes as create.
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
  p_driver_phone        text        DEFAULT NULL,
  p_custom_rate_items  jsonb       DEFAULT NULL
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
  v_flexible_sum       numeric;
BEGIN
  SELECT * INTO v_old
    FROM operations.duty_slips
   WHERE id = p_id AND company_id = public.current_company_id()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duty slip not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_old.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled duty slips cannot be edited.' USING ERRCODE = 'P0001'; END IF;

  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer is required.' USING ERRCODE = '22023'; END IF;
  IF p_vehicle_id  IS NULL THEN RAISE EXCEPTION 'Vehicle is required.'  USING ERRCODE = '22023'; END IF;
  IF p_duty_type NOT IN ('local','outstation','flexible') THEN
    RAISE EXCEPTION 'Invalid duty_type ''%''.', p_duty_type USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION 'Booking date is required.' USING ERRCODE = '22023'; END IF;
  IF p_duty_start_dt IS NULL THEN RAISE EXCEPTION 'Duty start date/time is required.' USING ERRCODE = '22023'; END IF;
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

  IF p_duty_type IN ('local', 'outstation') THEN
    SELECT * INTO v_rate
      FROM master.rates r
      JOIN master.vehicles v ON v.id = p_vehicle_id
     WHERE r.company_id      = public.current_company_id()
       AND r.customer_id     = p_customer_id
       AND r.vehicle_group_id = v.vehicle_group_id
       AND r.vehicle_type_id  = v.vehicle_type_id
       AND r.effective_from  <= p_booking_date
       AND (r.effective_to IS NULL OR r.effective_to >= p_booking_date)
     ORDER BY r.effective_from DESC
     LIMIT 1;
    IF v_rate.id IS NULL THEN
      RAISE EXCEPTION 'No rate configured for this customer/vehicle combo. Please add a rate in Master → Rate Management first.'
        USING ERRCODE = 'P0002';
    END IF;
    v_computed_base := public.compute_duty_base_amount(
      v_rate.base_rate, v_rate.per_km_rate, v_rate.per_hour_rate, v_rate.per_day_rate,
      v_rate.extra_hour_rate, v_rate.extra_km_rate, v_rate.night_halt_rate, v_rate.driver_allowance,
      p_duty_type, v_total_km_calc, v_total_hours_calc
    );
    IF v_rate.min_charge IS NOT NULL AND v_computed_base < v_rate.min_charge THEN
      v_computed_base := v_rate.min_charge;
    END IF;
  ELSIF p_duty_type = 'flexible' THEN
    v_flexible_sum := COALESCE((
      SELECT SUM( (item->>'amount')::numeric )
        FROM jsonb_array_elements(COALESCE(p_custom_rate_items, '[]'::jsonb)) AS item
    ), 0);
    v_computed_base := v_flexible_sum;
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
         status              = v_status,
         custom_rate_items   = COALESCE(p_custom_rate_items, custom_rate_items)
   WHERE id = p_id AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_duty_slip(
  bigint, bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text, jsonb
) TO authenticated;
