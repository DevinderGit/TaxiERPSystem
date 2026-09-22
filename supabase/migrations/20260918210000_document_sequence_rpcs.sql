-- TAXI-404 — Public-schema RPCs for Document Sequence CRUD.
--
-- Same PostgREST custom-schema workaround as the other M2/M3/M4 pages.
-- RLS on master.document_sequences (from TAXI-110) still applies —
-- write_requires_operator (owner + operator only) at the table level.
--
-- Dup-key on (company_id, sequence_key) → "Sequence key already exists."
--
-- The seed migration (TAXI-103) created two default rows:
--   duty_slip  prefix='DS-' mode='auto' padding=4 next_value=1
--   bill       prefix='BL-' mode='auto' padding=4 next_value=1
-- (verified end-to-end with the fn_assign_duty_slip_no trigger in TAXI-107).

-- ============================================================================
-- 1. list_document_sequences_for_company — read
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_document_sequences_for_company()
RETURNS TABLE (
  id             bigint,
  sequence_key   text,
  prefix         text,
  suffix         text,
  next_value     bigint,
  padding_length integer,
  mode           text,
  is_active      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, master
AS $$
  SELECT ds.id, ds.sequence_key, ds.prefix, ds.suffix, ds.next_value,
         ds.padding_length, ds.mode::text, ds.is_active
    FROM master.document_sequences ds
   WHERE ds.company_id = public.current_company_id()
   ORDER BY ds.sequence_key;
$$;

GRANT EXECUTE ON FUNCTION public.list_document_sequences_for_company() TO authenticated;

-- ============================================================================
-- 2. add_document_sequence — write (insert)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_document_sequence(
  p_sequence_key   text,
  p_prefix         text             DEFAULT '',
  p_suffix         text             DEFAULT '',
  p_next_value     bigint           DEFAULT 1,
  p_padding_length integer          DEFAULT 4,
  p_mode           text             DEFAULT 'auto',
  p_is_active      boolean          DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_sequence_key IS NULL OR btrim(p_sequence_key) = '' THEN
    RAISE EXCEPTION 'Sequence key is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'Mode must be ''auto'' or ''manual''.'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    -- Cast p_mode to the enum via the bare type name; the SET search_path
    -- above puts `master` in scope so sequence_mode resolves correctly.
    -- Schema-qualified `master.sequence_mode` doesn't work because the
    -- Supabase migration runner's connection doesn't have master in the
    -- search_path at plan time, so we rely on the function-level SET.
    INSERT INTO master.document_sequences (
      company_id, sequence_key, prefix, suffix, next_value,
      padding_length, mode, is_active
    ) VALUES (
      public.current_company_id(), btrim(p_sequence_key),
      COALESCE(p_prefix, ''), COALESCE(p_suffix, ''),
      COALESCE(p_next_value, 1), COALESCE(p_padding_length, 4),
      p_mode::sequence_mode, COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Sequence key already exists.'
        USING ERRCODE = '23505';
  END;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_document_sequence(
  text, text, text, bigint, integer, text, boolean
) TO authenticated;

-- ============================================================================
-- 3. update_document_sequence — write (update)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_document_sequence(
  p_id             bigint,
  p_prefix         text    DEFAULT NULL,
  p_suffix         text    DEFAULT NULL,
  p_next_value     bigint  DEFAULT NULL,
  p_padding_length integer DEFAULT NULL,
  p_mode           text    DEFAULT NULL,
  p_is_active      boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, master
AS $$
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'Mode must be ''auto'' or ''manual''.'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    -- Same enum-cast workaround as add_document_sequence.
    UPDATE master.document_sequences
       SET prefix         = COALESCE(p_prefix,         prefix),
           suffix         = COALESCE(p_suffix,         suffix),
           next_value     = COALESCE(p_next_value,     next_value),
           padding_length = COALESCE(p_padding_length, padding_length),
           mode           = COALESCE(p_mode::sequence_mode, mode),
           is_active      = COALESCE(p_is_active,      is_active)
     WHERE id = p_id
       AND company_id = public.current_company_id();
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Sequence key already exists.'
        USING ERRCODE = '23505';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_document_sequence(
  bigint, text, text, bigint, integer, text, boolean
) TO authenticated;
