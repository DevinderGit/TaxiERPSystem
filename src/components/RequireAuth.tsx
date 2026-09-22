import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * RequireAuth — route guard. Wraps protected routes so unauthenticated
 * users are sent to /login with a `from` state so we can bounce them
 * back to the page they originally wanted after sign-in.
 *
 * Per Code Architecture spec §4.1 ("AppRouter"): "Maps URLs to lazy-loaded
 * panel modules; gates each route behind RoleGuard and a feature-flag
 * check." RoleGuard is per-role; RequireAuth is the looser outer guard
 * (any logged-in user). Both stack on protected routes in AppRouter.
 *
 * Shown while the session is being read: a tiny loading state. This
 * prevents a flash of the login redirect on hard refresh.
 */
export function RequireAuth() {
  const { user, isReady } = useAuth();
  const location = useLocation();

  if (!isReady) {
    return <div className="loading">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
