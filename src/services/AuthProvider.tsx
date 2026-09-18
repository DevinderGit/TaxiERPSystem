import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

/**
 * AuthProvider — holds the GoTrue session, exposes the current user +
 * tenant + role, and provides signIn / signOut / refresh actions.
 *
 * Per Code Architecture spec §4.1 ("AuthProvider"):
 *   "Holds the GoTrue session, decodes JWT claims (company_id, user_role),
 *    exposes sign-in / sign-out, refreshes tokens on focus."
 *
 * Public members: session, user, role, companyId, isReady, signIn, signOut, refresh.
 *
 * `role` defaults to whatever the JWT claims report (typically "authenticated"
 * for any logged-in user). The custom `user_role` claim ("owner" / "operator"
 * / "accountant" / "viewer") is injected by the Supabase Auth hook in
 * TAXI-202 — before that lands, `role` here falls back to the JWT's built-in
 * `role` field, which is fine for M0+M1 testing.
 *
 * `companyId` is read from the JWT's `company_id` claim. Before TAXI-202
 * lands, this will be null.
 */

export type UserRole = 'owner' | 'operator' | 'accountant' | 'viewer';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  companyId: number | null;
  isReady: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Decode the payload of a JWT without verifying its signature. Safe to use
 * client-side because the signature has already been verified by Supabase
 * when the token was issued; we only read the claims here.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  if (!token) return {};
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function deriveRole(claims: Record<string, unknown>): UserRole | null {
  const raw = (claims.user_role ?? claims.role) as string | undefined;
  if (raw === 'owner' || raw === 'operator' || raw === 'accountant' || raw === 'viewer') {
    return raw;
  }
  return null;
}

function deriveCompanyId(claims: Record<string, unknown>): number | null {
  const raw = claims.company_id;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  const user = session?.user ?? null;

  const { role, companyId } = useMemo(() => {
    if (!session?.access_token) return { role: null as UserRole | null, companyId: null as number | null };
    const claims = decodeJwtPayload(session.access_token);
    return {
      role: deriveRole(claims),
      companyId: deriveCompanyId(claims),
    };
  }, [session]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
  }, []);

  // Initial session fetch + auth-state subscription.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setIsReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Refresh token on window focus (catches long-idle tabs whose JWT may
  // have been rotated by GoTrue in the background).
  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value: AuthContextValue = {
    session,
    user,
    role,
    companyId,
    isReady,
    signIn,
    signOut,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Consumer hook. Throws if used outside an AuthProvider — this is a
 * deliberate fail-fast so we never accidentally render pages in a
 * context where role/companyId are undefined.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return ctx;
}
