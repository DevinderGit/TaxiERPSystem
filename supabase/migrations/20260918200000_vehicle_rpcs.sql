-- TAXI-403 — Public-schema RPCs for Vehicle CRUD.
--
-- Same PostgREST custom-schema workaround as the other M2/M3/M4 pages.
-- RLS on master.vehicles (from TAXI-110) still applies — write_requires_operator
-- (owner + operator only) is enforced at the table level, no role check
-- needed inside these RPCs.
--
-- add / update translate the unique-constraint violation on
-- (company_id, registration_no) into a friendlier message.
-- delete translates the FK violation from operations.duty_slips.vehicle_id
-- into a friendlier count-based message.

-- ============================================================================
-- 1. list_vehicles_for_company — read
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_vehicles_for_company()
RETURNS TABLE (
  id                 bigint,
  registration_no    text,
  vehicle_group_id   bigint,
  vehicle_group_name text,
  vehicle_type_id    bigint,
  vehicle_type_name  text,
  make               text,
  model              text,
  year               integer,
  color              text,
  chassis_no         text,
  engine_no          text,
  rc_expiry          date,
  insurance_no       text,
  insurance_expiry   date,
  permit_no          text,
  permit_expiry      date,
  is_active          boolean,
  notes              text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
  SELECT
    v.id, v.registration_no,
    v.vehicle_group_id, vg.name,
    v.vehicle_type_id,  vt.name,
    v.make, v.model, v.year, v.color,
    v.chassis_no, v.engine_no,
    v.rc_expiry, v.insurance_no, v.insurance_expiry,
    v.permit_no, v.permit_expiry,
    v.is_active, v.notes
  FROM master.vehicles v
  LEFT JOIN master.vehicle_groups vg ON vg.id = v.vehicle_group_id
  LEFT JOIN master.vehicle_types  vt ON vt.id = v.vehicle_type_id
  WHERE v.company_id = public.current_company_id()
  ORDER BY v.registration_no;
$$;

GRANT EXECUTE ON FUNCTION public.list_vehicles_for_company() TO authenticated;

-- ============================================================================
-- 2. add_vehicle — write (insert)
-- ============================================================================
-- 16 params. Postgres reserves `model` as a non-reserved word but it's a
-- common enough name to be ambiguous in some contexts; we use `p_vehicle_model`
-- at the parameter layer to avoid shadowing the column name inside the body.

CREATE OR REPLACE FUNCTION public.add_vehicle(
  p_registration_no    text,
  p_vehicle_group_id   bigint,
  p_vehicle_type_id    bigint,
  p_make               text             DEFAULT NULL,
  p_vehicle_model      text             DEFAULT NULL,
  p_year               integer          DEFAULT NULL,
  p_color              text             DEFAULT NULL,
  p_chassis_no         text             DEFAULT NULL,
  p_engine_no          text             DEFAULT NULL,
  p_rc_expiry          date             DEFAULT NULL,
  p_insurance_no       text             DEFAULT NULL,
  p_insurance_expiry   date             DEFAULT NULL,
  p_permit_no          text             DEFAULT NULL,
  p_permit_expiry      date             DEFAULT NULL,
  p_is_active          boolean          DEFAULT true,
  p_notes              text             DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_registration_no IS NULL OR btrim(p_registration_no) = '' THEN
    RAISE EXCEPTION 'Registration number is required.'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO master.vehicles (
      company_id, registration_no, vehicle_group_id, vehicle_type_id,
      make, model, year, color, chassis_no, engine_no,
      rc_expiry, insurance_no, insurance_expiry, permit_no, permit_expiry,
      is_active, notes
    ) VALUES (
      public.current_company_id(), btrim(p_registration_no),
      p_vehicle_group_id, p_vehicle_type_id,
      p_make, p_vehicle_model, p_year, p_color, p_chassis_no, p_engine_no,
      p_rc_expiry, p_insurance_no, p_insurance_expiry, p_permit_no, p_permit_expiry,
      COALESCE(p_is_active, true), p_notes
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Registration number already exists.'
        USING ERRCODE = '23505';
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'Invalid vehicle group or type.'
        USING ERRCODE = '23503';
  END;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_vehicle(
  text, bigint, bigint, text, text, integer, text, text, text,
  date, text, date, text, date, boolean, text
) TO authenticated;

-- ============================================================================
-- 3. update_vehicle — write (update)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_vehicle(
  p_id                 bigint,
  p_registration_no    text    DEFAULT NULL,
  p_vehicle_group_id   bigint  DEFAULT NULL,
  p_vehicle_type_id    bigint  DEFAULT NULL,
  p_make               text    DEFAULT NULL,
  p_vehicle_model      text    DEFAULT NULL,
  p_year               integer DEFAULT NULL,
  p_color              text    DEFAULT NULL,
  p_chassis_no         text    DEFAULT NULL,
  p_engine_no          text    DEFAULT NULL,
  p_rc_expiry          date    DEFAULT NULL,
  p_insurance_no       text    DEFAULT NULL,
  p_insurance_expiry   date    DEFAULT NULL,
  p_permit_no          text    DEFAULT NULL,
  p_permit_expiry      date    DEFAULT NULL,
  p_is_active          boolean DEFAULT NULL,
  p_notes              text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
BEGIN
  BEGIN
    UPDATE master.vehicles
       SET registration_no  = COALESCE(NULLIF(p_registration_no,  ''), registration_no),
           vehicle_group_id = COALESCE(p_vehicle_group_id, vehicle_group_id),
           vehicle_type_id  = COALESCE(p_vehicle_type_id,  vehicle_type_id),
           make             = COALESCE(NULLIF(p_make,           ''), make),
           model            = COALESCE(NULLIF(p_vehicle_model,  ''), model),
           year             = COALESCE(p_year,              year),
           color            = COALESCE(NULLIF(p_color,          ''), color),
           chassis_no       = COALESCE(NULLIF(p_chassis_no,     ''), chassis_no),
           engine_no        = COALESCE(NULLIF(p_engine_no,      ''), engine_no),
           rc_expiry        = COALESCE(p_rc_expiry,         rc_expiry),
           insurance_no     = COALESCE(NULLIF(p_insurance_no,   ''), insurance_no),
           insurance_expiry = COALESCE(p_insurance_expiry,  insurance_expiry),
           permit_no        = COALESCE(NULLIF(p_permit_no,      ''), permit_no),
           permit_expiry    = COALESCE(p_permit_expiry,     permit_expiry),
           is_active        = COALESCE(p_is_active,         is_active),
           notes            = COALESCE(NULLIF(p_notes,          ''), notes)
     WHERE id = p_id
       AND company_id = public.current_company_id();
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Registration number already exists.'
        USING ERRCODE = '23505';
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'Invalid vehicle group or type.'
        USING ERRCODE = '23503';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_vehicle(
  bigint, text, bigint, bigint, text, text, integer, text, text, text,
  date, text, date, text, date, boolean, text
) TO authenticated;

-- ============================================================================
-- 4. delete_vehicle — write (delete) with FK-aware count
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_vehicle(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations
AS $$
DECLARE
  v_usage_count integer;
BEGIN
  SELECT COUNT(*) INTO v_usage_count
    FROM operations.duty_slips
   WHERE vehicle_id = p_id
     AND company_id = public.current_company_id();

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete: % duty slip(s) reference this vehicle.', v_usage_count
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM master.vehicles
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_vehicle(bigint) TO authenticated;
