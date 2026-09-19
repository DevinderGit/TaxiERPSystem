-- TAXI-602 — Switch master.rates UNIQUE constraint to a partial unique index.
--
-- The original UNIQUE (company_id, customer_id, vehicle_group_id,
-- vehicle_type_id, duty_type, effective_from) blocked the time-travel
-- mechanism in the same-day case: editing a rate that was created today
-- would close the old row (effective_to = yesterday) and INSERT a new
-- row (effective_from = today), and both rows would have the same
-- effective_from, hitting the unique constraint with 23505.
--
-- The standard Postgres fix for time-travel patterns: enforce
-- uniqueness only on the currently-effective row (effective_to IS NULL).
-- Multiple closed rows may share an effective_from; only one current
-- row per combo is allowed.
--
-- This is the established pattern for temporal/versioned tables; it
-- does not affect any other behaviour.

ALTER TABLE master.rates
  DROP CONSTRAINT rates_company_id_customer_id_vehicle_group_id_vehicle_type__key;

CREATE UNIQUE INDEX rates_one_current_per_combo
  ON master.rates (company_id, customer_id, vehicle_group_id, vehicle_type_id, duty_type)
  WHERE effective_to IS NULL;
