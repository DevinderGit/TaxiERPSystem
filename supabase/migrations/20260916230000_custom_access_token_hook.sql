-- TAXI-202 — Supabase Auth hook to inject core.user_profiles into JWT claims.
--
-- Configured in supabase/config.toml under [auth.hook.custom_access_token].
-- The function signature MUST be `function (event jsonb) RETURNS jsonb`.
-- It runs STABLE SECURITY DEFINER so it can read core.user_profiles regardless
-- of the calling role (GoTrue invokes it as supabase_auth_admin).
--
-- The function returns the same event with `event.claims` mutated to include:
--   * company_id (bigint as text)
--   * user_role  (text — "owner" | "operator" | "accountant" | "viewer")
-- If the user has no profile row (e.g. the auth trigger hasn't fired yet),
-- the event is returned unchanged so GoTrue can still issue a token; the
-- user will simply lack tenant/role claims until a profile is created.
--
-- Schema: the function lives in `public` because Supabase's hook protocol
-- expects `<schema>.<hook_name>` and `public` is the schema GoTrue
-- has access to.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
  v_user_id     uuid;
  v_company_id  bigint;
  v_user_role   text;
  v_claims      jsonb;
BEGIN
  -- Extract the authenticated user id from the event.
  v_user_id := (event ->> 'user_id')::uuid;

  IF v_user_id IS NULL THEN
    RETURN event;  -- anonymous (refresh of a deleted user, etc.) — pass through
  END IF;

  -- Look up the user's tenant + role. The auth.users INSERT trigger from
  -- TAXI-101 should have created a matching core.user_profiles row.
  SELECT company_id, role::text
    INTO v_company_id, v_user_role
    FROM core.user_profiles
    WHERE id = v_user_id;

  IF v_company_id IS NULL THEN
    -- No profile yet — return event unchanged. The RLS policies in TAXI-110
    -- will treat this user as having no tenant access, which is safe.
    RETURN event;
  END IF;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_claims := jsonb_set(v_claims, '{company_id}', to_jsonb(v_company_id::text), true);
  v_claims := jsonb_set(v_claims, '{user_role}',  to_jsonb(v_user_role),           true);

  RETURN jsonb_set(event, '{claims}', v_claims, true);
END;
$$;

-- GoTrue runs the hook as `supabase_auth_admin`. It needs EXECUTE on the
-- function and SELECT on core.user_profiles.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON core.user_profiles TO supabase_auth_admin;
