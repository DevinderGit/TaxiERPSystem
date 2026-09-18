-- TAXI-404 — Seed the missing `bill` document sequence.
--
-- TAXI-103 created master.document_sequences but didn't seed any rows.
-- TAXI-107's fn_assign_duty_slip_no migration seeded only the
-- `duty_slip` row. The `bill` row was expected for the Document No.
-- Control tab (TAXI-404 MTP step 1: "table shows the two default rows:
-- duty_slip and bill").
--
-- This migration seeds the bill row idempotently so re-running
-- supabase db reset stays clean. Once a bill-issuing RPC is added
-- (M9 / generate_bill), this row will be the authoritative source for
-- bill numbering, just as duty_slip's row drives the duty-slip
-- numbering trigger.

INSERT INTO master.document_sequences (
  company_id, sequence_key, prefix, suffix, next_value,
  padding_length, mode, is_active
)
SELECT
  c.id, 'bill', 'BL-', NULL, 1, 4, 'auto', true
FROM core.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM master.document_sequences ds
   WHERE ds.company_id = c.id
     AND ds.sequence_key = 'bill'
);
