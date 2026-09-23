-- M13 / TAXI-1301 follow-up — dedupe bill_cover rows server-side.
--
-- The M10 cancel_bill / recycle-on-cancel logic makes
-- UNIQUE(company_id, bill_no) PARTIAL — so the same bill_no can
-- coexist with a `cancelled` row and a fresh `issued` row. The
-- original reports.bill_cover view returned every row, which made
-- the Bill Cover Report show duplicate rows.
--
-- Fix: SELECT DISTINCT ON (bill_no) with ORDER BY (status='cancelled')
-- so the issued row wins (false sorts before true in PG).
--
-- Applied to BOTH the view and the list_bill_cover_report RPC so
-- every caller sees the same deduplicated set. The RPC's own
-- DISTINCT ON is technically redundant (the view already dedupes)
-- but it makes the RPC self-documenting and resilient if the view
-- is ever altered.

SET search_path TO public, reports, billing, master;

-- 1. Recreate the view with DISTINCT ON.
DROP VIEW IF EXISTS reports.bill_cover;

CREATE VIEW reports.bill_cover
WITH (security_invoker = false)
AS
SELECT DISTINCT ON (b.bill_no)
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
LEFT JOIN master.customers c ON c.id = b.customer_id
ORDER BY b.bill_no, (b.status = 'cancelled');

COMMENT ON VIEW reports.bill_cover
  IS 'M13 / TAXI-1301 v2 — read-only bill summary view with customer +
      duty-slip aggregates. DEDUPED via DISTINCT ON (bill_no) so the
      recycled cancelled+issued pair shows as a single row (issued
      wins). RLS-safe via list_bill_cover_report() RPC.';

-- 2. Recreate the RPC to dedupe as well (belt + braces).
DROP FUNCTION IF EXISTS public.list_bill_cover_report();

CREATE FUNCTION public.list_bill_cover_report()
RETURNS TABLE (
  bill_id             bigint,
  bill_no             text,
  bill_date           date,
  status              text,
  remarks             text,
  base_amount         numeric,
  extra_amount        numeric,
  cgst_amount         numeric,
  sgst_amount         numeric,
  igst_amount         numeric,
  total_tax           numeric,
  total_after_tax     numeric,
  round_off           numeric,
  grand_total         numeric,
  customer_id         bigint,
  customer_name       text,
  customer_company_name text,
  customer_gstin      text,
  customer_state      text,
  duty_slip_count     int,
  guest_names         text,
  created_at          timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, reports, billing, master
AS $$
  SELECT DISTINCT ON (bill_no)
    bill_id,
    bill_no,
    bill_date,
    status,
    remarks,
    base_amount,
    extra_amount,
    cgst_amount,
    sgst_amount,
    igst_amount,
    total_tax,
    total_after_tax,
    round_off,
    grand_total,
    customer_id,
    customer_name,
    customer_company_name,
    customer_gstin,
    customer_state,
    duty_slip_count,
    guest_names,
    created_at
  FROM reports.bill_cover
  WHERE company_id = public.current_company_id()
  ORDER BY bill_no, (status = 'cancelled');
$$;

GRANT EXECUTE ON FUNCTION public.list_bill_cover_report() TO authenticated;

COMMENT ON FUNCTION public.list_bill_cover_report()
  IS 'M13 / TAXI-1301 v2 — deduped bill cover summary. The view
      already dedupes; this redundant DISTINCT ON makes the RPC
      self-documenting and resilient to future view edits.';
