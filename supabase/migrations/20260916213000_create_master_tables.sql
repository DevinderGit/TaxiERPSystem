-- TAXI-102 — Create master.customers, master.vehicle_groups,
-- master.vehicle_types, master.vehicles per System Design §4.3 + §4.4.
--
-- All tables tenant-scoped via company_id. The master.* schema is the
-- lowest layer; operations/billing/accounts may FK up to it later,
-- never the reverse.

-- ============================================================================
-- 1. Enum: client_type
-- ============================================================================
CREATE TYPE client_type AS ENUM ('company', 'personal');

-- ============================================================================
-- 2. master.customers — B2B and one-time personal clients
-- ============================================================================
CREATE TABLE master.customers (
  id            bigserial    PRIMARY KEY,
  company_id    bigint       NOT NULL REFERENCES core.companies(id),
  client_type   client_type  NOT NULL DEFAULT 'company',
  name          text         NOT NULL,  -- contact for 'company'; full name for 'personal'
  company_name  text,                    -- customer.legal entity name (only for client_type='company')
  gstin         text,                    -- required for B2B; NULL for personal (app-layer check in M5)
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,                    -- drives gst_config lookup
  pincode       text,
  phone         text         NOT NULL,
  email         text,
  pan           text,
  is_active     boolean      DEFAULT true,
  notes         text,
  created_at    timestamptz  DEFAULT now(),
  updated_at    timestamptz  DEFAULT now()
);

CREATE INDEX idx_customers_company_type ON master.customers(company_id, client_type);
CREATE INDEX idx_customers_name ON master.customers(name);

CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON master.customers
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 3. master.vehicle_groups — Sedan / SUV / Tempo / etc. (user-defined)
-- ============================================================================
CREATE TABLE master.vehicle_groups (
  id            bigserial    PRIMARY KEY,
  company_id    bigint       NOT NULL REFERENCES core.companies(id),
  name          text         NOT NULL,    -- e.g. "Sedan"
  description   text,
  display_order int          DEFAULT 0,  -- for sortable UI in M4
  created_at    timestamptz  DEFAULT now(),
  updated_at    timestamptz  DEFAULT now(),
  UNIQUE(company_id, name)
);

CREATE TRIGGER trg_vehicle_groups_updated_at
BEFORE UPDATE ON master.vehicle_groups
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 4. master.vehicle_types — AC / Non-AC / Electric / etc. (user-defined)
-- ============================================================================
CREATE TABLE master.vehicle_types (
  id          bigserial    PRIMARY KEY,
  company_id  bigint       NOT NULL REFERENCES core.companies(id),
  name        text         NOT NULL,    -- e.g. "AC"
  created_at  timestamptz  DEFAULT now(),
  updated_at  timestamptz  DEFAULT now(),
  UNIQUE(company_id, name)
);

CREATE TRIGGER trg_vehicle_types_updated_at
BEFORE UPDATE ON master.vehicle_types
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 5. master.vehicles — the actual cars
-- ============================================================================
CREATE TABLE master.vehicles (
  id               bigserial    PRIMARY KEY,
  company_id       bigint       NOT NULL REFERENCES core.companies(id),
  registration_no  text         NOT NULL,    -- e.g. "DL 01 AB 1234"
  vehicle_group_id bigint       REFERENCES master.vehicle_groups(id),
  vehicle_type_id  bigint       REFERENCES master.vehicle_types(id),
  make             text,
  model            text,
  year             int,
  color            text,
  chassis_no       text,
  engine_no        text,
  rc_expiry        date,
  insurance_no     text,
  insurance_expiry date,
  permit_no        text,
  permit_expiry    date,
  is_active        boolean      DEFAULT true,
  notes            text,
  created_at       timestamptz  DEFAULT now(),
  updated_at       timestamptz  DEFAULT now(),
  UNIQUE(company_id, registration_no)
);

CREATE INDEX idx_vehicles_group ON master.vehicles(company_id, vehicle_group_id);
CREATE INDEX idx_vehicles_type ON master.vehicles(company_id, vehicle_type_id);

CREATE TRIGGER trg_vehicles_updated_at
BEFORE UPDATE ON master.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();
