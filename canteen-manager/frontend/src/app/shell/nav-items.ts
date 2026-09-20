import type { Role } from '@/lib/types';

export interface NavItem {
  id: string;
  path: string;
  icon: string;
  adminOnly?: boolean;
  // When set, only operators whose role is in this list can see this item.
  // adminOnly is checked first for backward compat; roles is the general gate.
  roles?: Role[];
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Operations',
    items: [
      { id: 'dashboard',       path: '/dashboard',       icon: '▤' },
      { id: 'orders',          path: '/orders',          icon: '☰' },
      { id: 'kitchen-summary', path: '/kitchen-summary', icon: '▥' },
      { id: 'counter',         path: '/counter',         icon: '₫', roles: ['cashier', 'admin'] },
      { id: 'scan-monitor',    path: '/scan-monitor',   icon: '⎙' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { id: 'menu',           path: '/menu',           icon: '☰', adminOnly: true },
      { id: 'form-print',     path: '/form-print',     icon: '⎗', adminOnly: true },
      { id: 'data-sync',      path: '/data-sync',      icon: '⇄', adminOnly: true },
      { id: 'audit',          path: '/audit',          icon: '₿', adminOnly: true },
      { id: 'payment-config', path: '/payment-config', icon: '◈', adminOnly: true },
      { id: 'vouchers',       path: '/vouchers',       icon: '⎙', adminOnly: true },
      { id: 'operators',      path: '/operators',      icon: '♙', adminOnly: true },
      { id: 'financial',     path: '/financial',     icon: '📊', adminOnly: true },
      { id: 'audit-log',     path: '/audit-log',     icon: '⏱', adminOnly: true },
      { id: 'users',          path: '/prisoner',       icon: '◍' },
    ],
  },
];
