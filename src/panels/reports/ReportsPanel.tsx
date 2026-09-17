export function ReportsPanel() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        Reports <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Read-only SQL views — Bill Cover, Bill Register, Duty Register.
      </p>
      <div className="card card--accent">
        <p>
          Three reports (M13) will mount under <code>/reports/*</code>, each
          backed by a saved view in the <code>reports</code> schema.
        </p>
      </div>
    </main>
  );
}
