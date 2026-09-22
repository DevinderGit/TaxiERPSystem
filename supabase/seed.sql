-- M8 verification seed: 4 test users + minimal master data.

-- pgcrypto is required for crypt() / gen_salt() in the user-creation block.
-- The Supabase image installs it in the `extensions` schema, not `public`.
SET search_path TO public, extensions;

-- 1) Taxis (Sedan/AC) for the duty-slip / vehicle list
INSERT INTO master.vehicle_groups (company_id, name, display_order)
  VALUES (1, 'Sedan', 1), (1, 'SUV', 2)
  ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO master.vehicle_types (company_id, name)
  VALUES (1, 'AC'), (1, 'Non-AC')
  ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO master.vehicles (company_id, registration_no, vehicle_group_id, vehicle_type_id, is_active)
  VALUES (1, 'DL 01 TEST 001',
          (SELECT id FROM master.vehicle_groups WHERE company_id = 1 AND name = 'Sedan'),
          (SELECT id FROM master.vehicle_types  WHERE company_id = 1 AND name = 'AC'),
          true)
  ON CONFLICT (company_id, registration_no) DO NOTHING;

-- 2) Customer
INSERT INTO master.customers (company_id, client_type, name, company_name, gstin, state, phone, is_active)
  VALUES (1, 'company', 'Acme MH', 'Acme Pvt Ltd', '27AAAAA0000A1Z5', 'Maharashtra', '+91-9876543210', true)
  ON CONFLICT DO NOTHING;

-- 3) Rate (per duty type, for billing preview)
INSERT INTO master.rates (company_id, customer_id, vehicle_group_id, vehicle_type_id, base_rate, per_km_rate, min_charge)
  VALUES (1,
          (SELECT id FROM master.customers  WHERE company_id = 1 AND name = 'Acme MH'),
          (SELECT id FROM master.vehicle_groups WHERE company_id = 1 AND name = 'Sedan'),
          (SELECT id FROM master.vehicle_types  WHERE company_id = 1 AND name = 'AC'),
          500, 12, 300)
  ON CONFLICT DO NOTHING;

-- 4) GST config (Maharashtra → Delhi = interstate → IGST only)
INSERT INTO master.gst_config (company_id, customer_id, igst_rate, is_active)
  VALUES (1,
          (SELECT id FROM master.customers WHERE company_id = 1 AND name = 'Acme MH'),
          5, true)
  ON CONFLICT DO NOTHING;

-- 5) Test users
DO $$
DECLARE v_uid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'owner-tester@example.com') THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'owner-tester@example.com', crypt('password123', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Owner Tester"}'::jsonb,
            now(), now(), '', '', '', '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'op-tester@example.com') THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'op-tester@example.com', crypt('password123', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Operator Tester"}'::jsonb,
            now(), now(), '', '', '', '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'acct-tester@example.com') THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'acct-tester@example.com', crypt('password123', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Accountant Tester"}'::jsonb,
            now(), now(), '', '', '', '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'viewer-tester@example.com') THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'viewer-tester@example.com', crypt('password123', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Viewer Tester"}'::jsonb,
            now(), now(), '', '', '', '');
  END IF;
END $$;

UPDATE core.user_profiles SET role = 'owner'      WHERE id = (SELECT id FROM auth.users WHERE email = 'owner-tester@example.com');
UPDATE core.user_profiles SET role = 'operator'   WHERE id = (SELECT id FROM auth.users WHERE email = 'op-tester@example.com');
UPDATE core.user_profiles SET role = 'accountant' WHERE id = (SELECT id FROM auth.users WHERE email = 'acct-tester@example.com');
UPDATE core.user_profiles SET role = 'viewer'     WHERE id = (SELECT id FROM auth.users WHERE email = 'viewer-tester@example.com');