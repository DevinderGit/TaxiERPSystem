import { NavLink } from 'react-router-dom';

/**
 * ReportsPanel — landing page for the /reports/* routes.
 *
 * Sub-routes added as they ship: Bill Cover (M13), Bill Register,
 * Duty Register.
 */
export function ReportsPanel() {
  const linkStyle = {
    padding: '0.45rem 0.85rem',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface-2)',
    color: 'var(--color-text-muted)',
    fontWeight: 500,
    fontSize: '0.9rem',
    textDecoration: 'none',
  };
  return (
    <main className="app-main">
      <h1 className="page-title">
        Reports <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Read-only SQL views — Bill Cover, Bill Register, Duty Register.
      </p>

      <nav
        className="sub-nav"
        aria-label="Report sections"
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        <NavLink to="/reports/bill-cover" style={linkStyle}>Bill Cover</NavLink>
        <NavLink to="/reports/bill-register" style={linkStyle}>Bill Register</NavLink>
        <NavLink to="/reports/duty-register" style={linkStyle}>Duty Register</NavLink>
      </nav>

      <div className="card card--accent">
        <p>
          Open{' '}
          <NavLink to="/reports/bill-cover" style={{ color: 'var(--color-accent)' }}>Bill Cover</NavLink>{' '}
          for a summary,{' '}
          <NavLink to="/reports/bill-register" style={{ color: 'var(--color-accent)' }}>Bill Register</NavLink>{' '}
          for the two-pane bill browser, or{' '}
          <NavLink to="/reports/duty-register" style={{ color: 'var(--color-accent)' }}>Duty Register</NavLink>{' '}
          for the duty-slip table.
        </p>
      </div>
    </main>
  );
}
