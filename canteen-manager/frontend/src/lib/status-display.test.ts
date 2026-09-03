import { describe, it, expect } from 'vitest';
import {
  sheetStatusDisplay,
  orderStatusDisplay,
  syncStatusDisplay,
} from './status-display';
import type { SheetStatus, OrderStatus, SyncStatus } from './types';

describe('sheetStatusDisplay', () => {
  const cases: [SheetStatus, string, string][] = [
    ['pending',       'info',    'status.sheet.pending'],
    ['processing',    'info',    'status.sheet.processing'],
    ['auto_accepted', 'success', 'status.sheet.autoAccepted'],
    ['verified',      'success', 'status.sheet.verified'],
    ['flagged',       'warning', 'status.sheet.flagged'],
    ['rejected',      'danger',  'status.sheet.rejected'],
  ];

  it.each(cases)('%s → tone=%s key=%s', (status, tone, key) => {
    const result = sheetStatusDisplay(status);
    expect(result.tone).toBe(tone);
    expect(result.key).toBe(key);
  });

  it('covers all SheetStatus values without falling through', () => {
    const allStatuses: SheetStatus[] = [
      'pending', 'processing', 'auto_accepted', 'verified', 'flagged', 'rejected',
    ];
    for (const s of allStatuses) {
      expect(sheetStatusDisplay(s).key.length).toBeGreaterThan(0);
    }
  });
});

describe('orderStatusDisplay', () => {
  const cases: [OrderStatus, string, string][] = [
    ['active',     'success', 'status.order.active'],
    ['superseded', 'neutral', 'status.order.superseded'],
    ['rejected',   'danger',  'status.order.rejected'],
  ];

  it.each(cases)('%s → tone=%s key=%s', (status, tone, key) => {
    const result = orderStatusDisplay(status);
    expect(result.tone).toBe(tone);
    expect(result.key).toBe(key);
  });
});

describe('syncStatusDisplay', () => {
  const cases: [SyncStatus, string, string][] = [
    ['running', 'info',    'status.sync.running'],
    ['success', 'success', 'status.sync.success'],
    ['failed',  'danger',  'status.sync.failed'],
  ];

  it.each(cases)('%s → tone=%s key=%s', (status, tone, key) => {
    const result = syncStatusDisplay(status);
    expect(result.tone).toBe(tone);
    expect(result.key).toBe(key);
  });
});
