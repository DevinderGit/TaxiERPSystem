-- TAXI-105 — Create accounts.ledger_entries, system.audit_log,
-- system.settings per System Design §4.10 and §4.11.
--
-- The audit_log triggers (TAXI-109) and the RLS policies that block
-- direct writes to audit_log (TAXI-110) arrive in later tickets.
-- For now these tables just need to exist and accept inserts.

-- ============================================================================
-- 1. Enum: ledger_entry_type
-- ============================================================================
CREATE TYPE ledger_entry_type AS ENUM (
  'sale',             -- credit sale when bill is issued (debit customer)
  'receipt',          -- money received from customer (credit customer)
  'payment',          -- money paid to vendor / driver (debit expense)
  'adjustment',       -- manual adjustment by accountant
  'opening_balance'   -- period-start balance
);

-- ============================================================================
-- 2. accounts.ledger_entries — single source of financial truth
-- ============================================================================
CREATE TABLE accounts.ledger_entries (
  id                  bigserial    PRIMARY KEY,
  company_id          bigint       NOT NULL REFERENCES core.companies(id),
  entry_date          date         NOT NULL DEFAULT CURRENT_DATE,
  entry_type          ledger_entry_type NOT NULL,
  customer_id         bigint       REFERENCES master.customers(id),
  linked_bill_id      bigint       REFERENCES billing.bills(id),
  linked_duty_slip_id bigint       REFERENCES operations.duty_slips(id),
  debit_amount        numeric(12, 2) DEFAULT 0,  -- increase in receivable / expense
  credit_amount       numeric(12, 2) DEFAULT 0,  -- decrease in receivable / increase in income
  narration           text         NOT NULL,
  payment_mode        text,                       -- cash / cheque / upi / bank
  reference_no        text,
  created_by          uuid         REFERENCES core.user_profiles(id),
  created_at          timestamptz  DEFAULT now(),
  updated_at          timestamptz  DEFAULT now()
);

CREATE INDEX idx_ledger_company_date ON accounts.ledger_entries(company_id, entry_date);
CREATE INDEX idx_ledger_customer     ON accounts.ledger_entries(company_id, customer_id);
CREATE INDEX idx_ledger_bill         ON accounts.ledger_entries(company_id, linked_bill_id);

CREATE TRIGGER trg_ledger_entries_updated_at
BEFORE UPDATE ON accounts.ledger_entries
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 3. system.audit_log — append-only JSONB snapshots
-- ============================================================================
-- No updated_at — this table is append-only. The audit trigger
-- (system.fn_audit_row, TAXI-109) is the only writer; RLS policy
-- (TAXI-110) denies all client writes.
CREATE TABLE system.audit_log (
  id          bigserial    PRIMARY KEY,
  company_id  bigint       NOT NULL,
  table_name  text         NOT NULL,
  record_id   bigint       NOT NULL,
  action      text         NOT NULL,    -- INSERT / UPDATE / DELETE
  old_row     jsonb,
  new_row     jsonb,
  changed_by  uuid         REFERENCES core.user_profiles(id),
  changed_at  timestamptz  DEFAULT now()
);

CREATE INDEX idx_audit_company_table ON system.audit_log(company_id, table_name, changed_at);

-- ============================================================================
-- 4. system.settings — per-company key/value config
-- ============================================================================
CREATE TABLE system.settings (
  id           bigserial    PRIMARY KEY,
  company_id   bigint       NOT NULL REFERENCES core.companies(id),
  setting_key  text         NOT NULL,
  setting_value text,
  data_type    text         DEFAULT 'string',   -- string | number | boolean | json
  updated_at   timestamptz  DEFAULT now(),
  UNIQUE(company_id, setting_key)
);

CREATE TRIGGER trg_settings_updated_at
BEFORE UPDATE ON system.settings
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();
