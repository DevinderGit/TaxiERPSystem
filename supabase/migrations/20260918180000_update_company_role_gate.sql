-- TAXI-303 — Add role gate to public.update_company().
--
-- Spec: "Only owner/operator can edit" the company record.
--
-- Until now, the RLS policy on core.companies (update_requires_operator_or_accountant,
-- from TAXI-110) let owner + operator + accountant UPDATE. The SPA never surfaces
-- the Save button to accountant, but a determined accountant could still bypass
-- the UI and hit the public-schema RPC directly. This migration closes that gap:
-- the RPC now rejects any caller whose role is not 'owner' or 'operator'.
--
-- Same DROP-and-recreate dance as TAXI-302 because Postgres refuses
-- CREATE OR REPLACE when the function body changes shape. Scoped drop
-- pins the 13-arg signature from TAXI-302 so future overloads are safe.

DROP FUNCTION IF EXISTS public.update_company(
  text, text, text, text, text, text, text, text, text, text, text, text, text
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
  v_caller_role text;
BEGIN
  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company context for the current user (company_id claim missing).'
      USING ERRCODE = '42501';
  END IF;

  v_caller_role := public.current_user_role();
  IF v_caller_role IS DISTINCT FROM 'owner' AND v_caller_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can edit the company record (your role: %).',
      COALESCE(v_caller_role, 'unknown')
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
