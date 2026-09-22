-- M9 / Duty-slip billing panel — allow NULL bounds on
-- list_duty_slips_in_range so the page can default to "no range,
-- show all slips" when the operator hasn't typed a filter yet.
--
-- Before: required both bounds; empty inputs meant the RPC was
-- never called. Now: NULL on either bound means "no bound on that
-- side", so empty inputs + Search = every slip in the company.

SET search_path TO public, master, operations, billing;

DROP FUNCTION IF EXISTS public.list_duty_slips_in_range(text, text);

CREATE OR REPLACE FUNCTION public.list_duty_slips_in_range(
  p_start_no text DEFAULT NULL,
  p_end_no   text DEFAULT NULL
)
RETURNS TABLE (
  id                  bigint,
  duty_slip_no        text,
  booking_date        date,
  customer_id         bigint,
  customer_name       text,
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
  bill_id             bigint,
  bill_no             text,
  status              text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public', 'master', 'operations', 'billing'
AS $function$
  SELECT
    ds.id, ds.duty_slip_no, ds.booking_date,
    ds.customer_id, c.name,
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
    ds.total_amount,
    ds.bill_id, b.bill_no,
    ds.status::text
  FROM operations.duty_slips ds
  LEFT JOIN master.customers c ON c.id = ds.customer_id
  LEFT JOIN master.vehicles  v ON v.id = ds.vehicle_id
  LEFT JOIN billing.bills    b ON b.id = ds.bill_id
  WHERE ds.company_id = public.current_company_id()
    AND (p_start_no IS NULL OR ds.duty_slip_no >= p_start_no)
    AND (p_end_no   IS NULL OR ds.duty_slip_no <= p_end_no)
  ORDER BY ds.duty_slip_no ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.list_duty_slips_in_range(text, text) TO authenticated;