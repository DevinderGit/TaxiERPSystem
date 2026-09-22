-- M10 — TAXI-1002 / TAXI-1003 / TAXI-1004 — Change / Cancel Bill RPCs.
-- Three SECURITY DEFINER RPCs:
--   public.update_bill_metadata(p_bill_id, p_bill_date, p_remarks)
--   public.add_duty_slip_to_bill(p_bill_id, p_duty_slip_id)
--   public.remove_duty_slip_from_bill(p_bill_id, p_duty_slip_id)
--   public.cancel_bill(p_bill_id, p_cancel_reason)
-- All guard with current_user_role() ∈ {owner, operator}.

SET search_path TO public, master, operations, billing, accounts;

-- ============================================================
-- Helper: enforce caller role is owner / operator.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_assert_can_edit_bills()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_user_role();
$$;

-- ============================================================
-- TAXI-1002 — update_bill_metadata
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_bill_metadata(
  p_bill_id   bigint,
  p_bill_date date,
  p_remarks   text
)
RETURNS billing.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, billing
AS $function$
DECLARE
  v_role      text;
  v_company_id bigint;
  v_bill      billing.bills%ROWTYPE;
BEGIN
  v_role := public.current_user_role();
  IF v_role IS DISTINCT FROM 'owner' AND v_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can edit bill metadata (your role: %).',
      COALESCE(v_role, 'unknown') USING ERRCODE = '42501';
  END IF;

  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No current_company_id() in JWT.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bill FROM billing.bills WHERE id = p_bill_id FOR UPDATE;
  IF v_bill.id IS NULL THEN
    RAISE EXCEPTION 'Bill % not found.', p_bill_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bill.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Bill % does not belong to your company.', p_bill_id USING ERRCODE = '42501';
  END IF;
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled bills cannot be edited.' USING ERRCODE = '22023';
  END IF;
  IF p_bill_date IS NULL THEN
    RAISE EXCEPTION 'Bill date is required.' USING ERRCODE = '22023';
  END IF;

  UPDATE billing.bills
    SET bill_date = p_bill_date,
        remarks   = NULLIF(trim(p_remarks), '')
    WHERE id = p_bill_id
    RETURNING * INTO v_bill;

  RETURN v_bill;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_bill_metadata(bigint, date, text) TO authenticated;

-- ============================================================
-- TAXI-1003a — add_duty_slip_to_bill
-- Locks the bill + slip, validates cross-customer + status, INSERTs
-- the bill_duty_slips row, UPDATEs the slip. The TAXI-907 trigger
-- recomputes the parent bill's totals.
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_duty_slip_to_bill(
  p_bill_id      bigint,
  p_duty_slip_id bigint
)
RETURNS billing.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations, billing
AS $function$
DECLARE
  v_role      text;
  v_company_id bigint;
  v_bill      billing.bills%ROWTYPE;
  v_slip      operations.duty_slips%ROWTYPE;
  v_extras    numeric(12,2);
  v_total     numeric(12,2);
