import { NavLink } from 'react-router-dom';

/**
 * Master Panel — overview / landing page.
 *
 * Sub-routes (/master/company, /master/utilities, …) are defined as
 * separate routes in AppRouter so each one gets its own lazy-loaded
 * chunk (this is the pattern UserManagementPage already uses for
 * /settings/users).
 *
 * M3..M7 add: Company Detail (M3), Utilities (M4), Customers (M5),
 * Rates (M6), GST Management (M7).
 */
export function MasterPanel() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        Master <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Reference data — company, customers, vehicles, rates, GST config.
      </p>

      <nav className="sub-nav" aria-label="Master sections" style={subNavStyle}>
        <NavLink to="/master/company" style={subNavLinkStyle}>
          Company Detail
        </NavLink>
        <NavLink to="/master/utilities" style={subNavLinkStyle}>
          Utilities
        </NavLink>
      </nav>

      <div className="card card--accent" style={{ marginTop: '1.5rem' }}>
        <h3>Welcome</h3>
        <p>
          Pick a section above. <strong>Company Detail</strong> is live in
          M3 (TAXI-301). <strong>Utilities</strong> shell ships in M4
          (TAXI-401); the Vehicles and Doc No. Control tabs fill in over
          TAXI-402..405. Customers (M5), Rates (M6), and GST Management
          (M7) will mount their routes here as they ship.
        </p>
      </div>
    </main>
  );
}

const subNavStyle = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap' as const,
  marginBottom: '0.25rem',
};

const subNavLinkStyle = {
  padding: '0.45rem 0.85rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-muted)',
  fontWeight: 500,
  fontSize: '0.9rem',
  textDecoration: 'none',
};
