-- M10 follow-up — add p_status parameter to duty-slip CRUD RPCs.
-- Lets the operator manually override the auto-derived status
-- (open / closed / billed). The code still defaults to the
-- derived value when the operator passes NULL.
--
-- Also fixes the "stays billed after cancel + re-bill" symptom:
-- before this change, update_duty_slip preserved old status='billed'
-- on every edit (because of the `WHEN v_old.status='billed' THEN
-- 'billed'` short-circuit). The operator could not flip a billed
-- slip back to closed/open without involving the Change/Cancel Bill
-- page. Now: when p_status IS NULL on update, status is derived
-- purely from duty_end_dt + closing_km (the only way to "unbill"
-- a slip in place is to clear duty_end_dt + closing_km, OR pick a
-- status from the dropdown).
--
-- Defence-in-depth: cancelled slips cannot be flipped to anything
-- other than 'cancelled' (the rest of the codebase already blocks
-- edits on cancelled rows; this is a backstop in case the SPA gate
-- is bypassed).

SET search_path TO public, master, operations;

-- ============================================================
-- create_duty_slip — accepts p_status (default NULL = auto-derive)
-- ============================================================
DROP FUNCTION IF EXISTS public.create_duty_slip(
  bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text,
  text, text, jsonb
);

CREATE OR REPLACE FUNCTION public.create_duty_slip(
  p_customer_id          bigint,
  p_vehicle_id           bigint,
  p_duty_type            text,
  p_booking_date         date,
  p_duty_start_dt        timestamptz,
  p_duty_end_dt          timestamptz DEFAULT NULL,
  p_booking_ref          text        DEFAULT NULL,
  p_guest_name           text        DEFAULT NULL,
  p_guest_phone          text        DEFAULT NULL,
  p_pickup_location      text        DEFAULT NULL,
  p_drop_location        text        DEFAULT NULL,
  p_opening_km           numeric     DEFAULT NULL,
  p_closing_km           numeric     DEFAULT NULL,
  p_extra_km_amount      numeric     DEFAULT NULL,
  p_extra_hour_amount    numeric     DEFAULT NULL,
  p_night_halt_amount    numeric     DEFAULT NULL,
  p_driver_allowance     numeric     DEFAULT NULL,
  p_other_charges        numeric     DEFAULT NULL,
  p_other_charges_remarks text       DEFAULT NULL,
  p_driver_name          text        DEFAULT NULL,
  p_driver_phone         text        DEFAULT NULL,
  p_custom_rate_items    jsonb       DEFAULT NULL,
  p_status               text        DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $function$
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
  IF NOT EXISTS (SELECT 1 FROM master.vehicles  WHERE id = p_vehicle_id  AND company_id = public.current_company_id()) THEN RAISE EXCEPTION 'Vehicle not found in your company.'  USING ERRCODE = 'P0002'; END IF;

  -- --- Derived fields ---
  v_total_hours_calc := CASE WHEN p_duty_end_dt IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (p_duty_end_dt - p_duty_start_dt)) / 3600.0 END;
  v_total_km_calc    := CASE WHEN p_opening_km IS NULL OR p_closing_km IS NULL THEN NULL ELSE GREATEST(0, p_closing_km - p_opening_km) END;

  -- Status: caller-provided wins (after validation); else auto-derive.
  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('open','closed','billed','cancelled') THEN
      RAISE EXCEPTION 'Invalid status ''%''. Must be open, closed, billed, or cancelled.', p_status USING ERRCODE = '22023';
    END IF;
    v_status := p_status;
  ELSE
    v_status := CASE WHEN p_duty_end_dt IS NOT NULL AND p_closing_km IS NOT NULL THEN 'closed' ELSE 'open' END;
  END IF;

  -- --- Rate lookup ---
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
$function$;

GRANT EXECUTE ON FUNCTION public.create_duty_slip(
  bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text,
  text, text, jsonb, text
) TO authenticated;

-- ============================================================
-- update_duty_slip — accepts p_status (default NULL = auto-derive)
-- ============================================================
DROP FUNCTION IF EXISTS public.update_duty_slip(
  bigint, bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text,
  text, text, jsonb
);

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
  p_other_charges_remarks text      DEFAULT NULL,
  p_driver_name         text        DEFAULT NULL,
  p_driver_phone        text        DEFAULT NULL,
  p_custom_rate_items   jsonb       DEFAULT NULL,
  p_status              text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $function$
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

  -- Status: caller-provided wins (after validation); else auto-derive.
  -- Cancelled is REJECTED here (the SPA hides Edit on cancelled rows;
  -- this is the backstop).
  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('open','closed','billed') THEN
      RAISE EXCEPTION 'Invalid status ''%''. Must be open, closed, or billed.', p_status USING ERRCODE = '22023';
    END IF;
    v_status := p_status;
  ELSE
    -- Auto-derive: open if duty not closed yet, closed if both duty_end
    -- and closing_km are present. This deliberately does NOT preserve
    -- an existing 'billed' status (which was the old behaviour — and
    -- was the source of the "stays billed after edit" confusion). The
    -- operator who wants a slip to remain billed after editing must
    -- pass p_status='billed' explicitly from the form.
    v_status := CASE WHEN p_duty_end_dt IS NOT NULL AND p_closing_km IS NOT NULL THEN 'closed' ELSE 'open' END;
  END IF;

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
         custom_rate_items   = COALESCE(p_custom_rate_items, '[]'::jsonb),
         base_amount         = v_computed_base,
         total_amount        = v_computed_base
                                + COALESCE(p_extra_km_amount, 0)
                                + COALESCE(p_extra_hour_amount, 0)
                                + COALESCE(p_night_halt_amount, 0)
                                + COALESCE(p_driver_allowance, 0)
                                + COALESCE(p_other_charges, 0),
         total_hours         = v_total_hours_calc,
         status              = v_status
   WHERE id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_duty_slip(
  bigint, bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text,
  text, text, jsonb, text
) TO authenticated;