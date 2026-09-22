-- TAXI-402 — Public-schema RPCs for Vehicle Group + Vehicle Type CRUD.
--
-- Same PostgREST custom-schema workaround as the other M2/M3 pages:
-- core/master schemas aren't reachable via supabase.from(), so every
-- read/write goes through SECURITY DEFINER RPCs in the public schema.
-- The underlying RLS policies from TAXI-110 still apply — these RPCs
-- just give PostgREST a visible surface.
--
-- write_requires_operator (owner + operator) is enforced by RLS on the
-- tables themselves, so the RPCs don't need to repeat the check.
-- Delete RPCs add a defensive FK-usage check that returns a friendlier
-- error than the raw FK violation you'd get from a naive DELETE.

-- ============================================================================
-- 1. Read helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_vehicle_groups_for_company()
RETURNS TABLE (
  id            bigint,
  name          text,
  display_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master
AS $$
  SELECT vg.id, vg.name, vg.display_order
    FROM master.vehicle_groups vg
   WHERE vg.company_id = public.current_company_id()
   ORDER BY vg.display_order NULLS LAST, vg.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_vehicle_groups_for_company() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_vehicle_types_for_company()
RETURNS TABLE (
  id   bigint,
  name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master
AS $$
  SELECT vt.id, vt.name
    FROM master.vehicle_types vt
   WHERE vt.company_id = public.current_company_id()
   ORDER BY vt.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_vehicle_types_for_company() TO authenticated;

-- ============================================================================
-- 2. Write helpers — Vehicle Groups
-- ============================================================================
-- Both write paths translate the raw unique-constraint violation
-- (Postgres SQLSTATE 23505) into a friendlier "Group name already exists".
-- The conversion lets the SPA show a clean inline error without parsing
-- Postgres' internal error format.

CREATE OR REPLACE FUNCTION public.add_vehicle_group(
  p_name          text,
  p_display_order integer DEFAULT NULL
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
    RAISE EXCEPTION 'Group name is required.'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO master.vehicle_groups (company_id, name, display_order)
    VALUES (public.current_company_id(), btrim(p_name), p_display_order)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Group name already exists.'
        USING ERRCODE = '23505';
  END;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_vehicle_group(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_vehicle_group(
  p_id            bigint,
  p_name          text DEFAULT NULL,
  p_display_order integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
BEGIN
  BEGIN
    UPDATE master.vehicle_groups
       SET name          = COALESCE(NULLIF(p_name,          ''), name),
           display_order = COALESCE(p_display_order, display_order)
     WHERE id = p_id
       AND company_id = public.current_company_id();
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Group name already exists.'
        USING ERRCODE = '23505';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_vehicle_group(bigint, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_vehicle_group(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_usage_count integer;
BEGIN
  SELECT COUNT(*) INTO v_usage_count
    FROM master.vehicles
   WHERE vehicle_group_id = p_id
     AND company_id = public.current_company_id();

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete: % vehicle(s) use this group.', v_usage_count
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM master.vehicle_groups
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_vehicle_group(bigint) TO authenticated;

-- ============================================================================
-- 3. Write helpers — Vehicle Types
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_vehicle_type(p_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Type name is required.'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO master.vehicle_types (company_id, name)
    VALUES (public.current_company_id(), btrim(p_name))
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Type name already exists.'
        USING ERRCODE = '23505';
  END;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_vehicle_type(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_vehicle_type(
  p_id   bigint,
  p_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
BEGIN
  BEGIN
    UPDATE master.vehicle_types
       SET name = COALESCE(NULLIF(p_name, ''), name)
     WHERE id = p_id
       AND company_id = public.current_company_id();
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Type name already exists.'
        USING ERRCODE = '23505';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_vehicle_type(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_vehicle_type(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_usage_count integer;
BEGIN
  SELECT COUNT(*) INTO v_usage_count
    FROM master.vehicles
   WHERE vehicle_type_id = p_id
     AND company_id = public.current_company_id();

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete: % vehicle(s) use this type.', v_usage_count
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM master.vehicle_types
   WHERE id = p_id
     AND company_id = public.current_company_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_vehicle_type(bigint) TO authenticated;
