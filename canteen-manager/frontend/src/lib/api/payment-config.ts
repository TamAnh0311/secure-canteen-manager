import { apiFetch } from '@/lib/api-client';

// The single canteen bank account the kiosk renders as an offline VietQR. On read the account
// number is masked to last-4 (server-side); changing it requires re-entering the full number,
// which doubles as the confirm-the-change step. isConfigured drives the kiosk bank tender.
export interface PaymentConfigView {
  bankBin: string | null;
  accountNumber: string | null;
  accountName: string | null;
  isConfigured: boolean;
}

// All fields optional on the wire; the page sends the full set on save. The backend validates the
// BIN (6 digits + NAPAS allowlist), account number (6-19 digits) and ascii-folds the name.
export interface UpdatePaymentConfigBody {
  bankBin?: string;
  accountNumber?: string;
  accountName?: string;
}

export function getPaymentConfig(): Promise<PaymentConfigView> {
  return apiFetch<PaymentConfigView>('/config/payment');
}

export function updatePaymentConfig(
  body: UpdatePaymentConfigBody,
): Promise<PaymentConfigView> {
  return apiFetch<PaymentConfigView>('/config/payment', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
