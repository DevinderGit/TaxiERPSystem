import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton Supabase client — the only PostgREST / Auth / Storage / Realtime
 * entry point the SPA uses (per Code Architecture spec §5.1:
 * "Service → supabaseClient (single PostgREST entry point)").
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the build-time env
 * (Vite populates `import.meta.env` from `.env.local` at dev/build time).
 *
 * Public surface (spec §4.1, "supabaseClient"):
 *   supabase.from(table)             → PostgREST SELECT/INSERT/UPDATE/DELETE
 *   supabase.rpc(name, args)         → call a Postgres function (used by generate_bill in M9)
 *   supabase.storage.from(bucket)    → S3-compatible bucket client (used by company logo upload in TAXI-302)
 *   supabase.auth                    → sign-in / sign-out / session / refresh (M2)
 *   supabase.channel(name)           → Realtime channel (reserved for future use)
 *
 * Database row types are untyped for now (`<any>`) until the schema is generated
 * via `supabase gen types typescript` after M1. The schema-typed Database generic
 * lands alongside the first generated types file in M14.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'supabaseClient: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Populate .env.local via `supabase start` and try again.',
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export default supabase;
