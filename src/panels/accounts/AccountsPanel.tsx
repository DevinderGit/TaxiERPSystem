export function AccountsPanel() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        Accounts <span className="page-title__accent">Panel</span>
      </h1>
      <p className="page-subtitle">
        Ledger book, manual receipt and payment entries.
      </p>
      <div className="card card--accent">
        <p>
          The Ledger Book page (M12) will mount here, reading from{' '}
          <code>accounts.ledger_entries</code>.
        </p>
      </div>
    </main>
  );
}
