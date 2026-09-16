/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the local self-hosted Supabase stack (PostgREST via Kong gateway). */
  readonly VITE_SUPABASE_URL: string;
  /** Anon-role JWT. Sent as `apikey` header on every browser request. */
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Service-role JWT. Bypasses RLS. Server-side / migrations only — DO NOT import in browser code. */
  readonly VITE_SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
