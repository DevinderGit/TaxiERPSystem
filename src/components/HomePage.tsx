import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Landing page.
 *
 * Behaviour:
 *   - Signed in → show the 4-card grid linking into the panels.
 *   - Not signed in → redirect to /login (carrying a `from` state so we
 *     can bounce back here once authenticated).
 *
 * This makes the login form the de-facto "first page" the operator sees
 * when opening the app cold.
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
    blurb:
      'Ledger book and manual receipt / payment entries. Every financial event is auto-posted.',
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
  const { user, isReady } = useAuth();
  const location = useLocation();

  // Hold routing decisions until AuthProvider has read the session; otherwise
  // a hard refresh on a deep link while signed out would flash the home grid
  // for a frame before the redirect fires.
  if (isReady && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

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
