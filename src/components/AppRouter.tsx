import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingFallback } from './LoadingFallback';
import { HomePage } from './HomePage';
import { NotFoundPage } from './NotFoundPage';

/**
 * Route table per Code Architecture spec §4.1 (AppRouter).
 *
 * NOTE: This component does NOT render <BrowserRouter>. The router
 * lives in App.tsx so both <NavBar/> and the route elements share
 * one Router context. (Previously AppRouter had its own BrowserRouter,
 * which left NavBar outside the context and crashed NavLink.)
 *
 * Each panel module is React.lazy()-imported so Vite emits a separate
 * JS chunk per panel and the browser only fetches the chunk when the
 * user navigates there (Manual Test Plan step 9).
 */

// --- lazy panel imports ------------------------------------------------
const LoginPage = lazy(() => import('../panels/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const UnauthorizedPage = lazy(() =>
  import('../panels/auth/UnauthorizedPage').then((m) => ({ default: m.UnauthorizedPage })),
);
const MasterPanel = lazy(() =>
  import('../panels/master/MasterPanel').then((m) => ({ default: m.MasterPanel })),
);
const DailyWorkPanel = lazy(() =>
  import('../panels/dailywork/DailyWorkPanel').then((m) => ({ default: m.DailyWorkPanel })),
);
const AccountsPanel = lazy(() =>
  import('../panels/accounts/AccountsPanel').then((m) => ({ default: m.AccountsPanel })),
);
const ReportsPanel = lazy(() =>
  import('../panels/reports/ReportsPanel').then((m) => ({ default: m.ReportsPanel })),
);

export function AppRouter() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {/* Login page placeholder — TAXI-204 replaces with the real form */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/master/*" element={<MasterPanel />} />
        <Route path="/daily-work/*" element={<DailyWorkPanel />} />
        <Route path="/accounts/*" element={<AccountsPanel />} />
        <Route path="/reports/*" element={<ReportsPanel />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
