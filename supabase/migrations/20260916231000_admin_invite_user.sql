-- TAXI-205 — Owner-only invite RPC for the User Management page.
--
-- The browser cannot call GoTrue's admin.create_user() with the anon key
-- (that would leak the service role). This RPC runs SECURITY DEFINER
-- as the function owner, which (in self-hosted Supabase) is `postgres`
-- and therefore has full access to the auth schema.
--
-- The function:
--   1. Verifies the caller is authenticated AND has role = 'owner'.
--   2. Reads the caller's company_id from the JWT claim.
--   3. INSERTs into auth.users (the AFTER INSERT trigger from TAXI-101
--      creates a matching core.user_profiles row in the right company).
--   4. Overrides the auto-created profile's role with what the owner
--      requested (the trigger defaults to 'viewer').
--   5. Returns the new user_id.
--
-- Real invite emails would be sent by GoTrue's mailer for new users
-- without email_confirmed_at. Local dev prints them via Mailpit
-- (port 54324).

CREATE OR REPLACE FUNCTION public.admin_invite_user(
  p_email       text,
  p_role        user_role DEFAULT 'viewer',
  p_full_name   text      DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, core
AS $$
DECLARE
  v_caller_role     text;
  v_company_id      bigint;
  v_user_id         uuid;
  v_full_name       text;
BEGIN
  -- 1. Caller check.
  v_caller_role := public.current_user_role();
  v_company_id  := public.current_company_id();

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated. Sign in and try again.';
  END IF;
  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can invite users. (your role: %)', v_caller_role
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- 2. Block duplicate invites.
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'A user with that email already exists.';
  END IF;

  -- 3. Default full_name to the email local-part if not supplied.
  v_full_name := COALESCE(NULLIF(btrim(p_full_name), ''), split_part(p_email, '@', 1));

  -- 4. Insert into auth.users. The trigger from TAXI-101 auto-creates
  --    core.user_profiles (company_id, role='viewer', full_name='');
  --    the SECURITY DEFINER grants us the cross-schema inserts the
  --    trigger function needs.
  v_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid, v_user_id, 'authenticated', 'authenticated',
    p_email, '',
    NULL, jsonb_build_object('full_name', v_full_name),
    now(), now(),
    '', '', '', ''
  );

  -- 5. Override the auto-created profile's role + full_name.
  UPDATE core.user_profiles
     SET role      = p_role,
         full_name = v_full_name,
         is_active = true
   WHERE id = v_user_id;

  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, user_role, text) TO authenticated;
