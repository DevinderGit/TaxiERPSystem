/**
 * Placeholder login page. The real email + password form lands in
 * TAXI-204 (M2). For now this just announces where the real form will
 * be, using the same shell every panel page uses.
 */
export function LoginPage() {
  return (
    <main className="app-main">
      <h1 className="page-title">Login</h1>
      <p className="page-subtitle">Sign in to access the panels.</p>
      <div className="card card--accent">
        <p>
          Email + password form with React Hook Form + Zod arrives in{' '}
          <strong>TAXI-204</strong>. For now any user can reach any page —
          RoleGuard lands in M2.
        </p>
      </div>
    </main>
  );
}
