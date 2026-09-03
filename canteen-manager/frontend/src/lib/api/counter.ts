import { apiFetch } from '@/lib/api-client';
import type { OrderWithItems, PendingOrder, PrisonerLookup } from '@/lib/types';

export function lookupPrisoner(prisonId: string): Promise<PrisonerLookup> {
  return apiFetch<PrisonerLookup>(
    `/counter/prisoner/${encodeURIComponent(prisonId)}`,
  );
}

export interface CreateTopupBody {
  prisonId: string;
  // Integer VND. Must satisfy 0 < amount <= 1_000_000_000.
  amount: number;
  method: 'cash' | 'bank';
  ref?: string;
}

export function createTopup(
  body: CreateTopupBody,
): Promise<{ userId: string; balance: number }> {
  return apiFetch<{ userId: string; balance: number }>('/counter/topups', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface CreateRelativeOrderBody {
  prisonId: string;
  // At least one line, each a global-active-menu uuid v4 + a 1..99 quantity; order buckets to today.
  items: { menuItemId: string; quantity: number }[];
  method: 'cash' | 'bank';
}

export function createRelativeOrder(
  body: CreateRelativeOrderBody,
): Promise<OrderWithItems> {
  return apiFetch<OrderWithItems>('/counter/relative-orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Cashier pending-approval queue: list relative orders awaiting a decision.
export function pendingOrders(): Promise<PendingOrder[]> {
  return apiFetch<PendingOrder[]>('/counter/pending-orders');
}

export interface AcceptOrderBody {
  // Omit to settle with the visitor's intended tender; supply to override.
  method?: 'cash' | 'bank';
  // Bank settlement extras, both optional. transferReference is free-text (bank txn id / last-4);
  // receivedAmount, when sent, must equal the order total or the backend rejects the accept.
  transferReference?: string;
  receivedAmount?: number;
}

export function acceptOrder(
  id: string,
  body: AcceptOrderBody = {},
): Promise<OrderWithItems> {
  return apiFetch<OrderWithItems>(
    `/counter/relative-orders/${encodeURIComponent(id)}/accept`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export interface RejectOrderBody {
  reason?: string;
}

export function rejectOrder(
  id: string,
  body: RejectOrderBody = {},
): Promise<OrderWithItems> {
  return apiFetch<OrderWithItems>(
    `/counter/relative-orders/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
