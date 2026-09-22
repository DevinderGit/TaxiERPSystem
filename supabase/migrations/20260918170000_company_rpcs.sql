-- TAXI-301 — Public-schema RPCs for the Company Detail page.
--
-- Same PostgREST-custom-schema workaround as TAXI-205: PostgREST 16.2 in
-- Supabase CLI 2.117.0 won't expose `core` / `master` / etc. via
-- `db.schemas` in config.toml (introspection keeps ignoring the env var
-- list beyond the public schema). So the SPA cannot read or update
-- `core.companies` directly. Until that's resolved in M14 hardening,
-- we expose two SECURITY DEFINER RPCs in the public schema.
--
-- The underlying table is still RLS-protected (see TAXI-110's
-- tenant_isolation + update_requires_operator_or_accountant policies
-- on core.companies). These RPCs just provide a PostgREST-visible
-- surface for the SPA. get_company() reads; update_company(...) writes.
--
-- update_company() intentionally has NO role check in this ticket —
-- the page-level role gate (owner/operator can save; accountant/viewer
-- cannot) lands in TAXI-303. RLS already blocks viewer writes at the
-- table level, so a stray call from a viewer cannot mutate the row.

-- ============================================================================
-- 1. get_company — read-side helper for the Company Detail form
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_company()
RETURNS TABLE (
  id             bigint,
  name           text,
  legal_name     text,
  owner_name     text,
  gstin          text,
  pan            text,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  pincode        text,
  phone          text,
  email          text,
  logo_path      text,
  is_active      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, core
AS $$
  SELECT
    c.id, c.name, c.legal_name, c.owner_name, c.gstin, c.pan,
    c.address_line1, c.address_line2, c.city, c.state, c.pincode,
    c.phone, c.email, c.logo_path, c.is_active
  FROM core.companies c
  WHERE c.id = public.current_company_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_company() TO authenticated;

-- ============================================================================
-- 2. update_company — write-side helper for the Company Detail form
-- ============================================================================
-- All editable columns are passed as nullable text. A NULL or empty
-- string means "leave the existing value alone" (NULLIF → NULL →
-- COALESCE picks the OLD value). This lets the SPA send only the
-- fields the user actually changed without first having to fetch and
-- re-send the whole row.
--
-- logo_path is intentionally not accepted here — TAXI-302 adds a
-- dedicated storage flow that will set logo_path via Storage's
-- own update path (or a follow-up RPC).
CREATE OR REPLACE FUNCTION public.update_company(
  p_name          text DEFAULT NULL,
  p_legal_name    text DEFAULT NULL,
  p_owner_name    text DEFAULT NULL,
  p_gstin         text DEFAULT NULL,
  p_pan           text DEFAULT NULL,
  p_address_line1 text DEFAULT NULL,
  p_address_line2 text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_state         text DEFAULT NULL,
  p_pincode       text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_email         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
  v_company_id bigint;
BEGIN
  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company context for the current user (company_id claim missing).'
      USING ERRCODE = '42501';
  END IF;

  UPDATE core.companies
     SET name          = COALESCE(NULLIF(p_name,          ''), name),
         legal_name    = COALESCE(NULLIF(p_legal_name,    ''), legal_name),
         owner_name    = COALESCE(NULLIF(p_owner_name,    ''), owner_name),
         gstin         = COALESCE(NULLIF(p_gstin,         ''), gstin),
         pan           = COALESCE(NULLIF(p_pan,           ''), pan),
         address_line1 = COALESCE(NULLIF(p_address_line1, ''), address_line1),
         address_line2 = COALESCE(NULLIF(p_address_line2, ''), address_line2),
         city          = COALESCE(NULLIF(p_city,          ''), city),
         state         = COALESCE(NULLIF(p_state,         ''), state),
         pincode       = COALESCE(NULLIF(p_pincode,       ''), pincode),
         phone         = COALESCE(NULLIF(p_phone,         ''), phone),
         email         = COALESCE(NULLIF(p_email,         ''), email)
   WHERE id = v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_company(
  text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
