import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingFallback } from './LoadingFallback';
import { HomePage } from './HomePage';
import { NotFoundPage } from './NotFoundPage';
import { RequireAuth } from './RequireAuth';
import { RoleGuard } from './RoleGuard';

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
 * user navigates there.
 *
 * Layout:
 *   /,/login,/unauthorized         — public
 *   /master/*,/daily-work/*,etc.   — RequireAuth (TAXI-204)
 *   /settings/users                — RequireAuth + RoleGuard owner-only (TAXI-205)
 */

const LoginPage = lazy(() => import('../panels/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const UnauthorizedPage = lazy(() =>
  import('../panels/auth/UnauthorizedPage').then((m) => ({ default: m.UnauthorizedPage })),
);
const MasterPanel = lazy(() =>
  import('../panels/master/MasterPanel').then((m) => ({ default: m.MasterPanel })),
);
const CompanyDetailPage = lazy(() =>
  import('../panels/master/CompanyDetailPage').then((m) => ({
    default: m.CompanyDetailPage,
  })),
);
const UtilitiesPage = lazy(() =>
  import('../panels/master/UtilitiesPage').then((m) => ({
    default: m.UtilitiesPage,
  })),
);
const CustomersPage = lazy(() =>
  import('../panels/master/CustomersPage').then((m) => ({
    default: m.CustomersPage,
  })),
);
const RateManagementPage = lazy(() =>
  import('../panels/master/RateManagementPage').then((m) => ({
    default: m.RateManagementPage,
  })),
);
const GstManagementPage = lazy(() =>
  import('../panels/master/GstManagementPage').then((m) => ({
    default: m.GstManagementPage,
  })),
);
const DutySlipListPage = lazy(() =>
  import('../panels/dailywork/DutySlipListPage').then((m) => ({
    default: m.DutySlipListPage,
  })),
);
const BillingPage = lazy(() =>
  import('../panels/dailywork/BillingPage').then((m) => ({
    default: m.BillingPage,
  })),
);
const ChangeCancelBillPage = lazy(() =>
  import('../panels/dailywork/ChangeCancelBillPage').then((m) => ({
    default: m.ChangeCancelBillPage,
  })),
);
const DailyWorkPanel = lazy(() =>
  import('../panels/dailywork/DailyWorkPanel').then((m) => ({ default: m.DailyWorkPanel })),
);
const AccountsPanel = lazy(() =>
  import('../panels/accounts/AccountsPanel').then((m) => ({ default: m.AccountsPanel })),
);
const LedgerBookPage = lazy(() =>
  import('../panels/accounts/LedgerBookPage').then((m) => ({ default: m.LedgerBookPage })),
);
const ReportsPanel = lazy(() =>
  import('../panels/reports/ReportsPanel').then((m) => ({ default: m.ReportsPanel })),
);
const UserManagementPage = lazy(() =>
  import('../panels/settings/UserManagementPage').then((m) => ({ default: m.UserManagementPage })),
);
const PrintPage = lazy(() =>
  import('../panels/dailywork/PrintPage').then((m) => ({ default: m.PrintPage })),
);

export function AppRouter() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        {/* Protected panel routes — RequireAuth bounces unauthenticated
            users to /login with a `from` state. */}
        <Route element={<RequireAuth />}>
          <Route path="/master" element={<MasterPanel />} />
          <Route path="/master/company" element={<CompanyDetailPage />} />
          <Route path="/master/utilities" element={<UtilitiesPage />} />
          <Route path="/master/customers" element={<CustomersPage />} />
          <Route path="/master/rates" element={<RateManagementPage />} />
          <Route path="/master/gst" element={<GstManagementPage />} />
          <Route path="/daily-work" element={<DailyWorkPanel />} />
          <Route path="/daily-work/duty-slips" element={<DutySlipListPage />} />
          <Route path="/daily-work/billing" element={<BillingPage />} />
          <Route path="/daily-work/change-cancel-bill" element={<ChangeCancelBillPage />} />
          <Route path="/daily-work/print" element={<PrintPage />} />
          <Route path="/daily-work/*" element={<DailyWorkPanel />} />
          <Route path="/accounts" element={<AccountsPanel />} />
          <Route path="/accounts/ledger" element={<LedgerBookPage />} />
          <Route path="/accounts/*" element={<AccountsPanel />} />
          <Route path="/reports/*" element={<ReportsPanel />} />
          <Route
            path="/settings/users"
            element={
              <RoleGuard allowedRoles={['owner']} redirectTo="/unauthorized">
                <UserManagementPage />
              </RoleGuard>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
