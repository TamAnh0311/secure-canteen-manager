import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/lib/format';
import { Button, Card } from '@/ui';
import type { CanteenBankTransfer } from '@/lib/api/kiosk';

interface BankQrScreenProps {
  transfer: CanteenBankTransfer;
  confirmationCode: string;
  onReset: () => void;
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-fg">{label}</span>
      <span className={['text-base font-semibold text-right break-all', mono ? 'font-mono' : ''].join(' ')}>
        {value}
      </span>
    </div>
  );
}

/**
 * Offline bank-transfer screen shown after a bank order. The VietQR is rendered locally as a
 * pure-SVG QR (react-qr-code, zero network) from the server-built payload — no CDN, no image
 * fetch. The visitor transfers the exact amount + content to the displayed account, then sees the
 * cashier, who reconciles manually by amount + name. No balance is ever shown.
 */
export function BankQrScreen({ transfer, confirmationCode, onReset }: BankQrScreenProps) {
  const { t } = useTranslation('canteen');

  return (
    <div className="flex flex-col items-center gap-6 py-4 w-full">
      <h2 className="text-xl font-bold text-center">{t('bankTransferTitle')}</h2>

      {/* White quiet-zone backing keeps the SVG QR scannable on any kiosk theme. */}
      <div data-testid="bank-qr" className="bg-white p-4 rounded-lg">
        <QRCode value={transfer.qrPayload} size={240} level="M" />
      </div>

      <Card className="w-full max-w-md flex flex-col gap-3">
        <DetailRow label={t('bankAccountName')} value={transfer.accountName} />
        <DetailRow label={t('bankAccountNumber')} value={transfer.accountNumber} mono />
        <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <span className="text-sm text-muted-fg">{t('bankAmount')}</span>
          <span data-testid="bank-amount" className="text-2xl font-extrabold text-primary tabular-nums">
            {formatNumber(transfer.amount)}₫
          </span>
        </div>
        <DetailRow label={t('bankMemo')} value={transfer.memo} mono />
      </Card>

      <p className="text-center text-lg text-muted-fg max-w-md">{t('bankInstruction')}</p>

      <div className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium text-muted-fg">{t('confirmationCode')}</span>
        <span data-testid="confirmation-code" className="text-3xl font-extrabold tracking-widest font-mono text-primary">
          {confirmationCode}
        </span>
      </div>

      <Button variant="outline" size="lg" onClick={onReset} className="min-w-[200px] h-14 text-lg">
        {t('newOrder')}
      </Button>
    </div>
  );
}
