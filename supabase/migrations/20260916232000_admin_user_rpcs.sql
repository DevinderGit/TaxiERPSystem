-- TAXI-205 (revision) — Owner-only RPCs for the User Management page.
--
-- At TAXI-205 implementation, we discovered that PostgREST would not
-- expose our custom schemas via `db.schemas` in config.toml (it keeps
-- introspecting only the public schema despite env var
-- `PGRST_DB_SCHEMAS` listing the 8 schemas). As a workaround, every
-- operation the User Management SPA needs goes through an RPC. The
-- underlying tables are still protected by the RLS policies added
-- in TAXI-110 — these RPCs simply provide a PostgREST-exposed
-- surface for the SPA to call.
--
-- All three RPCs are SECURITY DEFINER so they can run as the
-- function owner (which has the privileges to read core.user_profiles
-- regardless of RLS) and validate the caller's role via the JWT
-- claim injected by the auth hook (TAXI-202).
--
-- Schema: public (the only schema PostgREST auto-exposes in this
-- version of Supabase CLI; see worklog entry for the dev-time fix
-- that will move this back to direct PostgREST table access).

-- ============================================================================
-- 1. list_users_for_company — read-side helper for User Management page
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_users_for_company()
RETURNS TABLE (
  id             uuid,
  email          text,
  full_name      text,
  role           user_role,
  is_active      boolean,
  company_id     bigint,
  created_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, core, auth
AS $$
  SELECT
    up.id, au.email::text, up.full_name, up.role,
    up.is_active, up.company_id, up.created_at
  FROM core.user_profiles up
  JOIN auth.users au ON au.id = up.id
  WHERE up.company_id = public.current_company_id()
  ORDER BY au.email NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.list_users_for_company() TO authenticated;

-- ============================================================================
-- 2. update_user_state — owner-only UPDATE on (role, is_active)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_user_state(
  p_user_id    uuid,
  p_role       user_role DEFAULT NULL,
  p_is_active  boolean   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
  v_caller_role    text;
  v_target_company bigint;
BEGIN
  v_caller_role := public.current_user_role();
  IF v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can change user state. (your role: %)', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  -- Verify the target user belongs to the caller's company (otherwise
  -- a malicious owner from company A could promote someone in company B).
  SELECT company_id INTO v_target_company
    FROM core.user_profiles
   WHERE id = p_user_id;
  IF v_target_company IS DISTINCT FROM public.current_company_id() THEN
    RAISE EXCEPTION 'User does not belong to your company.';
  END IF;

  UPDATE core.user_profiles
     SET role      = COALESCE(p_role,     role),
         is_active = COALESCE(p_is_active, is_active),
         updated_at = now()
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_state(uuid, user_role, boolean) TO authenticated;
