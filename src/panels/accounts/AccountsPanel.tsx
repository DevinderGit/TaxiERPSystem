import { NavLink } from 'react-router-dom';

/**
 * AccountsPanel — landing page for the /accounts/* routes.
 *
 * Sub-routes added as they ship: Ledger Book (M12).
 */
export function AccountsPanel() {
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
        Accounts <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Ledger book, manual receipt and payment entries.
      </p>

      <nav
        className="sub-nav"
        aria-label="Accounts sections"
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        <NavLink to="/accounts/ledger" style={linkStyle}>
          Ledger Book
        </NavLink>
      </nav>

      <div className="card card--accent">
        <p>
          Open{' '}
          <NavLink to="/accounts/ledger" style={{ color: 'var(--color-accent)' }}>
            /accounts/ledger
          </NavLink>{' '}
          to view a bill summary by bill-number range, or print it as
          a PDF.
        </p>
      </div>
    </main>
  );
}
