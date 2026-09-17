import { QueryClient } from '@tanstack/react-query';

/**
 * Root QueryClient — the only React Query cache in the SPA.
 *
 * Per Code Architecture spec §4.1 ("useEntityQuery"): auto-refetch on
 * window focus, default staleTime of 5 minutes. Mutations invalidate
 * queries by entity name (handled in `useEntityQuery`).
 *
 * Any panel page or form calls `useEntityQuery('customers')` etc. and
 * gets cached rows back. No other QueryClient should be instantiated —
 * singletons keep the cache consistent across the SPA.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 5 minutes — most operational data is read-heavy and updates
      // through explicit mutations that invalidate the relevant keys.
      staleTime: 5 * 60 * 1000,
      // Re-fetch when the user comes back to the tab. Catches duty-slip
      // edits from a different tab/operator without manual refresh.
      refetchOnWindowFocus: true,
      // One retry by default — PostgREST / network blips are common
      // in local dev; don't show the user a hard error on first failure.
      retry: 1,
    },
    mutations: {
      // Mutations are user-driven — don't retry silently or the user
      // sees nothing happen then sees a stale state.
      retry: 0,
    },
  },
});
