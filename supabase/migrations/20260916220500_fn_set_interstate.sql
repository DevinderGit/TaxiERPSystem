-- TAXI-106 — Implement master.fn_set_interstate() per System Design §4.6.
--
-- BEFORE INSERT OR UPDATE trigger on master.gst_config that derives
-- is_interstate from customer.state vs company.state. The operator
-- never sets is_interstate manually.

-- ============================================================================
-- 1. Trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION master.fn_set_interstate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  customer_state text;
  company_state  text;
BEGIN
  -- Read the current state of both parent rows. If either is missing
  -- (shouldn't happen — FKs enforce presence), we leave is_interstate
  -- as whatever the caller provided (NULL by default).
  SELECT state INTO customer_state FROM master.customers WHERE id = NEW.customer_id;
  SELECT state INTO company_state  FROM core.companies   WHERE id = NEW.company_id;

  IF customer_state IS NOT NULL AND company_state IS NOT NULL THEN
    NEW.is_interstate := (customer_state IS DISTINCT FROM company_state);
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS trg_gst_interstate ON master.gst_config;

CREATE TRIGGER trg_gst_interstate
BEFORE INSERT OR UPDATE ON master.gst_config
FOR EACH ROW
EXECUTE FUNCTION master.fn_set_interstate();
