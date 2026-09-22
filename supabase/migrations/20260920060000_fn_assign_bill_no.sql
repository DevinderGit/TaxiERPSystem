-- M9 — TAXI-902 — fn_assign_bill_no trigger on billing.bills
-- Parallel to operations.fn_assign_duty_slip_no (TAXI-107): reads the
-- 'bill' row from master.document_sequences, formats prefix + lpad
-- + suffix, increments next_value. Caller-supplied bill_no wins.
-- Fallback ('BL-' || id) when the sequence row is missing or mode
-- is manual and caller passed NULL.

SET search_path TO public, master, billing;

CREATE OR REPLACE FUNCTION billing.fn_assign_bill_no()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  seq          master.document_sequences%ROWTYPE;
  formatted_no text;
BEGIN
  -- 1. Operator provided the bill_no explicitly — use as-is.
  IF NEW.bill_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Lock the sequence row for this company + key.
  SELECT * INTO seq
    FROM master.document_sequences
    WHERE company_id = NEW.company_id
      AND sequence_key = 'bill'
    FOR UPDATE;

  -- 3. Sequence row missing → fallback to a stable per-row id-based number.
  IF seq.id IS NULL THEN
    NEW.bill_no := 'BL-' || NEW.id;
    RETURN NEW;
  END IF;

  -- 4. Sequence row exists but mode is 'manual' and operator didn't provide
  --    a number → fallback. Manual mode requires the operator to type the
  --    number; auto-assigning here would silently change the visible
  --    sequence and defeat the purpose of manual mode.
  IF seq.mode = 'manual' THEN
    NEW.bill_no := 'BL-' || NEW.id;
    RETURN NEW;
  END IF;

  -- 5. Auto mode: format the next number, increment the sequence.
  formatted_no := COALESCE(seq.prefix, '')
    || lpad(seq.next_value::text, seq.padding_length, '0')
    || COALESCE(seq.suffix, '');

  NEW.bill_no := formatted_no;

  UPDATE master.document_sequences
    SET next_value = seq.next_value + 1
    WHERE id = seq.id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bill_no ON billing.bills;
CREATE TRIGGER trg_bill_no
  BEFORE INSERT ON billing.bills
  FOR EACH ROW EXECUTE FUNCTION billing.fn_assign_bill_no();