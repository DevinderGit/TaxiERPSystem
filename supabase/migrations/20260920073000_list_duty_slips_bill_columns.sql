-- M10 prep — add bill_id + bill_no to list_duty_slips_for_company.
-- The Duty Slip list page needs to know which bill (if any) a slip
-- is on so the operator can click through to it. Also enables
-- Edit-on-billed-slips with a warning that the bill's snapshot is
-- now stale.

SET search_path TO public, master, operations, billing;

DROP FUNCTION IF EXISTS public.list_duty_slips_for_company();

CREATE OR REPLACE FUNCTION public.list_duty_slips_for_company()
RETURNS TABLE (
  id                 bigint,
  duty_slip_no       text,
  booking_date       date,
  customer_id        bigint,
  customer_name      text,
  vehicle_id         bigint,
  vehicle_reg_no     text,
  duty_type          text,
  opening_km         numeric,
  closing_km         numeric,
  total_km           numeric,
  duty_start_dt      timestamptz,
  duty_end_dt        timestamptz,
  total_hours        numeric,
  base_amount        numeric,
  extra_km_amount    numeric,
  extra_hour_amount  numeric,
  night_halt_amount  numeric,
  driver_allowance   numeric,
  other_charges      numeric,
  total_amount       numeric,
  rate_id            bigint,
  bill_id            bigint,
  bill_no            text,
  status             text,
  custom_rate_items  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master, operations, billing
AS $$
  SELECT
    ds.id,
    ds.duty_slip_no,
    ds.booking_date,
    ds.customer_id,
    c.name,
    ds.vehicle_id,
    v.registration_no,
    ds.duty_type::text,
    ds.opening_km,
    ds.closing_km,
    ds.total_km,
    ds.duty_start_dt,
    ds.duty_end_dt,
    CASE
      WHEN ds.duty_end_dt IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (ds.duty_end_dt - ds.duty_start_dt)) / 3600.0
    END,
    ds.base_amount,
    ds.extra_km_amount,
    ds.extra_hour_amount,
    ds.night_halt_amount,
    ds.driver_allowance,
    ds.other_charges,
    ds.total_amount,
    ds.rate_id,
    ds.bill_id,
    b.bill_no,
    ds.status::text,
    ds.custom_rate_items
  FROM operations.duty_slips ds
  LEFT JOIN master.customers c ON c.id = ds.customer_id
  LEFT JOIN master.vehicles  v ON v.id = ds.vehicle_id
  LEFT JOIN billing.bills    b ON b.id = ds.bill_id
  WHERE ds.company_id = public.current_company_id()
  ORDER BY ds.booking_date DESC, ds.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_duty_slips_for_company() TO authenticated;