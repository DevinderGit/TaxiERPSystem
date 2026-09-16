-- TAXI-004 temporary test migration.
-- Creates a single test row so the Manual Test Plan step 6 can confirm
-- the supabaseClient singleton reaches PostgREST and returns data.
-- This file is DELETED after TAXI-004 verification — it is NOT part of
-- the real schema. The next `supabase db reset` will drop it.

CREATE TABLE hello (
  id int PRIMARY KEY,
  msg text NOT NULL
);

INSERT INTO hello (id, msg) VALUES (1, 'world');
