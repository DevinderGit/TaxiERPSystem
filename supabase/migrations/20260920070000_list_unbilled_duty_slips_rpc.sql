-- M9 — TAXI-903 — list_unbilled_duty_slips_for_customer
-- Returns duty slips that can be billed for the given customer:
-- (a) belong to the customer, (b) belong to the caller's company,
-- (c) have bill_id IS NULL, (d) status in ('open', 'closed') —
-- cancelled slips are excluded. Used by the Billing page to populate
-- the "select slips to bill" list.

SET search_path TO public, master, operations;

CREATE OR REPLACE FUNCTION public.list_unbilled_duty_slips_for_customer(
  p_customer_id bigint
)
RETURNS TABLE (
  id                  bigint,
  duty_slip_no        text,
  booking_date        date,
  vehicle_id          bigint,
  vehicle_reg_no      text,
  duty_type           text,
  opening_km          numeric,
  closing_km          numeric,
  total_km            numeric,
  duty_start_dt       timestamp with time zone,
  duty_end_dt         timestamp with time zone,
  total_hours         numeric,
  base_amount         numeric,
  extra_km_amount     numeric,
  extra_hour_amount   numeric,
  night_halt_amount   numeric,
  driver_allowance    numeric,
  other_charges       numeric,
  total_amount        numeric,
  status              text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public', 'master', 'operations'
AS $function$
  SELECT
    ds.id, ds.duty_slip_no, ds.booking_date,
    ds.vehicle_id, v.registration_no,
    ds.duty_type::text,
    ds.opening_km, ds.closing_km, ds.total_km,
    ds.duty_start_dt, ds.duty_end_dt,
    CASE
      WHEN ds.duty_end_dt IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (ds.duty_end_dt - ds.duty_start_dt)) / 3600.0
    END AS total_hours,
    ds.base_amount, ds.extra_km_amount, ds.extra_hour_amount,
    ds.night_halt_amount, ds.driver_allowance, ds.other_charges,
    ds.total_amount, ds.status::text
  FROM operations.duty_slips ds
  LEFT JOIN master.vehicles v ON v.id = ds.vehicle_id
  WHERE ds.company_id = public.current_company_id()
    AND ds.customer_id = p_customer_id
    AND ds.bill_id IS NULL
    AND ds.status IN ('open', 'closed')
  ORDER BY ds.booking_date DESC, ds.id DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.list_unbilled_duty_slips_for_customer(bigint)
  TO authenticated;

COMMENT ON FUNCTION public.list_unbilled_duty_slips_for_customer(bigint)
  IS 'Lists unbilled duty slips (bill_id IS NULL AND status IN open/closed)
      for the given customer in the caller''s company. Used by the Billing
      page (TAXI-903) to populate the select-slips UI.';