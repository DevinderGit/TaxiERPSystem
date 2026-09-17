export function DailyWorkPanel() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        Daily Work <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Where the operator spends most of the day.
      </p>
      <div className="card card--accent">
        <p>
          Duty slips (M8), Billing (M9), Change / Cancel Bill (M10), and Print
          Bill / Duty Slip as PDF (M11) will mount under{' '}
          <code>/daily-work/*</code>.
        </p>
      </div>
    </main>
  );
}
