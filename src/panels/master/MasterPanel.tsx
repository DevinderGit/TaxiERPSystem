/**
 * Placeholder Master Panel. M3..M7 replace this with the real
 * Company Detail / Utilities / Customers / Rates / GST routes.
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
      <div className="card card--accent">
        <p>
          Company Detail (M3), Utilities (M4), Customers (M5), Rates (M6), and
          GST Management (M7) will mount their routes under{' '}
          <code>/master/*</code>.
        </p>
      </div>
    </main>
  );
}
