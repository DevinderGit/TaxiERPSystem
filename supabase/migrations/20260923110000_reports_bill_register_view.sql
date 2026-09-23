-- M13 — TAXI-1304 — reports.bill_register view
--
-- Per-bill row that powers the Bill Register Report's left list pane.
-- Slightly more detailed than reports.bill_cover (adds remarks,
-- created_by, updated_at, and the gst_config_id pin) so the report
-- has everything it might need if the operator adds more columns.
--
-- RLS: this view is intentionally read-only. Tenant isolation is
-- enforced by the SECURITY DEFINER list_* RPCs which call
-- public.current_company_id().

SET search_path TO public, reports, billing, master, core;

CREATE OR REPLACE VIEW reports.bill_register
WITH (security_invoker = false)
AS
SELECT DISTINCT ON (b.bill_no)
  b.id              AS bill_id,
  b.company_id,
  b.bill_no,
  b.bill_date,
  b.status::text    AS status,
  b.remarks,
  b.gst_config_id,
  b.base_amount,
  b.extra_amount,
  b.cgst_amount,
  b.sgst_amount,
  b.igst_amount,
  b.total_tax,
  b.total_after_tax,
  b.round_off,
  b.grand_total,
  b.cancelled_at,
  b.cancel_reason,
  b.customer_id,
  c.name            AS customer_name,
  c.company_name    AS customer_company_name,
  c.gstin           AS customer_gstin,
  c.state           AS customer_state,
  c.phone           AS customer_phone,
  -- Aggregated from bill_duty_slips + duty_slips:
  COALESCE((
    SELECT COUNT(*)::int
      FROM billing.bill_duty_slips bds
      WHERE bds.bill_id = b.id
  ), 0) AS duty_slip_count,
  COALESCE((
    SELECT string_agg(DISTINCT trim(ds.guest_name), ', '
                       ORDER BY trim(ds.guest_name))
      FROM billing.bill_duty_slips bds
      JOIN operations.duty_slips ds ON ds.id = bds.duty_slip_id
      WHERE bds.bill_id = b.id
        AND ds.guest_name IS NOT NULL
        AND ds.guest_name <> ''
  ), '') AS guest_names,
  b.created_by,
  b.created_at,
  b.updated_at
FROM billing.bills b
LEFT JOIN master.customers c ON c.id = b.customer_id
ORDER BY b.bill_no, (b.status = 'cancelled');

COMMENT ON VIEW reports.bill_register
  IS 'M13 / TAXI-1304 — per-bill view powering the Bill Register
      report left pane. Read-only. RLS via list_bill_cover_report()
      RPC.';

REVOKE ALL ON reports.bill_register FROM PUBLIC;
GRANT SELECT ON reports.bill_register TO authenticated;
GRANT SELECT ON reports.bill_register TO anon;
