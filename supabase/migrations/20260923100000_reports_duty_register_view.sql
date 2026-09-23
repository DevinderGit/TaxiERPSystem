-- M13 — TAXI-1303 — reports.duty_register view + list_duty_register_report RPC
--
-- Summary view of every duty slip in the caller's company with
-- customer name, vehicle registration, and bill_no joined in.
-- The view is read-only; the SPA filters client-side.

SET search_path TO public, reports, master, operations, billing;

CREATE OR REPLACE VIEW reports.duty_register
WITH (security_invoker = false)
AS
SELECT
  ds.id              AS duty_slip_id,
  ds.company_id,
  ds.duty_slip_no,
  ds.booking_date,
  ds.duty_type::text AS duty_type,
  ds.status::text    AS status,
  ds.total_km,
  ds.total_hours,
  ds.base_amount,
  ds.total_amount,
  ds.bill_id,
  b.bill_no,
  b.status::text    AS bill_status,
  ds.customer_id,
  c.name            AS customer_name,
  c.company_name    AS customer_company_name,
  ds.vehicle_id,
  v.registration_no AS vehicle_reg_no,
  ds.created_at
FROM operations.duty_slips ds
LEFT JOIN master.customers c ON c.id = ds.customer_id
LEFT JOIN master.vehicles  v ON v.id = ds.vehicle_id
LEFT JOIN billing.bills     b ON b.id = ds.bill_id;

COMMENT ON VIEW reports.duty_register
  IS 'M13 / TAXI-1303 — read-only duty slip summary with customer +
      vehicle + bill number joined. RLS-safe via
      list_duty_register_report() RPC.';

REVOKE ALL ON reports.duty_register FROM PUBLIC;
GRANT SELECT ON reports.duty_register TO authenticated;
GRANT SELECT ON reports.duty_register TO anon;
