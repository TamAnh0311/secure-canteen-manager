import { apiFetch } from '@/lib/api-client';

export interface ScanProcessResult {
  formToken: string | null;
  mode: string | null;
  items: Array<{
    menuItemId: string;
    code: string;
    name: string;
    quantity: number;
  }>;
  orderId: string | null;
  status: 'created' | 'review_required' | 'no_items';
  warnings: string[];
}

export interface ScanHistoryItem {
  id: string;
  serviceDate: string;
  userId: string;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
}

export interface ScanStats {
  totalScans: number;
  ordersCreated: number;
  ordersPaid: number;
  totalRevenue: number;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function processScan(imageBase64: string): Promise<ScanProcessResult> {
  return apiFetch<ScanProcessResult>('/scan-local/process', {
    method: 'POST',
    body: JSON.stringify({ imageBase64 }),
  });
}

export function getHistory(params: { dateFrom?: string; dateTo?: string } = {}): Promise<ScanHistoryItem[]> {
  return apiFetch<ScanHistoryItem[]>(`/scan-local/history${qs(params)}`);
}

export function getStats(params: { dateFrom?: string; dateTo?: string } = {}): Promise<ScanStats> {
  return apiFetch<ScanStats>(`/scan-local/stats${qs(params)}`);
}
