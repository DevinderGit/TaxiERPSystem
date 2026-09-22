-- M10 — TAXI-1001 — list_bills_for_company
-- Returns every bill for the caller's company (including cancelled)
-- with the customer name joined in. The Change / Cancel Bill page
-- uses this as the data source.

SET search_path TO public, master, billing;

CREATE OR REPLACE FUNCTION public.list_bills_for_company()
RETURNS TABLE (
  id                  bigint,
  bill_no             text,
  bill_date           date,
  customer_id         bigint,
  customer_name       text,
  customer_state      text,
  base_amount         numeric,
  extra_amount        numeric,
  total_before_tax    numeric,
  cgst_amount         numeric,
  sgst_amount         numeric,
  igst_amount         numeric,
  total_tax           numeric,
  total_after_tax     numeric,
  grand_total         numeric,
  remarks             text,
  status              text,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancel_reason       text,
  created_at          timestamptz,
  created_by          uuid,
  duty_slip_count     bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, master, billing
AS $$
  SELECT
    b.id, b.bill_no, b.bill_date,
    b.customer_id, c.name, c.state,
    b.base_amount, b.extra_amount, b.total_before_tax,
    b.cgst_amount, b.sgst_amount, b.igst_amount,
    b.total_tax, b.total_after_tax, b.grand_total,
    b.remarks, b.status::text,
    b.cancelled_at, b.cancelled_by, b.cancel_reason,
    b.created_at, b.created_by,
    (SELECT COUNT(*) FROM billing.bill_duty_slips bds WHERE bds.bill_id = b.id) AS duty_slip_count
  FROM billing.bills b
  LEFT JOIN master.customers c ON c.id = b.customer_id
  WHERE b.company_id = public.current_company_id()
  ORDER BY b.bill_date DESC, b.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_bills_for_company() TO authenticated;

COMMENT ON FUNCTION public.list_bills_for_company()
  IS 'Lists every bill for the caller company (incl. cancelled) with
      the customer name and the number of duty slips on the bill.
      Powers the Change / Cancel Bill list page (TAXI-1001).';