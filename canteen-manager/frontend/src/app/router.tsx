import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/app/shell/app-shell';
import { ProtectedRoute, AdminRoute, RoleRoute } from '@/app/protected-route';
import { LoginPage } from '@/features/auth/login/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { OrdersPage } from '@/features/orders/orders-page';
import { KitchenSummaryPage } from '@/features/kitchen-summary/kitchen-summary-page';
import { MenuConfigPage } from '@/features/menu-config/menu-config-page';
import { UsersPage } from '@/features/users/users-page';
import { CounterPage } from '@/features/counter/counter-page';
import { CanteenPage } from '@/features/canteen/canteen-page';
import { AccountsAuditPage } from '@/features/accounts/accounts-audit-page';
import { PaymentConfigPage } from '@/features/payment-config/payment-config-page';
import { VouchersPage } from '@/features/vouchers/vouchers-page';
import { OperatorsPage } from '@/features/operators/operators-page';
import { PhoneScanPage } from '@/features/phone-scan/phone-scan-page';
import { ScanMonitorPage } from '@/features/scan-monitor/scan-monitor-page';
import { FormPrintPage } from '@/features/form-print/form-print-page';
import { DataSyncPage } from '@/features/data-sync/data-sync-page';
import { AuditLogPage } from '@/features/audit-log/audit-log-page';
import { FinancialReportPage } from '@/features/financial-report/financial-report-page';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    // Public, no auth — relatives browse prisoner menus without logging in.
    path: '/canteen',
    element: <CanteenPage />,
  },
  {
    // Public, no auth — mobile phone scan page.
    path: '/scan',
    element: <PhoneScanPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard',       element: <DashboardPage /> },
          { path: 'orders',          element: <OrdersPage /> },
          { path: 'scan-monitor',   element: <ScanMonitorPage /> },
          { path: 'kitchen-summary', element: <KitchenSummaryPage /> },
          { path: 'prisoner',        element: <UsersPage /> },
          // Back-compat: old /users path redirects to the renamed /prisoner screen.
          { path: 'users',           element: <Navigate to="/prisoner" replace /> },
          {
            element: <AdminRoute />,
            children: [
              { path: 'menu',           element: <MenuConfigPage /> },
              { path: 'form-print',     element: <FormPrintPage /> },
              { path: 'data-sync',      element: <DataSyncPage /> },
              { path: 'audit',          element: <AccountsAuditPage /> },
              { path: 'payment-config', element: <PaymentConfigPage /> },
              { path: 'vouchers',       element: <VouchersPage /> },
              { path: 'operators',      element: <OperatorsPage /> },
              { path: 'audit-log',     element: <AuditLogPage /> },
              { path: 'financial',    element: <FinancialReportPage /> },
            ],
          },
          {
            element: <RoleRoute roles={['cashier', 'admin']} />,
            children: [
              { path: 'counter', element: <CounterPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
