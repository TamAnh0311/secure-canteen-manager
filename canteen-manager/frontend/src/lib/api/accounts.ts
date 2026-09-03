import { apiFetch } from '@/lib/api-client';
import type { AccountTransaction } from '@/lib/types';

export interface AccountBalance {
  userId: string;
  balance: number;
}

export interface LedgerParams {
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

export function getBalance(userId: string): Promise<AccountBalance> {
  return apiFetch<AccountBalance>(`/accounts/${encodeURIComponent(userId)}/balance`);
}

export function getLedger(
  userId: string,
  params: LedgerParams = {},
): Promise<AccountTransaction[]> {
  const { limit, offset } = params;
  return apiFetch<AccountTransaction[]>(
    `/accounts/${encodeURIComponent(userId)}/ledger${qs({
      limit: limit !== undefined ? String(limit) : undefined,
      offset: offset !== undefined ? String(offset) : undefined,
    })}`,
  );
}
