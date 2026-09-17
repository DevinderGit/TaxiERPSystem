/**
 * Suspense fallback. Uses a small CSS spinner (no extra deps) so the
 * loading state feels native to the dark theme.
 */
export function LoadingFallback() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading__spinner" aria-hidden="true" />
      Loading…
    </div>
  );
}
