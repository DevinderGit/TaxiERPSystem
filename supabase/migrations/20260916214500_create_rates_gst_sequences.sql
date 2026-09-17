-- TAXI-103 — Create master.rates, master.gst_config, master.document_sequences
-- per System Design §4.5, §4.6, §4.9.
--
-- Triggers numbering duty slips, computing GST, and setting is_interstate
-- arrive in TAXI-106..TAXI-108. The is_interstate column exists here but
-- accepts NULL until then; the trigger backfills it from customer.state
-- vs company.state.

-- ============================================================================
-- 1. Enums
-- ============================================================================
CREATE TYPE duty_type AS ENUM (
  'per_km',
  'per_hour',
  'per_day',
  'local_package',
  'outstation',  -- out-of-city fixed or per-km
  'flexible'     -- no rate card; operator types a custom amount per duty slip
);

CREATE TYPE sequence_mode AS ENUM ('auto', 'manual');

-- ============================================================================
-- 2. master.rates — pins (customer, vehicle, duty_type) to a rate card
-- ============================================================================
CREATE TABLE master.rates (
  id                bigserial      PRIMARY KEY,
  company_id        bigint         NOT NULL REFERENCES core.companies(id),
  customer_id       bigint         NOT NULL REFERENCES master.customers(id),
  vehicle_group_id  bigint         REFERENCES master.vehicle_groups(id),
  vehicle_type_id   bigint         REFERENCES master.vehicle_types(id),
  duty_type         duty_type      NOT NULL,
  base_rate         numeric(10, 2) NOT NULL,
  per_km_rate       numeric(10, 2),
  per_hour_rate     numeric(10, 2),
  per_day_rate      numeric(10, 2),
  extra_hour_rate   numeric(10, 2),
  extra_km_rate     numeric(10, 2),
  night_halt_rate   numeric(10, 2),
  driver_allowance  numeric(10, 2),
  min_charge        numeric(10, 2),
  effective_from    date           NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  is_active         boolean        DEFAULT true,
  notes             text,
  created_at        timestamptz    DEFAULT now(),
  updated_at        timestamptz    DEFAULT now(),
  UNIQUE(company_id, customer_id, vehicle_group_id, vehicle_type_id, duty_type, effective_from)
);

CREATE INDEX idx_rates_customer_vehicle
  ON master.rates(company_id, customer_id, vehicle_group_id, vehicle_type_id, duty_type);

CREATE TRIGGER trg_rates_updated_at
BEFORE UPDATE ON master.rates
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 3. master.gst_config — per-customer GST rate card
-- ============================================================================
CREATE TABLE master.gst_config (
  id             bigserial    PRIMARY KEY,
  company_id     bigint       NOT NULL REFERENCES core.companies(id),
  customer_id    bigint       NOT NULL REFERENCES master.customers(id),
  -- is_interstate is auto-derived by fn_set_interstate (TAXI-106) by comparing
  -- customer.state to company.state. NULL until that trigger is installed.
  is_interstate  boolean,
  igst_rate      numeric(5, 2),
  cgst_rate      numeric(5, 2),
  sgst_rate      numeric(5, 2),
  effective_from date         NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  is_active      boolean      DEFAULT true,
  created_at     timestamptz  DEFAULT now(),
  updated_at     timestamptz  DEFAULT now(),
  UNIQUE(company_id, customer_id, effective_from)
);

CREATE INDEX idx_gst_config_customer ON master.gst_config(company_id, customer_id);

CREATE TRIGGER trg_gst_config_updated_at
BEFORE UPDATE ON master.gst_config
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 4. master.document_sequences — visible numbering for duty slips, bills, etc.
-- ============================================================================
CREATE TABLE master.document_sequences (
  id             bigserial      PRIMARY KEY,
  company_id     bigint         NOT NULL REFERENCES core.companies(id),
  sequence_key   text           NOT NULL,    -- 'duty_slip' | 'bill' | future types
  prefix         text,                         -- e.g. "DS-" / "BILL-"
  suffix         text,
  next_value     integer        NOT NULL DEFAULT 1,
  mode           sequence_mode  NOT NULL DEFAULT 'auto',
  padding_length integer        NOT NULL DEFAULT 4,  -- zero-pad width
  is_active      boolean        DEFAULT true,
  created_at     timestamptz    DEFAULT now(),
  updated_at     timestamptz    DEFAULT now(),
  UNIQUE(company_id, sequence_key)
);

CREATE TRIGGER trg_document_sequences_updated_at
BEFORE UPDATE ON master.document_sequences
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();
