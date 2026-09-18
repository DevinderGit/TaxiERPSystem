import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { UserRole } from '../services/AuthProvider';

/**
 * RoleGuard — conditional renderer based on the current user's role.
 *
 * Two modes driven by which prop you pass:
 *
 * 1. Inline use (default) — drop it inside a page to hide a UI element:
 *    <RoleGuard allowedRoles={['owner']}><Button>...</Button></RoleGuard>
 *    If the role doesn't match, the children are hidden and `fallback`
 *    (default: null) is rendered instead.
 *
 * 2. Route use — wrap a whole route's element to redirect away:
 *    <Route path="/settings/users" element={
 *      <RoleGuard allowedRoles={['owner']} redirectTo="/unauthorized">
 *        <UserManagementPage />
 *      </RoleGuard>
 *    } />
 *    If the role doesn't match, the user is <Navigate>'d to `redirectTo`
 *    (default: '/unauthorized').
 *
 * Per Code Architecture spec §4.1 ("RoleGuard"):
 *   "Conditional renderer. Hides children if the current user's role is
 *    not in `allowedRoles`; hides children and renders `fallback`
 *    (default: null). If hard denial (e.g. navigating directly to a
 *    forbidden URL), redirect to `/unauthorized`."
 */

interface RoleGuardProps {
  allowedRoles: UserRole[];
  fallback?: ReactNode;
  /** If set, the guard redirects here when the role doesn't match (whole-route use). */
  redirectTo?: string;
  children: ReactNode;
}

export function RoleGuard({
  allowedRoles,
  fallback = null,
  redirectTo = '/unauthorized',
  children,
}: RoleGuardProps) {
  const { role, isReady } = useAuth();

  // While the session is being read, don't flash the fallback / redirect
  // — show a tiny loading state. This is especially important on the
  // first paint after a page refresh.
  if (!isReady) {
    return <div className="loading">Loading…</div>;
  }

  if (!role || !allowedRoles.includes(role)) {
    if (redirectTo) {
      return <Navigate to={redirectTo} replace />;
    }
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
