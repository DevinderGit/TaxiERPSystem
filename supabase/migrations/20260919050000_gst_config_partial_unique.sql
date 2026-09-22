-- TAXI-701 — Switch master.gst_config UNIQUE constraint to a partial unique index.
--
-- Same fix as TAXI-602 (master.rates): the original UNIQUE
-- (company_id, customer_id, effective_from) blocks the time-travel
-- mechanism in the same-day case. Switching to a partial index that
-- only enforces uniqueness on currently-effective rows (effective_to IS
-- NULL) lets the operator edit a rate the same day it was created.
--
-- This is the same established Postgres pattern for temporal/versioned
-- tables; it does not affect any other behaviour.

ALTER TABLE master.gst_config
  DROP CONSTRAINT gst_config_company_id_customer_id_effective_from_key;

CREATE UNIQUE INDEX gst_config_one_current_per_combo
  ON master.gst_config (company_id, customer_id)
  WHERE effective_to IS NULL;
