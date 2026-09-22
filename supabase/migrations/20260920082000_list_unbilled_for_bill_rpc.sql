-- M10 — TAXI-1003 helper — list_duty_slips_for_bill_customer
-- Returns every unbilled duty slip for the same customer as a given
-- bill (used by the "Add / Remove Slips" modal to populate the
-- "Available to add" list). Excludes slips already on this bill.

SET search_path TO public, master, operations;

CREATE OR REPLACE FUNCTION public.list_duty_slips_for_bill_customer(
  p_bill_id bigint
)
RETURNS TABLE (
  id                bigint,
  duty_slip_no      text,
  booking_date      date,
  duty_type         text,
  base_amount       numeric,
  total_amount      numeric,
  status            text,
  already_on_bill   boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, master, operations
AS $$
  WITH bill AS (
    SELECT * FROM billing.bills WHERE id = p_bill_id AND company_id = public.current_company_id()
  )
  SELECT
    ds.id, ds.duty_slip_no, ds.booking_date,
    ds.duty_type::text, ds.base_amount, ds.total_amount,
    ds.status::text,
    (ds.bill_id = p_bill_id) AS already_on_bill
  FROM operations.duty_slips ds, bill b
  WHERE ds.company_id = public.current_company_id()
    AND ds.customer_id = b.customer_id
    AND (ds.bill_id IS NULL OR ds.bill_id = p_bill_id)
    AND ds.status IN ('open', 'closed', 'billed')
  ORDER BY already_on_bill DESC, ds.booking_date DESC, ds.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_duty_slips_for_bill_customer(bigint) TO authenticated;