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
        <NavLink to="/master/customers" style={subNavLinkStyle}>
          Customers
        </NavLink>
        <NavLink to="/master/rates" style={subNavLinkStyle}>
          Rates
        </NavLink>
      </nav>

      <div className="card card--accent" style={{ marginTop: '1.5rem' }}>
        <h3>Welcome</h3>
        <p>
          Pick a section above. <strong>Company Detail</strong> is live in
          M3 (TAXI-301). <strong>Utilities</strong> is live in M4
          (TAXI-401–405). <strong>Customers</strong> is live in M5
          (TAXI-501–504). <strong>Rates</strong> shell ships in M6
          (TAXI-601); the rate matrix CRUD lands in TAXI-602. GST
          Management (M7) will mount its route here as it ships.
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
