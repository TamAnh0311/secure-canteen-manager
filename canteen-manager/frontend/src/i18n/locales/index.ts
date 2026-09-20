// Assembles the i18next `resources` tree from one TS module per namespace per
// language. Adding a namespace = add it here + create both vi/en files.

import viCommon from './vi/common';
import viAuth from './vi/auth';
import viDashboard from './vi/dashboard';
import viMenu from './vi/menu';
import viVerify from './vi/verify';
import viOrders from './vi/orders';
import viScan from './vi/scan';
import viUsers from './vi/users';
import viKitchen from './vi/kitchen';
import viFormPrint from './vi/formPrint';
import viErrors from './vi/errors';
import viCounter from './vi/counter';
import viCanteen from './vi/canteen';
import viAccounts from './vi/accounts';
import viPaymentConfig from './vi/paymentConfig';
import viVouchers from './vi/vouchers';
import viOrderForm from './vi/orderForm';
import viScanUpload from './vi/scanUpload';
import viOperators from './vi/operators';
import viAuditLog from './vi/auditLog';
import viFinancialReport from './vi/financialReport';

import enCommon from './en/common';
import enAuth from './en/auth';
import enDashboard from './en/dashboard';
import enMenu from './en/menu';
import enVerify from './en/verify';
import enOrders from './en/orders';
import enScan from './en/scan';
import enUsers from './en/users';
import enKitchen from './en/kitchen';
import enFormPrint from './en/formPrint';
import enErrors from './en/errors';
import enCounter from './en/counter';
import enCanteen from './en/canteen';
import enAccounts from './en/accounts';
import enPaymentConfig from './en/paymentConfig';
import enVouchers from './en/vouchers';
import enOrderForm from './en/orderForm';
import enScanUpload from './en/scanUpload';
import enOperators from './en/operators';
import enAuditLog from './en/auditLog';
import enFinancialReport from './en/financialReport';

export const NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'menu',
  'verify',
  'orders',
  'scan',
  'users',
  'kitchen',
  'formPrint',
  'errors',
  'counter',
  'canteen',
  'accounts',
  'paymentConfig',
  'vouchers',
  'orderForm',
  'scanUpload',
  'operators',
  'auditLog',
  'financialReport',
] as const;

export const DEFAULT_NAMESPACE = 'common';

export const resources = {
  vi: {
    common: viCommon,
    auth: viAuth,
    dashboard: viDashboard,
    menu: viMenu,
    verify: viVerify,
    orders: viOrders,
    scan: viScan,
    users: viUsers,
    kitchen: viKitchen,
    formPrint: viFormPrint,
    errors: viErrors,
    counter: viCounter,
    canteen: viCanteen,
    accounts: viAccounts,
    paymentConfig: viPaymentConfig,
    vouchers: viVouchers,
    orderForm: viOrderForm,
    scanUpload: viScanUpload,
    operators: viOperators,
    auditLog: viAuditLog,
    financialReport: viFinancialReport,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    menu: enMenu,
    verify: enVerify,
    orders: enOrders,
    scan: enScan,
    users: enUsers,
    kitchen: enKitchen,
    formPrint: enFormPrint,
    errors: enErrors,
    counter: enCounter,
    canteen: enCanteen,
    accounts: enAccounts,
    paymentConfig: enPaymentConfig,
    vouchers: enVouchers,
    orderForm: enOrderForm,
    scanUpload: enScanUpload,
    operators: enOperators,
    auditLog: enAuditLog,
    financialReport: enFinancialReport,
  },
} as const;
