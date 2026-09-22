-- TAXI-601 — Public-schema RPC stub for the Rate Management page.
--
-- This ticket plumbs the page + customer picker + filter dropdowns.
-- The full rate CRUD (add / edit / inline cell update) arrives in
-- TAXI-602; time-travel semantics (close old rate, insert new) in
-- TAXI-603; uniqueness validation in TAXI-604; flexible duty type in
-- TAXI-605; integration test in TAXI-606.
--
-- For now we just need a read RPC that returns the rate rows for a
-- given customer so the page can show "no rates yet" or render the
-- matrix placeholder. The columns mirror what TAXI-602 will need.

CREATE OR REPLACE FUNCTION public.list_rates_for_customer(p_customer_id bigint)
RETURNS TABLE (
  id                bigint,
  vehicle_group_id  bigint,
  vehicle_group_name text,
  vehicle_type_id   bigint,
  vehicle_type_name text,
  duty_type         text,
  base_rate         numeric,
  per_km_rate       numeric,
  per_hour_rate     numeric,
  per_day_rate      numeric,
  extra_hour_rate   numeric,
  extra_km_rate     numeric,
  night_halt_rate   numeric,
  driver_allowance  numeric,
  min_charge        numeric,
  effective_from    date,
  effective_to      date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master
AS $$
  SELECT r.id,
         r.vehicle_group_id, vg.name,
         r.vehicle_type_id,  vt.name,
         r.duty_type::text,
         r.base_rate, r.per_km_rate, r.per_hour_rate, r.per_day_rate,
         r.extra_hour_rate, r.extra_km_rate, r.night_halt_rate,
         r.driver_allowance, r.min_charge,
         r.effective_from, r.effective_to
    FROM master.rates r
    LEFT JOIN master.vehicle_groups vg ON vg.id = r.vehicle_group_id
    LEFT JOIN master.vehicle_types  vt ON vt.id = r.vehicle_type_id
   WHERE r.company_id = public.current_company_id()
     AND r.customer_id = p_customer_id
   ORDER BY r.effective_from DESC, r.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_rates_for_customer(bigint) TO authenticated;
