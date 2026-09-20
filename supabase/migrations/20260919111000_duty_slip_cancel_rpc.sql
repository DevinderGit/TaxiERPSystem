-- TAXI-805 — Cancel a duty slip.
--
-- A `cancelled` duty slip cannot be edited (TAX-802 update_duty_slip already
-- blocks it with "Cancelled duty slips cannot be edited."). M9's
-- generate_bill RPC will also refuse to attach a bill to a cancelled slip.
--
-- Per the MTP: status flips from open|closed to cancelled via a single
-- explicit RPC call. The trigger fn_audit_row will log this UPDATE.

CREATE OR REPLACE FUNCTION public.cancel_duty_slip(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, operations
AS $$
DECLARE
  v_old operations.duty_slips%ROWTYPE;
BEGIN
  SELECT * INTO v_old
    FROM operations.duty_slips
   WHERE id = p_id AND company_id = public.current_company_id()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duty slip not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION 'This duty slip is already cancelled.' USING ERRCODE = 'P0001';
  END IF;

  IF v_old.status = 'billed' THEN
    RAISE EXCEPTION 'Billed duty slips cannot be cancelled. Reverse the bill first (M9).'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE operations.duty_slips
     SET status = 'cancelled'
   WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_duty_slip(bigint) TO authenticated;
