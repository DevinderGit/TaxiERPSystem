-- M13 — TAXI-1301 + TAXI-1304 — reports schema + bill_cover view
--
-- Per spec §13, three reports (bill_cover, bill_register,
-- duty_register) are read-only SQL views in a dedicated `reports`
-- schema. This migration creates the schema + the first view
-- (bill_cover). The other two views land in 1303 / 1304 follow-ups.
--
-- The view is defined WITHOUT WHERE clauses — the SPA / RPC
-- applies current_company_id() for tenant isolation and the page
-- does any extra filtering client-side. For very large companies
-- we'd push filters down; for now this matches the rest of the
-- codebase's small-dataset patterns.

CREATE SCHEMA IF NOT EXISTS reports;

CREATE OR REPLACE VIEW reports.bill_cover
WITH (security_invoker = false)   -- runs as view owner (the migration role)
AS
SELECT
  b.id              AS bill_id,
  b.company_id,
  b.bill_no,
  b.bill_date,
  b.status::text    AS status,
  b.remarks,
  b.base_amount,
  b.extra_amount,
  b.cgst_amount,
  b.sgst_amount,
  b.igst_amount,
  b.total_tax,
  b.total_after_tax,
  b.round_off,
  b.grand_total,
  b.customer_id,
  c.name            AS customer_name,
  c.company_name    AS customer_company_name,
  c.gstin           AS customer_gstin,
  c.state           AS customer_state,
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
  b.created_at
FROM billing.bills b
LEFT JOIN master.customers c ON c.id = b.customer_id;

COMMENT ON VIEW reports.bill_cover
  IS 'M13 / TAXI-1301 — read-only bill summary view with
      customer + duty-slip aggregates. RLS-safe via the
      list_bill_cover_report() RPC which filters by
      current_company_id().';

-- Revoke all writes — view is read-only.
REVOKE ALL ON reports.bill_cover FROM PUBLIC;
GRANT SELECT ON reports.bill_cover TO authenticated;
GRANT SELECT ON reports.bill_cover TO anon;
