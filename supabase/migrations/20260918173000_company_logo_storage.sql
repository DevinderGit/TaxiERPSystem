-- TAXI-302 — Company logo storage bucket + tenant-scoped RLS.
--
-- The core.* GRANTs added in TAXI-110 don't cover the storage schema.
-- storage.objects has RLS enabled by default in Supabase but ships with
-- zero policies, which means NO authenticated user can read or write
-- anything — every operation hits "new row violates row-level security
-- policy" before the predicate even runs. We fix that here.
--
-- Path convention enforced by the RLS policies:
--   <company_id>/<timestamp>.<ext>
-- e.g. 1/1737264000000.png
-- The first path segment MUST equal the caller's company_id claim.
-- storage.foldername(name) returns text[] so [1] gives us that segment.
--
-- Bucket is private (public = false). The UI displays logos via 1-hour
-- signed URLs generated on each page load (see CompanyDetailPage.tsx).

-- ============================================================================
-- 1. Schema + table grants (mirror what TAXI-110 did for the 6 ERP schemas)
-- ============================================================================
GRANT USAGE ON SCHEMA storage TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;

-- ============================================================================
-- 2. Bucket
-- ============================================================================
INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
) VALUES (
  'company-logos',
  'company-logos',
  false,
  1048576,                            -- 1 MiB (matches spec "max 1 MB")
  ARRAY['image/jpeg', 'image/png'],   -- JPG/PNG only
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. RLS policies on storage.objects
-- ============================================================================
-- The predicate is identical on every command: the row belongs to the
-- company-logos bucket AND the first folder segment equals the caller's
-- current_company_id(). This stops one tenant from ever touching another
-- tenant's logo, even by guessing a path.

DROP POLICY IF EXISTS company_logos_select ON storage.objects;
CREATE POLICY company_logos_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

DROP POLICY IF EXISTS company_logos_insert ON storage.objects;
CREATE POLICY company_logos_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

DROP POLICY IF EXISTS company_logos_update ON storage.objects;
CREATE POLICY company_logos_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  )
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

DROP POLICY IF EXISTS company_logos_delete ON storage.objects;
CREATE POLICY company_logos_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );
