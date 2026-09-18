import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ManageTaxonomy } from './ManageTaxonomy';
import { VehicleList } from './VehicleList';
import { DocumentSequenceList } from './DocumentSequenceList';

/**
 * Utilities page shell (TAXI-401).
 *
 * Two tabs — Manage Vehicles and Document No. Control — surfaced via
 * the URL hash so the active tab survives a refresh and is shareable
 * via copy/paste:
 *   /master/utilities            → defaults to #vehicles
 *   /master/utilities#vehicles   → Manage Vehicles tab
 *   /master/utilities#doc-seq    → Document No. Control tab
 *
 * The tab content is placeholder for now. M4 fills it in:
 *   - TAXI-402 → Vehicle Groups + Types CRUD inside the Vehicles tab
 *   - TAXI-403 → Vehicle CRUD list inside the Vehicles tab
 *   - TAXI-404 → Document No. Control table inside the Doc No. tab
 *   - TAXI-405 → integration check that the doc sequences drive duty_slip / bill numbering
 *
 * Route: /master/utilities (TAXI-401). Same RequireAuth wrap as the
 * other /master/* routes in AppRouter.
 */

type TabKey = 'vehicles' | 'doc-seq';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'vehicles', label: 'Manage Vehicles' },
  { key: 'doc-seq', label: 'Document No. Control' },
];

function activeTabFromHash(hash: string): TabKey {
  // URL hash is "#vehicles" or "#doc-seq"; default to vehicles when
  // empty or unknown so a typo doesn't strand the user on a blank tab.
  const stripped = hash.replace(/^#/, '');
  return stripped === 'doc-seq' ? 'doc-seq' : 'vehicles';
}

export function UtilitiesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = activeTabFromHash(location.hash);

  const goTo = (key: TabKey) => {
    navigate(`/master/utilities#${key}`, { replace: false });
  };

  return (
    <main className="app-main">
      <Link to="/master" className="back-link">
        ← Back to Master
      </Link>
      <h1 className="page-title">
        Utilities <span className="page-title__accent">— Master</span>
      </h1>
      <p className="page-subtitle">
        Vehicle taxonomy, vehicle list, and document-number sequences.
      </p>

      <nav
        role="tablist"
        aria-label="Utilities sections"
        style={{
          display: 'flex',
          gap: '0.25rem',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: '1.5rem',
        }}
      >
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => goTo(t.key)}
              style={{
                padding: '0.55rem 1rem',
                border: 'none',
                borderBottom: isActive ? '3px solid var(--color-accent)' : '3px solid transparent',
                background: 'transparent',
                color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.95rem',
                cursor: 'pointer',
                marginBottom: '-1px',
                transition: 'color 120ms, border-color 120ms',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {active === 'vehicles' ? <VehiclesTab /> : <DocSeqTab />}
    </main>
  );
}

function VehiclesTab() {
  return (
    <>
      <ManageTaxonomy />
      <VehicleList />
    </>
  );
}

function DocSeqTab() {
  return <DocumentSequenceList />;
}