BEGIN
  v_role := public.current_user_role();
  IF v_role IS DISTINCT FROM 'owner' AND v_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can modify a bill (your role: %).',
      COALESCE(v_role, 'unknown') USING ERRCODE = '42501';
  END IF;

  v_company_id := public.current_company_id();

  SELECT * INTO v_bill FROM billing.bills   WHERE id = p_bill_id      FOR UPDATE;
  SELECT * INTO v_slip FROM operations.duty_slips WHERE id = p_duty_slip_id FOR UPDATE;

  IF v_bill.id IS NULL  THEN RAISE EXCEPTION 'Bill % not found.',  p_bill_id      USING ERRCODE = 'P0002'; END IF;
  IF v_slip.id IS NULL  THEN RAISE EXCEPTION 'Duty slip % not found.', p_duty_slip_id USING ERRCODE = 'P0002'; END IF;
  IF v_bill.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Bill % does not belong to your company.', p_bill_id USING ERRCODE = '42501';
  END IF;
  IF v_slip.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Duty slip % does not belong to your company.', p_duty_slip_id USING ERRCODE = '42501';
  END IF;
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Bill % is cancelled; cannot add slips.', p_bill_id USING ERRCODE = '22023';
  END IF;
  IF v_slip.status = 'cancelled' THEN
    RAISE EXCEPTION 'Duty slip % is cancelled; cannot add to bill.', p_duty_slip_id USING ERRCODE = '22023';
  END IF;
  IF v_slip.bill_id IS NOT NULL AND v_slip.status = 'billed' THEN
    RAISE EXCEPTION 'Duty slip % is already billed (bill_id=%).',
      p_duty_slip_id, v_slip.bill_id USING ERRCODE = '22023';
  END IF;
  IF v_slip.customer_id <> v_bill.customer_id THEN
    RAISE EXCEPTION 'Duty slip % belongs to customer %, not the bill customer (%).',
      p_duty_slip_id, v_slip.customer_id, v_bill.customer_id USING ERRCODE = '22023';
  END IF;

  -- Insert the junction row with snapshotted amounts.
  v_extras := COALESCE(v_slip.extra_km_amount, 0)
            + COALESCE(v_slip.extra_hour_amount, 0)
            + COALESCE(v_slip.night_halt_amount, 0)
            + COALESCE(v_slip.driver_allowance, 0)
            + COALESCE(v_slip.other_charges, 0);
  v_total  := COALESCE(v_slip.base_amount, 0) + v_extras;

  INSERT INTO billing.bill_duty_slips
    (bill_id, duty_slip_id, included_base, included_extra, included_total)
  VALUES
    (p_bill_id, p_duty_slip_id, COALESCE(v_slip.base_amount, 0), v_extras, v_total);

  -- Flip the slip to billed.
  UPDATE operations.duty_slips
    SET bill_id = p_bill_id, status = 'billed'
    WHERE id = p_duty_slip_id;

  -- The TAXI-907 trigger recomputed the parent bill's totals.
  SELECT * INTO v_bill FROM billing.bills WHERE id = p_bill_id;
  RETURN v_bill;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_duty_slip_to_bill(bigint, bigint) TO authenticated;

-- ============================================================
-- TAXI-1003b — remove_duty_slip_from_bill
-- Locks the bill + slip, deletes the junction row, frees the slip.
-- The trigger recomputes the parent bill's totals.
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_duty_slip_from_bill(
  p_bill_id      bigint,
  p_duty_slip_id bigint
)
RETURNS billing.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, operations, billing
AS $function$
DECLARE
  v_role       text;
  v_company_id bigint;
  v_bill       billing.bills%ROWTYPE;
  v_slip       operations.duty_slips%ROWTYPE;
BEGIN
  v_role := public.current_user_role();
  IF v_role IS DISTINCT FROM 'owner' AND v_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can modify a bill (your role: %).',
      COALESCE(v_role, 'unknown') USING ERRCODE = '42501';
  END IF;

  v_company_id := public.current_company_id();

  SELECT * INTO v_bill FROM billing.bills   WHERE id = p_bill_id      FOR UPDATE;
  SELECT * INTO v_slip FROM operations.duty_slips WHERE id = p_duty_slip_id FOR UPDATE;

  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Bill % not found.', p_bill_id USING ERRCODE = 'P0002'; END IF;
  IF v_slip.id IS NULL THEN RAISE EXCEPTION 'Duty slip % not found.', p_duty_slip_id USING ERRCODE = 'P0002'; END IF;
  IF v_bill.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Bill % does not belong to your company.', p_bill_id USING ERRCODE = '42501';
  END IF;
  IF v_slip.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Duty slip % does not belong to your company.', p_duty_slip_id USING ERRCODE = '42501';
  END IF;
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Bill % is cancelled; cannot remove slips.', p_bill_id USING ERRCODE = '22023';
  END IF;
  IF v_slip.bill_id <> p_bill_id OR v_slip.status <> 'billed' THEN
    RAISE EXCEPTION 'Duty slip % is not on bill %.', p_duty_slip_id, p_bill_id USING ERRCODE = '22023';
  END IF;

  DELETE FROM billing.bill_duty_slips WHERE bill_id = p_bill_id AND duty_slip_id = p_duty_slip_id;

  UPDATE operations.duty_slips
    SET bill_id = NULL, status = 'closed'
    WHERE id = p_duty_slip_id;

  SELECT * INTO v_bill FROM billing.bills WHERE id = p_bill_id;
  RETURN v_bill;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.remove_duty_slip_from_bill(bigint, bigint) TO authenticated;

