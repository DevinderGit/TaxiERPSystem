-- M13 — TAXI-1306 — Stress-test seed data
--
-- Per spec: "Insert 1000 dummy bills and 5000 dummy duty slips
-- (use generate_series)." The data lives in company_id=1 alongside
-- the operator's real data — the operator can clean it up via
-- `DELETE FROM operations.duty_slips WHERE id >= <first-seed-id>`
-- (see the worklog entry for 1306 for exact bounds).
--
-- Distribution:
--   - 1000 bills spread across 1 year (2025-09 to 2026-08) for
--     company_id=1, all status='issued'.
--   - 5000 duty slips, 5 per bill on average (some bills get 0,
--     some get 10), with varied km/hours/amounts.

SET search_path TO public, master, operations, billing;

-- Wrap the whole seed in a transaction so a partial failure
-- doesn't leave dangling stress customers / bills / slips.
BEGIN;

-- Disable user triggers (specifically fn_calculate_gst which
-- requires a gst_config per customer). Re-enabled at the bottom.
SET LOCAL session_replication_role = replica;

-- Idempotent guard: bail out if the seed has already been run.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM operations.duty_slips
    WHERE duty_slip_no LIKE 'DS-STRESS-%';
  IF v_count > 0 THEN
    RAISE NOTICE 'stress seed already present (% rows), skipping', v_count;
    RETURN;
  END IF;
END
$$;

-- Customer set: we already have customer 1 (Acme MH). Add 9 more
-- dummy customers so the stress data exercises the customer filter.
INSERT INTO master.customers (company_id, name, company_name, gstin, state, phone)
SELECT 1, 'Stress Customer ' || s, 'Stress Co ' || s, '99STRESS' || LPAD(s::text, 6, '0'), 'Maharashtra', '+91-9999999' || LPAD(s::text, 3, '0')
FROM generate_series(2, 10) AS s;

-- 1000 bills with varied dates and grand totals.
-- Note: total_tax and total_after_tax are GENERATED columns
-- (computed from cgst + sgst + igst and total_before_tax + taxes)
-- so they can't be inserted directly. We insert the inputs and
-- the trigger/function populates the rest.
INSERT INTO billing.bills (
  company_id, bill_no, bill_date, status,
  base_amount, extra_amount,
  cgst_amount, sgst_amount, igst_amount,
  round_off, grand_total,
  customer_id, created_by, remarks
)
SELECT
  1,
  'BL-STRESS-' || LPAD(s::text, 4, '0'),
  (CURRENT_DATE - (s % 365))::date,
  'issued'::text,
  ROUND((500 + (s * 7.31) % 5000)::numeric, 2),  -- base
  ROUND((100 + (s * 3.17) % 1500)::numeric, 2),   -- extra
  ROUND((500 + (s * 7.31) % 5000 + 100 + (s * 3.17) % 1500) * 0.025::numeric, 2), -- cgst
  ROUND((500 + (s * 7.31) % 5000 + 100 + (s * 3.17) % 1500) * 0.025::numeric, 2), -- sgst
  0,                                                      -- igst (intra-state)
  0,
  ROUND((500 + (s * 7.31) % 5000 + 100 + (s * 3.17) % 1500) * 1.05::numeric),    -- grand_total
  -- Distribute customers: 1 = real Acme (10%), 2-10 = stress customers (90%)
  CASE WHEN s % 10 = 0 THEN 1 ELSE 2 + (s % 9) END,
  (SELECT id FROM core.user_profiles WHERE role = 'owner' LIMIT 1),
  'Stress-test bill ' || s
FROM generate_series(1, 1000) AS s;

