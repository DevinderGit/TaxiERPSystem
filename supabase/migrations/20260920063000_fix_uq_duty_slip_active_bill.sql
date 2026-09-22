-- M9 — drop the M1 partial unique index on operations.duty_slips.
-- M1's `uq_duty_slip_active_bill` was created on (bill_id), which
-- enforced "one slip per bill" — the OPPOSITE of the intended
-- semantic (one bill per slip). M9's generate_bill RPC needs to
-- assign the same bill_id to many slips; the index blocked that.
--
-- "One bill per slip" is already enforced by the data model:
-- `operations.duty_slips.bill_id` is a single nullable column —
-- a slip can only hold one bill_id at a time. The junction table
-- `billing.bill_duty_slips` has (bill_id, duty_slip_id) as its PK
-- (so the same bill can hold many slips). No extra index needed.

SET search_path TO public, operations;

DROP INDEX IF EXISTS operations.uq_duty_slip_active_bill;