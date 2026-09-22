-- M9 — revised Billing page — list_duty_slips_in_range RPC.
-- Replaces the customer-filter approach with a duty_slip_no range
-- query. Returns ALL slips in the range for the caller's company,
-- regardless of bill_id, customer, or status. The Billing page uses
-- this to show every slip and let the operator tick the unbilled
-- ones to bill; billed + cancelled slips appear read-only.

SET search_path TO public, master, operations;

CREATE OR REPLACE FUNCTION public.list_duty_slips_in_range(
  p_start_no text,
  p_end_no   text
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
SET search_path = 'public', 'master', 'operations'
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
    AND ds.duty_slip_no BETWEEN p_start_no AND p_end_no
  ORDER BY ds.duty_slip_no ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.list_duty_slips_in_range(text, text)
  TO authenticated;

COMMENT ON FUNCTION public.list_duty_slips_in_range(text, text)
  IS 'Lists every duty slip in the caller company whose duty_slip_no
      falls in [p_start_no, p_end_no] (lexical range; works with any
      prefix). Includes billed, unbilled, and cancelled slips; the
      SPA gates which can be ticked. Powers the revised Billing page
      (TAXI-903 rev2).';