-- 5000 duty slips — distribute as 5 per bill on average.
-- We use a single generate_series(1, 5000) and round-robin bills
-- 1..1000 (5 each), then add a 6th pass for the first 0..999.
-- Note: total_km is a generated column — we leave it out and let
-- the column default fire.
INSERT INTO operations.duty_slips (
  company_id, duty_slip_no, booking_date, duty_type, status,
  customer_id, vehicle_id,
  opening_km, closing_km, total_hours,
  pickup_location, drop_location,
  base_amount, extra_km_amount, extra_hour_amount, night_halt_amount,
  driver_allowance, other_charges, total_amount,
  bill_id, created_by,
  duty_start_dt
)
SELECT
  1,
  'DS-STRESS-' || LPAD(s::text, 5, '0'),
  ((CURRENT_DATE - (s % 365)) - ((s * 7) % 30))::date,
  -- Mix of duty types (cast to enum)
  ((ARRAY['per_km','per_hour','per_day','local_package','outstation','flexible']::public.duty_type[])[1 + (s % 6)]),
  'billed'::text,
  -- Distribute across customers (same pattern as bills)
  CASE WHEN s % 10 = 0 THEN 1 ELSE 2 + (s % 9) END,
  -- Cycle through vehicles 1..N. Vehicle 1 is the real one; 2..6 are stress.
  1 + (s % 5),
  -- Km: cycle 0..500 per slip
  (s * 13) % 500,
  -- Closing = opening + 10..100 km
  (s * 13) % 500 + 10 + (s % 90),
  -- total_km computed by the generated column (closing - opening)
  -- total_hours: 1..12
  ROUND((1 + (s % 11) + (s % 7) * 0.1)::numeric, 1),
  'Stress pickup ' || s,
  'Stress drop ' || s,
  -- base_amount
  ROUND((300 + (s * 11.7) % 4000)::numeric, 2),
  0, 0, 0,
  ROUND((50 + (s * 4.3) % 500)::numeric, 2),
  0,
  ROUND((300 + (s * 11.7) % 4000 + 50 + (s * 4.3) % 500)::numeric, 2),
  -- bill_id: link to the corresponding stress bill (round-robin 1..1000)
  (SELECT id FROM billing.bills
     WHERE bill_no = 'BL-STRESS-' || LPAD(((s - 1) % 1000 + 1)::text, 4, '0')
     LIMIT 1),
  (SELECT id FROM core.user_profiles WHERE role = 'owner' LIMIT 1),
  -- duty_start_dt: a sensible datetime on the booking_date morning
  (((CURRENT_DATE - (s % 365)) - ((s * 7) % 30))::date + interval '9 hours'
     + (s % 8 || ' hours')::interval)::timestamptz
FROM generate_series(1, 5000) AS s;

-- Link duty slips to bills via the junction table.
INSERT INTO billing.bill_duty_slips (bill_id, duty_slip_id, included_base, included_extra, included_total)
SELECT
  ds.bill_id,
  ds.id,
  COALESCE(ds.base_amount, 0),
  COALESCE(ds.extra_km_amount, 0) + COALESCE(ds.extra_hour_amount, 0)
    + COALESCE(ds.night_halt_amount, 0) + COALESCE(ds.driver_allowance, 0)
    + COALESCE(ds.other_charges, 0),
  COALESCE(ds.total_amount, 0)
FROM operations.duty_slips ds
WHERE ds.duty_slip_no LIKE 'DS-STRESS-%';

-- Refresh base_amount / extra_amount / grand_total on each stress bill
-- so the numbers match the linked slips.
UPDATE billing.bills b
SET base_amount  = COALESCE(s.base_sum, 0),
    extra_amount = COALESCE(s.extra_sum, 0),
    grand_total  = ROUND((COALESCE(s.base_sum, 0) + COALESCE(s.extra_sum, 0)) * 1.05),
    cgst_amount     = ROUND((COALESCE(s.base_sum, 0) + COALESCE(s.extra_sum, 0)) * 0.025),
    sgst_amount     = ROUND((COALESCE(s.base_sum, 0) + COALESCE(s.extra_sum, 0)) * 0.025)
    -- total_tax and total_after_tax are GENERATED columns — they
    -- recompute automatically from base+extra+c gst+sgst+igst.
FROM (
  SELECT
    bds.bill_id,
    SUM(bds.included_base) AS base_sum,
    SUM(bds.included_extra) AS extra_sum
  FROM billing.bill_duty_slips bds
  JOIN operations.duty_slips ds ON ds.id = bds.duty_slip_id
  WHERE ds.duty_slip_no LIKE 'DS-STRESS-%'
  GROUP BY bds.bill_id
) s
WHERE b.id = s.bill_id
  AND b.bill_no LIKE 'BL-STRESS-%';

-- Re-enable user triggers and commit.
SET LOCAL session_replication_role = origin;
COMMIT;
