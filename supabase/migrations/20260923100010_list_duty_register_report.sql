-- M13 — TAXI-1303 — list_duty_register_report RPC
--
-- Wraps reports.duty_register with RLS (current_company_id) and
-- projects the rows into a clean payload the SPA can use.

SET search_path TO public, reports, master, operations, billing;

CREATE OR REPLACE FUNCTION public.list_duty_register_report()
RETURNS TABLE (
  duty_slip_id          bigint,
  duty_slip_no          text,
  booking_date          date,
  duty_type             text,
  status                text,
  total_km              numeric,
  total_hours           numeric,
  base_amount           numeric,
  total_amount          numeric,
  bill_id               bigint,
  bill_no               text,
  bill_status           text,
  customer_id           bigint,
  customer_name         text,
  customer_company_name text,
  vehicle_id            bigint,
  vehicle_reg_no        text,
  created_at            timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, reports, master, operations, billing
AS $$
  SELECT
    duty_slip_id,
    duty_slip_no,
    booking_date,
    duty_type,
    status,
    total_km,
    total_hours,
    base_amount,
    total_amount,
    bill_id,
    bill_no,
    bill_status,
    customer_id,
    customer_name,
    customer_company_name,
    vehicle_id,
    vehicle_reg_no,
    created_at
  FROM reports.duty_register
  WHERE company_id = public.current_company_id()
  ORDER BY booking_date DESC, duty_slip_no ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_duty_register_report() TO authenticated;

COMMENT ON FUNCTION public.list_duty_register_report()
  IS 'M13 / TAXI-1303 — duty register summary for the caller company,
      derived from reports.duty_register. SPA filters client-side.';
