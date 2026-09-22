-- Update add_rate for the new architecture: duty_type is optional (rates
-- are per customer + vehicle, not per duty_type). The 3 valid duty_types
-- remain local / outstation / flexible; the old enum values are rejected
-- (matches the new duty-slip RPC behaviour).

CREATE OR REPLACE FUNCTION public.add_rate(
  p_customer_id       bigint,
  p_vehicle_group_id  bigint,
  p_vehicle_type_id   bigint,
  p_base_rate         numeric,
  p_duty_type         text          DEFAULT NULL,
  p_per_km_rate       numeric       DEFAULT NULL,
  p_per_hour_rate     numeric       DEFAULT NULL,
  p_per_day_rate      numeric       DEFAULT NULL,
  p_extra_hour_rate   numeric       DEFAULT NULL,
  p_extra_km_rate     numeric       DEFAULT NULL,
  p_night_halt_rate   numeric       DEFAULT NULL,
  p_driver_allowance  numeric       DEFAULT NULL,
  p_min_charge        numeric       DEFAULT NULL,
  p_effective_from    date          DEFAULT CURRENT_DATE
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_duty_type IS NOT NULL AND p_duty_type NOT IN ('local','outstation','flexible') THEN
    RAISE EXCEPTION 'Invalid duty_type ''%'' — expected local, outstation, or flexible.', p_duty_type
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
  bigint, bigint, bigint, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date
) TO authenticated;
