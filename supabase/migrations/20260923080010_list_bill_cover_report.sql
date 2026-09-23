-- M13 — TAXI-1301 — list_bill_cover_report RPC
--
-- Wraps reports.bill_cover with RLS (current_company_id) and
-- projects the rows into a clean payload the SPA can use. The
-- SPA filters further client-side by guest_name substring,
-- customer_id, and date range — keeps the DB work to one
-- round-trip per filter change.

SET search_path TO public, reports, billing, master;

CREATE OR REPLACE FUNCTION public.list_bill_cover_report()
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
  SELECT
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
  ORDER BY bill_no ASC, bill_id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_bill_cover_report() TO authenticated;

COMMENT ON FUNCTION public.list_bill_cover_report()
  IS 'M13 / TAXI-1301 — bill cover summary for the caller company,
      derived from reports.bill_cover. The SPA filters client-side
      (guest_name substring, customer_id, date range).';
