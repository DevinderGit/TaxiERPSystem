-- Step 1: add 'local' to master.duty_type (bare type name — the
-- migration runner's connection doesn't have master in search_path).

ALTER TYPE duty_type ADD VALUE IF NOT EXISTS 'local' AFTER 'flexible';
