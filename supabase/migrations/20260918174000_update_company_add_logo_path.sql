-- TAXI-302 — Extend public.update_company() to accept p_logo_path.
--
-- Postgres refuses CREATE OR REPLACE when the argument count differs,
-- so we drop and re-create. Same NULLIF/COALESCE pattern as the other
-- columns so a NULL or empty arg preserves the existing logo_path.
--
-- The drop is scoped to the exact 12-arg signature from TAXI-301 so we
-- don't accidentally drop future overloads.

DROP FUNCTION IF EXISTS public.update_company(
  text, text, text, text, text, text, text, text, text, text, text, text
);

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
  p_email         text DEFAULT NULL,
  p_logo_path     text DEFAULT NULL
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
         email         = COALESCE(NULLIF(p_email,         ''), email),
         logo_path     = COALESCE(NULLIF(p_logo_path,     ''), logo_path)
   WHERE id = v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_company(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
