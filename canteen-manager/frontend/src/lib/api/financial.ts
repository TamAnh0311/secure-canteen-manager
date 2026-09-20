import { apiFetch } from '@/lib/api-client';

export interface FinancialReport {
  dateFrom: string;
  dateTo: string;
  totals: {
    paidOrders: number;
    paidRevenue: number;
    unpaidOrders: number;
    unpaidAmount: number;
  };
  bySource: Array<{ source: string; orderCount: number; revenue: number }>;
  byMethod: Array<{ method: string; orderCount: number; revenue: number }>;
  byCategory: Array<{ category: string; totalQuantity: number; revenue: number }>;
  daily: Array<{ date: string; orderCount: number; revenue: number }>;
}

/** Fetch the financial report for a date range. Admin-only. */
export function getFinancialReport(dateFrom: string, dateTo: string): Promise<FinancialReport> {
  return apiFetch<FinancialReport>(
    `/orders/financial-report?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
  );
}
