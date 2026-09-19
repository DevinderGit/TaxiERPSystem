-- TAXI-501 — Public-schema RPCs for Customer CRUD.
--
-- Same PostgREST custom-schema workaround as the other M2/M3/M4 pages.
-- RLS on master.customers (from TAXI-110) still applies —
-- write_requires_operator (owner + operator only) at the table level.
--
-- Conditional validation (company vs personal client_type) lives in the
-- SPA via Zod (TAXI-502). This RPC accepts whatever the SPA sends and
-- stores it; the DB enforces NOT NULL on name/phone and the client_type
-- enum constraint.

-- ============================================================================
-- 1. list_customers_for_company — read
-- ============================================================================
-- Returns the columns the SPA's list + filter UI needs. The inter/intra
-- state flag lives on master.gst_config (per TAXI-106), not on the customer
-- row — M7 will surface it via the GST config UI, not here.

CREATE OR REPLACE FUNCTION public.list_customers_for_company()
RETURNS TABLE (
  id            bigint,
  name          text,
  company_name  text,
  gstin         text,
  state         text,
  phone         text,
  client_type   text,
  is_active     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master
AS $$
  SELECT c.id, c.name, c.company_name, c.gstin, c.state, c.phone,
         c.client_type::text, c.is_active
    FROM master.customers c
   WHERE c.company_id = public.current_company_id()
   ORDER BY c.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_customers_for_company() TO authenticated;

-- ============================================================================
-- 2. add_customer — write (insert)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_customer(
  p_client_type   text,
  p_name          text,
  p_company_name  text             DEFAULT NULL,
  p_gstin         text             DEFAULT NULL,
  p_address_line1 text             DEFAULT NULL,
  p_address_line2 text             DEFAULT NULL,
  p_city          text             DEFAULT NULL,
  p_state         text             DEFAULT NULL,
  p_pincode       text             DEFAULT NULL,
  p_phone         text             DEFAULT NULL,
  p_email         text             DEFAULT NULL,
  p_pan           text             DEFAULT NULL,
  p_is_active     boolean          DEFAULT true,
  p_notes         text             DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_client_type NOT IN ('company', 'personal') THEN
    RAISE EXCEPTION 'Client type must be ''company'' or ''personal''.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO master.customers (
    company_id, client_type, name, company_name, gstin,
    address_line1, address_line2, city, state, pincode,
    phone, email, pan, is_active, notes
  ) VALUES (
    public.current_company_id(), p_client_type::client_type,
    btrim(p_name), NULLIF(p_company_name, ''), NULLIF(p_gstin, ''),
    NULLIF(p_address_line1, ''), NULLIF(p_address_line2, ''),
    NULLIF(p_city, ''), NULLIF(p_state, ''), NULLIF(p_pincode, ''),
    btrim(p_phone), NULLIF(p_email, ''), NULLIF(p_pan, ''),
    COALESCE(p_is_active, true), NULLIF(p_notes, '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_customer(
  text, text, text, text, text, text, text, text, text, text,
  text, text, boolean, text
) TO authenticated;

-- ============================================================================
-- 3. update_customer — write (update)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_customer(
  p_id            bigint,
  p_client_type   text    DEFAULT NULL,
  p_name          text    DEFAULT NULL,
  p_company_name  text    DEFAULT NULL,
  p_gstin         text    DEFAULT NULL,
  p_address_line1 text    DEFAULT NULL,
  p_address_line2 text    DEFAULT NULL,
  p_city          text    DEFAULT NULL,
  p_state         text    DEFAULT NULL,
  p_pincode       text    DEFAULT NULL,
  p_phone         text    DEFAULT NULL,
  p_email         text    DEFAULT NULL,
  p_pan           text    DEFAULT NULL,
  p_is_active     boolean DEFAULT NULL,
  p_notes         text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
BEGIN
  IF p_client_type IS NOT NULL AND p_client_type NOT IN ('company', 'personal') THEN
    RAISE EXCEPTION 'Client type must be ''company'' or ''personal''.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE master.customers
     SET client_type   = COALESCE(p_client_type::client_type, client_type),
         name          = COALESCE(NULLIF(p_name, ''), name),
         company_name  = COALESCE(NULLIF(p_company_name, ''), company_name),
         gstin         = COALESCE(NULLIF(p_gstin, ''), gstin),
         address_line1 = COALESCE(NULLIF(p_address_line1, ''), address_line1),
         address_line2 = COALESCE(NULLIF(p_address_line2, ''), address_line2),
         city          = COALESCE(NULLIF(p_city, ''), city),
         state         = COALESCE(NULLIF(p_state, ''), state),
         pincode       = COALESCE(NULLIF(p_pincode, ''), pincode),
         phone         = COALESCE(NULLIF(p_phone, ''), phone),
         email         = COALESCE(NULLIF(p_email, ''), email),
         pan           = COALESCE(NULLIF(p_pan, ''), pan),
         is_active     = COALESCE(p_is_active, is_active),
         notes         = COALESCE(NULLIF(p_notes, ''), notes)
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_customer(
  bigint, text, text, text, text, text, text, text, text, text,
  text, text, text, boolean, text
) TO authenticated;
