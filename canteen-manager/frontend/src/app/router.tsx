import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/app/shell/app-shell';
import { ProtectedRoute, AdminRoute, RoleRoute } from '@/app/protected-route';
import { LoginPage } from '@/features/auth/login/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { ScanMonitorPage } from '@/features/scan-monitor/scan-monitor-page';
import { VerifyPage } from '@/features/verify/verify-page';
import { OrdersPage } from '@/features/orders/orders-page';
import { KitchenSummaryPage } from '@/features/kitchen-summary/kitchen-summary-page';
import { MenuConfigPage } from '@/features/menu-config/menu-config-page';
import { FormPrintPage } from '@/features/form-print/form-print-page';
import { UsersPage } from '@/features/users/users-page';
import { CounterPage } from '@/features/counter/counter-page';
import { KioskPage } from '@/features/kiosk/kiosk-page';
import { AccountsAuditPage } from '@/features/accounts/accounts-audit-page';
import { PaymentConfigPage } from '@/features/payment-config/payment-config-page';
import { VouchersPage } from '@/features/vouchers/vouchers-page';
import { OrderFormPage } from '@/features/order-form/order-form-page';
import { ScanUploadPage } from '@/features/scan-upload/scan-upload-page';
import { OperatorsPage } from '@/features/operators/operators-page';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    // Public, no auth — relatives browse prisoner menus without logging in.
    path: '/kiosk',
    element: <KioskPage />,
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
          { path: 'kitchen-summary', element: <KitchenSummaryPage /> },
          { path: 'prisoner',        element: <UsersPage /> },
          // Back-compat: old /users path redirects to the renamed /prisoner screen.
          { path: 'users',           element: <Navigate to="/prisoner" replace /> },
          {
            element: <AdminRoute />,
            children: [
              { path: 'menu',           element: <MenuConfigPage /> },
              { path: 'form-print',     element: <FormPrintPage /> },
              { path: 'audit',          element: <AccountsAuditPage /> },
              { path: 'payment-config', element: <PaymentConfigPage /> },
              { path: 'vouchers',       element: <VouchersPage /> },
              { path: 'operators',      element: <OperatorsPage /> },
            ],
          },
          {
            element: <RoleRoute roles={['operator', 'admin']} />,
            children: [
              { path: 'scan-monitor', element: <ScanMonitorPage /> },
              { path: 'verify', element: <VerifyPage /> },
              { path: 'verify/:sheetId', element: <VerifyPage /> },
              { path: 'order-form', element: <OrderFormPage /> },
              { path: 'scan-upload', element: <ScanUploadPage /> },
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
