-- Drop the old add_rate overload (which placed p_duty_type before p_base_rate
-- and required it as non-null) so PostgREST can unambiguously route to
-- the new add_rate (where p_duty_type is optional and comes after
-- p_base_rate). The previous migration recreated the new body but the
-- old signature still exists as a separate overload.

DROP FUNCTION IF EXISTS public.add_rate(
  bigint, bigint, bigint, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date
);
