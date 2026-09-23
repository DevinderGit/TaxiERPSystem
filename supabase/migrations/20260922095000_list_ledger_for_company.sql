-- M12 — TAXI-1201 — list_ledger_for_company RPC
--
-- Returns every bill in the caller's company with the customer
-- name joined in. The SPA filters the result client-side by
-- bill-number numeric-tail range (per the M10 / operator's
-- "1 == 0001" convention).
--
-- Also returns the current `core.companies` row so the LedgerPDF
-- template can render the company header without a second RPC.
--
-- Cancelled bill rows are kept (the recycle-on-cancel M10 work can
-- produce multiple rows with the same bill_no). The page prefers
-- the non-cancelled row in the JS, but we return all of them and
-- let the page decide.

SET search_path TO public, master, billing, core;

DROP FUNCTION IF EXISTS public.list_ledger_for_company();

CREATE FUNCTION public.list_ledger_for_company()
RETURNS TABLE (
  bill_id              bigint,
  bill_no              text,
  bill_date            date,
  customer_id          bigint,
  customer_name        text,
  status               text,
  base_amount          numeric,
  extra_amount         numeric,
  grand_total          numeric,
  cgst_amount          numeric,
  sgst_amount          numeric,
  igst_amount          numeric,
  total_tax            numeric,
  created_at           timestamptz,
  -- company row (single value, repeated on every row)
  company_id           bigint,
  company_name         text,
  company_legal_name   text,
  company_gstin        text,
  company_pan          text,
  company_sac_no       text,
  company_state_code   text,
  company_st_category  text,
  company_address_line1 text,
  company_address_line2 text,
  company_city         text,
  company_state        text,
  company_pincode      text,
  company_phone        text,
  company_email        text,
  company_logo_path    text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, master, billing, core
AS $$
  SELECT
    b.id,
    b.bill_no,
    b.bill_date,
    b.customer_id,
    c.name,
    b.status::text,
    b.base_amount,
    b.extra_amount,
    b.grand_total,
    b.cgst_amount,
    b.sgst_amount,
    b.igst_amount,
    b.total_tax,
    b.created_at,
    comp.id,
    comp.name,
    comp.legal_name,
    comp.gstin,
    comp.pan,
    comp.sac_no,
    comp.state_code,
    comp.st_category,
    comp.address_line1,
    comp.address_line2,
    comp.city,
    comp.state,
    comp.pincode,
    comp.phone,
    comp.email,
    comp.logo_path
  FROM billing.bills b
  LEFT JOIN master.customers c ON c.id = b.customer_id
  CROSS JOIN LATERAL (
    SELECT * FROM core.companies
    WHERE id = public.current_company_id()
    LIMIT 1
  ) comp
  WHERE b.company_id = public.current_company_id()
  ORDER BY b.bill_no ASC, b.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_ledger_for_company() TO authenticated;

COMMENT ON FUNCTION public.list_ledger_for_company()
  IS 'M12 / TAXI-1201 — every bill in the caller company with the
      customer name joined + the current company row repeated on each
      row. Used by the Ledger Book page; the SPA applies a
      numeric-tail bill-number range filter client-side.';
