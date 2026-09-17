import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        404 <span className="page-title__accent">— Not Found</span>
      </h1>
      <p className="page-subtitle">
        That URL doesn't match any panel in this app.
      </p>
      <div className="card card--accent">
        <p>
          Try the <Link to="/">home page</Link> or use the top navigation to
          jump into a panel.
        </p>
      </div>
    </main>
  );
}
