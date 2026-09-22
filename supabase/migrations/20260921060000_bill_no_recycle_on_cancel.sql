-- M9 follow-up — allow cancelled bills to share bill_no with a new
-- bill, so the operator can "regenerate" a bill number after cancel.
--
-- Operator workflow: cancel BL-0001 → the next generate_bill
-- should produce BL-0001 again (the operator thinks of cancelled
-- as "logically deleted"). Before this change the UNIQUE constraint
-- `(company_id, bill_no)` blocked it; now the constraint is partial
-- on non-cancelled rows.
--
-- Also: cancel_bill decrements master.document_sequences.next_value
-- when the cancelled bill's bill_no matches the most-recently-assigned
-- number (e.g. cancelling BL-0001 when sequence.next_value=2 returns
-- the sequence to 1, so the next generate_bill picks BL-0001 again).
-- Cancelling an older bill (e.g. BL-0001 when sequence is at 5) does
-- NOT decrement — the newer bills are still there, free numbers would
-- confuse things.

SET search_path TO public, master, billing;

-- ============================================================
-- 1. Replace full UNIQUE constraint with a partial UNIQUE INDEX.
-- ============================================================
ALTER TABLE billing.bills DROP CONSTRAINT IF EXISTS bills_company_id_bill_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS bills_active_bill_no_key
  ON billing.bills USING btree (company_id, bill_no)
  WHERE status <> 'cancelled';

-- ============================================================
-- 2. Modify cancel_bill to decrement the sequence when the
--    cancelled bill is the most-recently-assigned number.
-- ============================================================
DROP FUNCTION IF EXISTS public.cancel_bill(bigint, text);

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
  v_seq        master.document_sequences%ROWTYPE;
  v_latest_no  text;
  v_should_decrement boolean := false;
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

  -- Lock the 'bill' sequence row so a concurrent generate_bill doesn't
  -- race the decrement.
  SELECT * INTO v_seq
    FROM master.document_sequences
    WHERE company_id = v_company_id AND sequence_key = 'bill'
    FOR UPDATE;

  -- Determine whether this cancelled bill is the most-recently-assigned
  -- bill_no (i.e. cancelling it should "free up" the sequence number).
  -- Latest assigned = prefix + lpad(next_value - 1, padding).
  IF v_seq.id IS NOT NULL THEN
    v_latest_no := COALESCE(v_seq.prefix, '')
      || lpad((v_seq.next_value - 1)::text, v_seq.padding_length, '0')
      || COALESCE(v_seq.suffix, '');
    v_should_decrement := (v_bill.bill_no = v_latest_no);
  END IF;

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

  -- 5. Decrement the sequence so the next generate_bill can reuse
  --    this number (only if it was the latest assigned).
  IF v_should_decrement AND v_seq.next_value > 1 THEN
    UPDATE master.document_sequences
      SET next_value = v_seq.next_value - 1
      WHERE id = v_seq.id;
  END IF;

  -- Return the cancelled bill (re-fetch for fresh values).
  SELECT * INTO v_bill FROM billing.bills WHERE id = p_bill_id;
  RETURN v_bill;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_bill(bigint, text) TO authenticated;