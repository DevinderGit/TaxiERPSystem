import { Link } from 'react-router-dom';

export function UnauthorizedPage() {
  return (
    <main className="app-main">
      <h1 className="page-title">
        403 <span className="page-title__accent">— Unauthorized</span>
      </h1>
      <p className="page-subtitle">
        Your role doesn't allow access to that page.
      </p>
      <div className="card card--accent">
        <p>
          Head back to the <Link to="/">home page</Link> or pick a panel you
          have access to.
        </p>
      </div>
    </main>
  );
}
