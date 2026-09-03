import { apiFetch } from '@/lib/api-client';
import type { KioskPrisonerView } from '@/lib/types';

export function getPrisonerView(prisonId: string): Promise<KioskPrisonerView> {
  return apiFetch<KioskPrisonerView>(
    `/kiosk/prisoner/${encodeURIComponent(prisonId)}`,
  );
}

// One relative kiosk order against the global menu. The backend buckets it to
// today and creates it pending (unpaid); a cashier settles it later, so no money
// moves here.
export interface PlaceKioskOrderBody {
  prisonId: string;
  // At least one line, each a global-active-menu uuid v4 + a 1..99 quantity.
  items: { menuItemId: string; quantity: number }[];
  method: 'cash' | 'bank';
}

// Offline VietQR transfer details for a bank order, built server-side with no network. The
// amount lives ONLY here (there is no top-level amount); balance is never present. Absent for
// cash orders and for a bank order placed while the canteen account is unconfigured.
export interface KioskBankTransfer {
  // EMVCo VietQR string to render as a QR client-side (no CDN, no image fetch).
  qrPayload: string;
  accountName: string;
  accountNumber: string;
  amount: number;
  memo: string;
}

// confirmationCode is display-only (an orderId slice) the visitor shows the
// cashier — it is not stored and not a lookup key.
export interface KioskOrderResult {
  orderId: string;
  confirmationCode: string;
  bankTransfer?: KioskBankTransfer;
}

export function placeOrder(body: PlaceKioskOrderBody): Promise<KioskOrderResult> {
  return apiFetch<KioskOrderResult>('/kiosk/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