-- ============================================================
-- TAXI-1004 — cancel_bill
-- Single transaction:
--   1. Mark bill cancelled (cancelled_at, cancelled_by, cancel_reason).
--   2. Free every linked duty slip (bill_id = NULL, status = 'closed').
--   3. Delete bill_duty_slips rows (trigger short-circuits because
--      bill is now cancelled — its guard `IF v_bill.status =
--      'cancelled' THEN RETURN COALESCE(NEW, OLD)` skips the recompute).
--   4. Post a reversal sale ledger entry (credit_amount = grand_total,
--      narration = 'Reversal - Bill {bill_no} cancelled').
-- Returns the cancelled bill.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_bill(
  p_bill_id       bigint,
  p_cancel_reason text
)
RETURNS billing.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master, billing, accounts
AS $function$
DECLARE
  v_role       text;
  v_company_id bigint;
  v_caller_uid uuid;
  v_bill       billing.bills%ROWTYPE;
  v_customer   master.customers%ROWTYPE;
  v_duty_slip_id bigint;
  v_count      int;
BEGIN
  v_role := public.current_user_role();
  IF v_role IS DISTINCT FROM 'owner' AND v_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can cancel a bill (your role: %).',
      COALESCE(v_role, 'unknown') USING ERRCODE = '42501';
  END IF;

  v_caller_uid := auth.uid();
  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No current_company_id() in JWT.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bill FROM billing.bills WHERE id = p_bill_id FOR UPDATE;
  IF v_bill.id IS NULL THEN
    RAISE EXCEPTION 'Bill % not found.', p_bill_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bill.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Bill % does not belong to your company.', p_bill_id USING ERRCODE = '42501';
  END IF;
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Bill % is already cancelled.', p_bill_id USING ERRCODE = '22023';
  END IF;

  -- Cancellation reason required, min 10 chars (per MTP).
  IF p_cancel_reason IS NULL OR length(trim(p_cancel_reason)) < 10 THEN
    RAISE EXCEPTION 'Cancel reason is required (min 10 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_customer FROM master.customers
    WHERE id = v_bill.customer_id AND company_id = v_company_id;

  -- 1. Mark bill cancelled FIRST. After this, any subsequent
  --    bill_duty_slips DELETE will hit the trigger's cancelled-
  --    bill short-circuit (no recompute, no GST config lookup).
  UPDATE billing.bills
    SET status        = 'cancelled',
        cancelled_at  = now(),
        cancelled_by  = v_caller_uid,
        cancel_reason = trim(p_cancel_reason)
    WHERE id = p_bill_id;

  -- 2. Free linked slips (use one UPDATE; collect ids for the audit log).
  UPDATE operations.duty_slips
    SET bill_id = NULL, status = 'closed'
    WHERE bill_id = p_bill_id AND status = 'billed';

  -- 3. Clean up junction rows. The TAXI-907 recompute trigger
  --    sees status='cancelled' and short-circuits.
  DELETE FROM billing.bill_duty_slips WHERE bill_id = p_bill_id;

  -- 4. Reversal ledger entry.
  INSERT INTO accounts.ledger_entries (
    company_id, entry_date, entry_type,
    customer_id, linked_bill_id,
    credit_amount, narration,
    created_by
  )
  VALUES (
    v_company_id, CURRENT_DATE, 'sale',
    v_bill.customer_id, p_bill_id,
    v_bill.grand_total,
    'Reversal - Bill ' || v_bill.bill_no || ' cancelled',
    v_caller_uid
  );

  -- Return the cancelled bill (re-fetch for fresh values).
  SELECT * INTO v_bill FROM billing.bills WHERE id = p_bill_id;
  RETURN v_bill;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_bill(bigint, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_bill(bigint, text)
  IS 'Cancels a bill in one transaction: marks status=cancelled,
      frees linked duty slips (bill_id=NULL, status=closed),
      deletes the junction rows, posts a reversal sale ledger
      entry. Reversal is irreversible. Cancelled bills cannot be
      un-cancelled via this RPC.';