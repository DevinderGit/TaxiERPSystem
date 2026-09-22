-- TAXI-104 — Create operations.duty_slips, billing.bills,
-- billing.bill_duty_slips + partial unique index per System Design
-- §4.7, §4.8.

-- ============================================================================
-- 1. operations.duty_slips — atomic unit of operational data
-- ============================================================================
CREATE TABLE operations.duty_slips (
  id                    bigserial    PRIMARY KEY,
  company_id            bigint       NOT NULL REFERENCES core.companies(id),
  duty_slip_no          text         NOT NULL,  -- assigned by trg_duty_slip_no (TAXI-107)
  customer_id           bigint       NOT NULL REFERENCES master.customers(id),
  vehicle_id            bigint       NOT NULL REFERENCES master.vehicles(id),
  rate_id               bigint       REFERENCES master.rates(id),   -- NULL for duty_type='flexible'
  duty_type             duty_type    NOT NULL,
  booking_date          date         NOT NULL,
  booking_ref           text,                     -- customer's PO / booking number
  guest_name            text,
  guest_phone           text,
  pickup_location       text,
  drop_location         text,
  duty_start_dt         timestamptz  NOT NULL,
  duty_end_dt           timestamptz,
  closing_dt            timestamptz,              -- when vehicle returned
  opening_km            numeric(10, 2),
  closing_km            numeric(10, 2),
  total_km              numeric(10, 2) GENERATED ALWAYS AS (closing_km - opening_km) STORED,
  total_hours           numeric(10, 2),          -- computed at save time
  base_amount           numeric(12, 2) NOT NULL DEFAULT 0,
  extra_km_amount       numeric(12, 2) DEFAULT 0,
  extra_hour_amount     numeric(12, 2) DEFAULT 0,
  night_halt_amount     numeric(12, 2) DEFAULT 0,
  driver_allowance      numeric(12, 2) DEFAULT 0,
  other_charges         numeric(12, 2) DEFAULT 0,
  other_charges_remarks text,
  total_amount          numeric(12, 2) NOT NULL,
  custom_rate           numeric(12, 2),          -- only for duty_type='flexible'
  custom_rate_remarks   text,
  driver_name           text,
  driver_phone          text,
  status                text         NOT NULL DEFAULT 'open',  -- open / closed / billed / cancelled
  bill_id               bigint,                                  -- soft reference; FK + set-by-RPC in M9
  created_by            uuid         REFERENCES core.user_profiles(id),
  created_at            timestamptz  DEFAULT now(),
  updated_at            timestamptz  DEFAULT now(),
  UNIQUE(company_id, duty_slip_no)
);

CREATE INDEX idx_duty_slips_customer ON operations.duty_slips(company_id, customer_id);
CREATE INDEX idx_duty_slips_vehicle  ON operations.duty_slips(company_id, vehicle_id);
CREATE INDEX idx_duty_slips_status   ON operations.duty_slips(company_id, status, booking_date);

CREATE TRIGGER trg_duty_slips_updated_at
BEFORE UPDATE ON operations.duty_slips
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 2. Partial unique index — at most one active bill-link per slip
-- ============================================================================
-- A duty slip can be on exactly one non-cancelled bill. Cancelled duty
-- slips free their bill_id so the slip can be re-billed after the
-- original bill is reversed (per spec §6.4).
CREATE UNIQUE INDEX uq_duty_slip_active_bill
  ON operations.duty_slips(bill_id)
  WHERE bill_id IS NOT NULL AND status <> 'cancelled';

-- ============================================================================
-- 3. billing.bills — numbered invoice
-- ============================================================================
CREATE TABLE billing.bills (
  id              bigserial    PRIMARY KEY,
  company_id      bigint       NOT NULL REFERENCES core.companies(id),
  bill_no         text         NOT NULL,  -- assigned by trg_bill_no (TAXI-902 / M9)
  bill_date       date         NOT NULL DEFAULT CURRENT_DATE,
  customer_id     bigint       NOT NULL REFERENCES master.customers(id),
  gst_config_id   bigint       REFERENCES master.gst_config(id),
  base_amount     numeric(12, 2) NOT NULL DEFAULT 0,  -- sum(duty_slips.base_amount)
  extra_amount    numeric(12, 2) NOT NULL DEFAULT 0,  -- sum(extra_* + night_halt + driver_allowance + other)
  total_before_tax numeric(12, 2) NOT NULL DEFAULT 0,
  cgst_amount     numeric(12, 2) DEFAULT 0,
  sgst_amount     numeric(12, 2) DEFAULT 0,
  igst_amount     numeric(12, 2) DEFAULT 0,
  total_tax       numeric(12, 2) GENERATED ALWAYS AS (cgst_amount + sgst_amount + igst_amount) STORED,
  total_after_tax numeric(12, 2) GENERATED ALWAYS AS (total_before_tax + cgst_amount + sgst_amount + igst_amount) STORED,
  round_off       numeric(12, 2) DEFAULT 0,
  grand_total     numeric(12, 2) NOT NULL,
  remarks         text,
  status          text         NOT NULL DEFAULT 'draft',  -- draft / issued / paid / cancelled / adjusted
  cancelled_at    timestamptz,
  cancelled_by    uuid         REFERENCES core.user_profiles(id),
  cancel_reason   text,
  created_by      uuid         REFERENCES core.user_profiles(id),
  created_at      timestamptz  DEFAULT now(),
  updated_at      timestamptz  DEFAULT now(),
  UNIQUE(company_id, bill_no)
);

CREATE INDEX idx_bills_customer_date ON billing.bills(company_id, customer_id, bill_date);
CREATE INDEX idx_bills_status        ON billing.bills(company_id, status);

CREATE TRIGGER trg_bills_updated_at
BEFORE UPDATE ON billing.bills
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================================
-- 4. billing.bill_duty_slips — bill ↔ duty slip junction
-- ============================================================================
-- ON DELETE RESTRICT on duty_slip_id: a duty slip already on a bill
-- can't be deleted (must be cancelled first via the Change/Cancel Bill
-- page in M10).
-- ON DELETE CASCADE on bill_id: deleting a bill removes its junction rows.
CREATE TABLE billing.bill_duty_slips (
  bill_id         bigint       NOT NULL REFERENCES billing.bills(id) ON DELETE CASCADE,
  duty_slip_id    bigint       NOT NULL REFERENCES operations.duty_slips(id) ON DELETE RESTRICT,
  included_base   numeric(12, 2),  -- snapshot of duty_slip.base_amount at inclusion time
  included_extra  numeric(12, 2),  -- snapshot of duty_slip.extra_* at inclusion time
  included_total  numeric(12, 2),  -- snapshot of duty_slip.total_amount at inclusion time
  PRIMARY KEY (bill_id, duty_slip_id)
);

CREATE INDEX idx_bds_duty_slip ON billing.bill_duty_slips(duty_slip_id);
