import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Top navigation bar. Sticky black nav with yellow rule.
 *
 * Auth-aware: when a user is signed in, renders a "Sign out" button on
 * the right. When signed out, hides it.
 */
export function NavBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link';

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <nav className="app-nav" aria-label="Primary">
      <span className="app-nav__brand">
        <span className="app-nav__brand-mark" aria-hidden="true">
          🚕
        </span>
        Taxi ERP
      </span>
      <NavLink to="/" end className={linkClass}>
        Home
      </NavLink>
      <NavLink to="/master" className={linkClass}>
        Master
      </NavLink>
      <NavLink to="/daily-work" className={linkClass}>
        Daily Work
      </NavLink>
      <NavLink to="/accounts" className={linkClass}>
        Accounts
      </NavLink>
      <NavLink to="/reports" className={linkClass}>
        Reports
      </NavLink>

      {user && (
        <button
          type="button"
          onClick={handleSignOut}
          className="app-nav__link app-nav__link--button"
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
          }}
        >
          Sign out
        </button>
      )}
    </nav>
  );
}
