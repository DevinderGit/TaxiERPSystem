-- M11 — TAXI-1101 rebuild — company tax IDs + bill T&C setting.
--
-- Adds three nullable text columns to core.companies so the
-- BillPDF template (docs/billTemplate.pdf) can render the
-- SAC No / State Code / Service Tax Category that sit next to
-- GSTIN and PAN in the company header.
--
-- Also seeds system.settings with the bill_terms_and_conditions
-- key so the T&C footer (the 6 legal paragraphs from the
-- template) renders without code changes. Operator can edit
-- later via Settings (TAXI-1402).

SET search_path TO public, core, system;

ALTER TABLE core.companies
  ADD COLUMN IF NOT EXISTS sac_no      text,
  ADD COLUMN IF NOT EXISTS state_code  text,
  ADD COLUMN IF NOT EXISTS st_category text;

COMMENT ON COLUMN core.companies.sac_no
  IS 'Service Accounting Code (e.g. 9966 for Rent-A-Cab). Shown in BillPDF header.';
COMMENT ON COLUMN core.companies.state_code
  IS 'Numeric GST state code (e.g. 07 for Delhi, 27 for Maharashtra). Shown in BillPDF header.';
COMMENT ON COLUMN core.companies.st_category
  IS 'Service Tax category (e.g. Rent-A-Cab). Shown in BillPDF header.';

-- T&C default text — the 6 paragraphs from docs/billTemplate.pdf.
-- One row per company; if a row already exists for this key the
-- INSERT is a no-op so re-running the migration is safe.
INSERT INTO system.settings (company_id, setting_key, setting_value, data_type)
SELECT c.id, 'bill_terms_and_conditions',
  E'E. & O.E. Subject to Delhi Jurisdiction.\n\nOur Responsibility of the signed duty slip resets till we handover them to you with the bill.\n\nInterest chargable on bills not paid on presentation @ 18% p.a.\n\nPassengers Tax, Toll tax, Interstate taxes, Car parking Etc. will be charged on actual basis on production of receipts.\n\nGST, if Applicable will be charged extra. A subsequent bill will be issued for the same.\n\nIn case of discrepency , Kindly return the bill for necessary correction within 10 days or it shall be treated as O.K. and you shall be liable to pay the full amount.',
  'text'
FROM core.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM system.settings s
  WHERE s.company_id = c.id AND s.setting_key = 'bill_terms_and_conditions'
);
