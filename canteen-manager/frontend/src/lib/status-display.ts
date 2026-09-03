import type { OrderStatus, SheetStatus, SyncStatus } from '@/lib/types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusDisplay {
  tone: Tone;
  key: string;
}

export function sheetStatusDisplay(s: SheetStatus): StatusDisplay {
  switch (s) {
    case 'pending':      return { tone: 'info',    key: 'status.sheet.pending' };
    case 'processing':   return { tone: 'info',    key: 'status.sheet.processing' };
    case 'auto_accepted':return { tone: 'success', key: 'status.sheet.autoAccepted' };
    case 'verified':     return { tone: 'success', key: 'status.sheet.verified' };
    case 'flagged':      return { tone: 'warning', key: 'status.sheet.flagged' };
    case 'rejected':     return { tone: 'danger',  key: 'status.sheet.rejected' };
  }
}

export function orderStatusDisplay(s: OrderStatus): StatusDisplay {
  switch (s) {
    case 'active':     return { tone: 'success', key: 'status.order.active' };
    case 'superseded': return { tone: 'neutral', key: 'status.order.superseded' };
    case 'rejected':   return { tone: 'danger',  key: 'status.order.rejected' };
  }
}

export function syncStatusDisplay(s: SyncStatus): StatusDisplay {
  switch (s) {
    case 'running': return { tone: 'info',    key: 'status.sync.running' };
    case 'success': return { tone: 'success', key: 'status.sync.success' };
    case 'failed':  return { tone: 'danger',  key: 'status.sync.failed' };
  }
}
