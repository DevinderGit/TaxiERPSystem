import { NavLink } from 'react-router-dom';

/**
 * Top navigation bar. Sticky under a 3px yellow rule that doubles as
 * the brand accent. The brand mark on the left uses a taxi emoji so
 * the Black/Yellow Cab theme is unmistakable even at a glance.
 *
 * Each link uses NavLink so React Router applies the active class.
 * Active link is filled yellow with dark text — high contrast, clear
 * affordance for the current panel.
 */
export function NavBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link';

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
    </nav>
  );
}
