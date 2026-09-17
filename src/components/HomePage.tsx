import { Link } from 'react-router-dom';

/**
 * Landing page. Hero title + a card grid that doubles as the
 * secondary navigation — clicking a card jumps into the panel.
 * Each panel's M-number is shown as a small badge so the operator
 * always knows what's coming next.
 */
const PANELS = [
  {
    to: '/master',
    title: 'Master',
    blurb:
      'Company profile, customers, vehicles, rates, GST config. The reference data every other panel reads.',
    module: 'M3–M7',
  },
  {
    to: '/daily-work',
    title: 'Daily Work',
    blurb:
      'Duty slips, billing, change / cancel bill, PDF print. Where the operator spends most of the day.',
    module: 'M8–M11',
  },
  {
    to: '/accounts',
    title: 'Accounts',
    blurb: 'Ledger book and manual receipt / payment entries. Every financial event is auto-posted.',
    module: 'M12',
  },
  {
    to: '/reports',
    title: 'Reports',
    blurb:
      'Bill Cover, Bill Register, Duty Register — read-only SQL views rendered as printable tables.',
    module: 'M13',
  },
];

export function HomePage() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        Welcome to <span className="page-title__accent">Taxi ERP</span>
      </h1>
      <p className="page-subtitle">
        Your zero-cost operations platform for a single taxi fleet. Pick a panel
        to get started — each is loaded on demand so the first paint stays light.
      </p>

      <div className="card-grid">
        {PANELS.map((p) => (
          <Link key={p.to} to={p.to} className="card card--accent">
            <h3>{p.title}</h3>
            <p>{p.blurb}</p>
            <div style={{ marginTop: '0.75rem' }}>
              <span className="badge badge--muted">{p.module}</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
