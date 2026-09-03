import { apiFetch } from '@/lib/api-client';
import type { PurchaseLimitConfiguration } from '@/lib/types';

export function getPurchaseLimits(): Promise<PurchaseLimitConfiguration> {
  return apiFetch<PurchaseLimitConfiguration>('/config/purchase-limits');
}

export function updatePurchaseLimits(body: PurchaseLimitConfiguration): Promise<PurchaseLimitConfiguration> {
  return apiFetch<PurchaseLimitConfiguration>('/config/purchase-limits', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
