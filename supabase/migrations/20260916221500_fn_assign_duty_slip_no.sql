-- TAXI-107 — Implement operations.fn_assign_duty_slip_no() per System Design §4.9.
--
-- BEFORE INSERT trigger on operations.duty_slips that auto-assigns the
-- visible duty slip number from master.document_sequences, or uses the
-- operator's explicit value when in manual mode.
--
-- Seed data for the duty_slip sequence row is included so the manual
-- test plan works immediately after db reset; the operator can edit
-- it via Master → Utilities → Document No. Control (TAXI-404).

-- ============================================================================
-- 1. Trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION operations.fn_assign_duty_slip_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  seq          master.document_sequences%ROWTYPE;
  formatted_no text;
BEGIN
  -- 1. Operator provided the number explicitly — use as-is.
  IF NEW.duty_slip_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Lock the sequence row for this company + key.
  SELECT * INTO seq
    FROM master.document_sequences
    WHERE company_id = NEW.company_id
      AND sequence_key = 'duty_slip'
    FOR UPDATE;

  -- 3. Sequence row missing → fallback to a stable per-row id-based number.
  IF seq.id IS NULL THEN
    NEW.duty_slip_no := 'DS-' || NEW.id;
    RETURN NEW;
  END IF;

  -- 4. Sequence row exists but mode is 'manual' and operator didn't provide a
  --    number → fallback. Manual mode requires the operator to type the
  --    number; auto-assigning here would silently change the visible
  --    sequence and defeat the purpose of manual mode.
  IF seq.mode = 'manual' THEN
    NEW.duty_slip_no := 'DS-' || NEW.id;
    RETURN NEW;
  END IF;

  -- 5. Auto mode: format the next number, increment the sequence.
  formatted_no := COALESCE(seq.prefix, '')
    || lpad(seq.next_value::text, seq.padding_length, '0')
    || COALESCE(seq.suffix, '');

  NEW.duty_slip_no := formatted_no;

  UPDATE master.document_sequences
    SET next_value = seq.next_value + 1
    WHERE id = seq.id;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS trg_duty_slip_no ON operations.duty_slips;

CREATE TRIGGER trg_duty_slip_no
BEFORE INSERT ON operations.duty_slips
FOR EACH ROW
EXECUTE FUNCTION operations.fn_assign_duty_slip_no();

-- ============================================================================
-- 3. Seed: default duty_slip sequence row
-- ============================================================================
-- Pre-existing sequence row so the auto-numbering path has something
-- to read immediately. M4 (Document No. Control tab) lets the operator
-- edit prefix/suffix/mode/padding at runtime.
INSERT INTO master.document_sequences (
  company_id, sequence_key, prefix, next_value, mode, padding_length
) VALUES (
  1, 'duty_slip', 'DS-', 1, 'auto', 4
)
ON CONFLICT (company_id, sequence_key) DO NOTHING;
