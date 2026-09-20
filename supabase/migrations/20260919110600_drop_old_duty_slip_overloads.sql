-- Drop the pre-existing overloads of create_duty_slip / update_duty_slip
-- (without p_custom_rate_items) so PostgREST can disambiguate to the
-- new 22-arg / 23-arg versions from migration 20260919110500.

DROP FUNCTION IF EXISTS public.create_duty_slip(
  bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text
);

DROP FUNCTION IF EXISTS public.update_duty_slip(
  bigint, bigint, bigint, text, date, timestamptz, timestamptz,
  text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, text, text
);
