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

export function processScan(imageBase64: string): Promise<ScanProcessResult> {
  return apiFetch<ScanProcessResult>('/scan-local/process', {
    method: 'POST',
    body: JSON.stringify({ imageBase64 }),
  });
}
