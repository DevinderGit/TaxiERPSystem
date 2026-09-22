-- TAXI-602 — Public-schema RPCs for Rate CRUD + time-travel-on-edit.
--
-- Per the MTP / TAXI-603 spec: editing a currently-effective rate
-- (effective_to IS NULL) means we don't UPDATE the row in place — we
-- (a) close the old row (effective_to = CURRENT_DATE - 1) and (b) INSERT
-- a new row with effective_from = CURRENT_DATE, effective_to = NULL,
-- carrying the new rate values. This preserves historical accuracy: a
-- duty slip that booked before the change still sees the old rate.
--
-- Same PostgREST custom-schema workaround as the other M2/M3/M4/M5/M6 RPCs.

-- ============================================================================
-- 1. add_rate — insert a new currently-effective rate
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_rate(
  p_customer_id       bigint,
  p_vehicle_group_id  bigint,
  p_vehicle_type_id   bigint,
  p_duty_type         text,
  p_base_rate         numeric,
  p_per_km_rate       numeric DEFAULT NULL,
  p_per_hour_rate     numeric DEFAULT NULL,
  p_per_day_rate      numeric DEFAULT NULL,
  p_extra_hour_rate   numeric DEFAULT NULL,
  p_extra_km_rate     numeric DEFAULT NULL,
  p_night_halt_rate   numeric DEFAULT NULL,
  p_driver_allowance  numeric DEFAULT NULL,
  p_min_charge        numeric DEFAULT NULL,
  p_effective_from    date    DEFAULT CURRENT_DATE
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_duty_type NOT IN ('per_km', 'per_hour', 'per_day', 'local_package', 'outstation', 'flexible') THEN
    RAISE EXCEPTION 'Invalid duty_type ''%''.', p_duty_type
      USING ERRCODE = '22023';
  END IF;

  IF p_base_rate IS NULL OR p_base_rate < 0 THEN
    RAISE EXCEPTION 'base_rate is required and must be ≥ 0.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO master.rates (
    company_id, customer_id, vehicle_group_id, vehicle_type_id,
    duty_type, base_rate, per_km_rate, per_hour_rate, per_day_rate,
    extra_hour_rate, extra_km_rate, night_halt_rate,
    driver_allowance, min_charge, effective_from
  ) VALUES (
    public.current_company_id(), p_customer_id,
    p_vehicle_group_id, p_vehicle_type_id,
    p_duty_type::duty_type, p_base_rate,
    p_per_km_rate, p_per_hour_rate, p_per_day_rate,
    p_extra_hour_rate, p_extra_km_rate, p_night_halt_rate,
    p_driver_allowance, p_min_charge,
    COALESCE(p_effective_from, CURRENT_DATE)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_rate(
  bigint, bigint, bigint, text, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, date
) TO authenticated;

-- ============================================================================
-- 2. update_rate_with_time_travel — close old row, insert new
-- ============================================================================
-- MTP step 7–9 flow:
--   User edits base_rate=500 → 600 on the current (effective_to IS NULL) row.
--   - confirm dialog
--   - old row: SET effective_to = CURRENT_DATE - 1
--   - new row: INSERT with effective_from = CURRENT_DATE, effective_to = NULL,
--     all the other fields from the old row, base_rate = the new value
--
-- Returns the new row's id so the SPA can highlight it.

CREATE OR REPLACE FUNCTION public.update_rate_with_time_travel(
  p_id                bigint,
  p_base_rate         numeric DEFAULT NULL,
  p_per_km_rate       numeric DEFAULT NULL,
  p_per_hour_rate     numeric DEFAULT NULL,
  p_per_day_rate      numeric DEFAULT NULL,
  p_extra_hour_rate   numeric DEFAULT NULL,
  p_extra_km_rate     numeric DEFAULT NULL,
  p_night_halt_rate   numeric DEFAULT NULL,
  p_driver_allowance  numeric DEFAULT NULL,
  p_min_charge        numeric DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_old        master.rates%ROWTYPE;
  v_new_id     bigint;
  v_eff_from   date := CURRENT_DATE;
  v_eff_to_old date := CURRENT_DATE - INTERVAL '1 day';
BEGIN
  -- Lock + read the current row. Must be effective (effective_to IS NULL).
  SELECT * INTO v_old
    FROM master.rates
   WHERE id = p_id
     AND company_id = public.current_company_id()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rate row not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'This rate has been closed by a later change (effective_to=%). Only the currently-effective rate can be edited.', v_old.effective_to
      USING ERRCODE = 'P0001';
  END IF;

  -- Close the old row.
  UPDATE master.rates
     SET effective_to = v_eff_to_old
   WHERE id = p_id;

  -- Insert the new row, carrying forward all other fields, replacing
  -- only the fields the caller explicitly passed.
  INSERT INTO master.rates (
    company_id, customer_id, vehicle_group_id, vehicle_type_id,
    duty_type, base_rate, per_km_rate, per_hour_rate, per_day_rate,
    extra_hour_rate, extra_km_rate, night_halt_rate,
    driver_allowance, min_charge,
    effective_from, effective_to
  ) VALUES (
    v_old.company_id, v_old.customer_id,
    v_old.vehicle_group_id, v_old.vehicle_type_id,
    v_old.duty_type,
    COALESCE(p_base_rate,        v_old.base_rate),
    COALESCE(p_per_km_rate,      v_old.per_km_rate),
    COALESCE(p_per_hour_rate,    v_old.per_hour_rate),
    COALESCE(p_per_day_rate,     v_old.per_day_rate),
    COALESCE(p_extra_hour_rate,  v_old.extra_hour_rate),
    COALESCE(p_extra_km_rate,    v_old.extra_km_rate),
    COALESCE(p_night_halt_rate,  v_old.night_halt_rate),
    COALESCE(p_driver_allowance, v_old.driver_allowance),
    COALESCE(p_min_charge,       v_old.min_charge),
    v_eff_from, NULL
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_rate_with_time_travel(
  bigint, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) TO authenticated;
