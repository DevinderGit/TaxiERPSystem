import { NavLink } from 'react-router-dom';

/**
 * DailyWorkPanel — landing page for the /daily-work/* routes.
 *
 * Sub-routes are added as they ship: Duty Slips (M8), Billing (M9).
 */
export function DailyWorkPanel() {
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
        Daily Work <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Where the operator spends most of the day.
      </p>

      <nav className="sub-nav" aria-label="Daily work sections" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <NavLink to="/daily-work/duty-slips" style={linkStyle}>Duty Slips</NavLink>
        <NavLink to="/daily-work/billing" style={linkStyle}>Billing</NavLink>
        <NavLink to="/daily-work/change-cancel-bill" style={linkStyle}>Change / Cancel Bill</NavLink>
      </nav>

      <div className="card card--accent">
        <p>
          Print Bill / Duty Slip as PDF (M11) will mount under{' '}
          <code>/daily-work/*</code>.
        </p>
      </div>
    </main>
  );
}
