import { apiFetch } from '@/lib/api-client';
import type { DeliveryVoucher, Order, OrderStatus, OrderWithItems } from '@/lib/types';

export interface ListOrdersParams {
  // Inclusive service_date bounds (YYYY-MM-DD). Caller defaults to today/today.
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  status?: OrderStatus;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function listOrders(params: ListOrdersParams = {}): Promise<Order[]> {
  const { dateFrom, dateTo, userId, status, limit, offset } = params;
  return apiFetch<Order[]>(
    `/orders${qs({
      dateFrom,
      dateTo,
      userId,
      status,
      limit: limit !== undefined ? String(limit) : undefined,
      offset: offset !== undefined ? String(offset) : undefined,
    })}`,
  );
}

export function getOrder(id: string): Promise<OrderWithItems> {
  return apiFetch<OrderWithItems>(`/orders/${id}`);
}

// ADMIN-only batch of delivery vouchers for a service date (defaults to today
// server-side). Returns every PAID active voucher; the page filters zone/cell
// client-side from the result set.
export function getDeliveryVouchers(params: { date?: string } = {}): Promise<DeliveryVoucher[]> {
  return apiFetch<DeliveryVoucher[]>(`/orders/vouchers${qs({ date: params.date })}`);
}
