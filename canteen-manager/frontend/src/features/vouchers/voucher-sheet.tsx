import { useTranslation } from 'react-i18next';
import { formatTime, formatVnd } from '@/lib/format';
import type { DeliveryVoucher } from '@/lib/types';

const EMPTY = '—';

// One printable delivery voucher. `.voucher-sheet` drives the per-page break in
// print.css so each prisoner's voucher prints on its own sheet.
export function VoucherSheet({ voucher }: { voucher: DeliveryVoucher }) {
  const { t } = useTranslation('vouchers');

  // The balance is a snapshot — render the capture time so the signed sheet is
  // auditable rather than silently stale if a concurrent topup lands after print.
  const captureTime = formatTime(voucher.printedAt, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <article
      aria-label={voucher.name}
      className="voucher-sheet max-w-[760px] mx-auto bg-card border border-border rounded shadow p-7 mb-6"
    >
      {/* Header + identity */}
      <h2 className="text-[22px] font-semibold uppercase">{t('pageTitle')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-[18px] font-semibold col-span-2">{voucher.name}</div>
        <div>
          <span className="text-muted-fg">{t('prisonerId')}: </span>
          <span className="font-mono">{voucher.legacyId}</span>
        </div>
        <div>
          <span className="text-muted-fg">{t('labelZone')}: </span>
          <span>{voucher.zone ?? EMPTY}</span>
        </div>
        <div>
          <span className="text-muted-fg">{t('labelCell')}: </span>
          <span>{voucher.cell ?? EMPTY}</span>
        </div>
      </div>

      {/* Items */}
      <table className="w-full border-collapse mt-4">
        <thead>
          <tr>
            <th className="bg-foreground text-card text-left px-3 py-2 text-[13px] font-semibold">
              {t('colItem')}
            </th>
            <th className="bg-foreground text-card text-right px-3 py-2 text-[13px] font-semibold font-mono">
              {t('colQty')}
            </th>
          </tr>
        </thead>
        <tbody>
          {voucher.items.map((item) => (
            <tr key={item.name}>
              <td className="px-3 py-2 border-b border-border text-base">{item.name}</td>
              <td className="px-3 py-2 border-b border-border text-right font-mono text-[18px] font-semibold">
                {item.qty}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Money */}
      <div className="flex justify-between items-baseline mt-4 text-[15px]">
        <span className="font-semibold uppercase">{t('totalAmount')}</span>
        <span className="font-mono font-semibold">{formatVnd(voucher.totalAmount)}</span>
      </div>
      <div className="flex justify-between items-baseline mt-1 text-sm text-muted-fg">
        <span>{t('remainingBalance', { time: captureTime })}</span>
        <span className="font-mono">{formatVnd(voucher.remainingBalance)}</span>
      </div>

      {/* Signature lines */}
      <div className="grid grid-cols-3 gap-4 mt-10 text-center text-[13px]">
        {[t('signReceiver'), t('signDutyOfficer'), t('signDeliveryOfficer')].map((label) => (
          <div key={label}>
            <div className="border-t border-foreground pt-1">{label}</div>
          </div>
        ))}
      </div>
    </article>
  );
}
