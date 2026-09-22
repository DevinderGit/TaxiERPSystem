import { NavLink } from 'react-router-dom';

/**
 * DailyWorkPanel — landing page for the /daily-work/* routes.
 *
 * Sub-routes: Duty Slips (M8), Billing (M9), Change / Cancel Bill
 * (M10), Print Bill / Duty Slip (M11).
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
        <NavLink to="/daily-work/print" style={linkStyle}>Print Bill / Duty Slip</NavLink>
      </nav>

      <div className="card card--accent">
        <p>
          Open <NavLink to="/daily-work/print" style={{ color: 'var(--color-accent)' }}>/daily-work/print</NavLink> to preview a Bill or Duty Slip PDF by number, or use the inline Print button on each row in the lists above.
        </p>
      </div>
    </main>
  );
}
