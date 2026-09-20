import { apiFetch } from '@/lib/api-client';
import type { CanteenPrisonerView } from '@/lib/types';

export function getPrisonerView(prisonId: string): Promise<CanteenPrisonerView> {
  return apiFetch<CanteenPrisonerView>(
    `/kiosk/prisoner/${encodeURIComponent(prisonId)}`,
  );
}

// One relative kiosk order against the global menu. The backend buckets it to
// today and creates it pending (unpaid); a cashier settles it later, so no money
// moves here.
export interface PlaceCanteenOrderBody {
  prisonId: string;
  // At least one line, each a global-active-menu uuid v4 + a 1..99 quantity.
  items: { menuItemId: string; quantity: number }[];
  method: 'cash' | 'bank';
}

// Offline VietQR transfer details for a bank order, built server-side with no network. The
// amount lives ONLY here (there is no top-level amount); balance is never present. Absent for
// cash orders and for a bank order placed while the canteen account is unconfigured.
export interface CanteenBankTransfer {
  // EMVCo VietQR string to render as a QR client-side (no CDN, no image fetch).
  qrPayload: string;
  accountName: string;
  accountNumber: string;
  amount: number;
  memo: string;
}

// confirmationCode is display-only (an orderId slice) the visitor shows the
// cashier — it is not stored and not a lookup key.
export interface CanteenOrderResult {
  orderId: string;
  confirmationCode: string;
  bankTransfer?: CanteenBankTransfer;
}

export function placeOrder(body: PlaceCanteenOrderBody): Promise<CanteenOrderResult> {
  return apiFetch<CanteenOrderResult>('/kiosk/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
