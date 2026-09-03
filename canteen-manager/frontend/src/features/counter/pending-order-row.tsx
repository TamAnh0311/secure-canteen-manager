import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime, formatVnd } from '@/lib/format';
import { Button, Card, Input, StatusChip } from '@/ui';
import type { PendingOrder } from '@/lib/types';

export interface AcceptOptions {
  method: 'cash' | 'bank';
  // Bank-only reconciliation extras the cashier reads off the banking app.
  transferReference?: string;
  receivedAmount?: number;
}

interface PendingOrderRowProps {
  order: PendingOrder;
  busy: boolean;
  onAccept: (id: string, opts: AcceptOptions) => void;
  onReject: (id: string, reason: string) => void;
}

type Mode = 'idle' | 'accept' | 'reject';

// A single queue row: prisoner + service date + items + intended tender, with
// inline Accept (optional method override) and Reject (optional reason) panels.
export function PendingOrderRow({ order, busy, onAccept, onReject }: PendingOrderRowProps) {
  const { t } = useTranslation('counter');
  const [mode, setMode] = useState<Mode>('idle');
  // Default the override to the visitor's intended tender; cash if unset.
  const intended: 'cash' | 'bank' = order.paymentMethod === 'bank' ? 'bank' : 'cash';
  const [method, setMethod] = useState<'cash' | 'bank'>(intended);
  const [reason, setReason] = useState('');
  // Bank-settlement extras the cashier transcribes from the banking app.
  const [transferReference, setTransferReference] = useState('');
  const [receivedAmount, setReceivedAmount] = useState('');

  const methodLabel = (m: 'cash' | 'bank') => (m === 'cash' ? t('methodCash') : t('methodBank'));

  function confirmAccept() {
    const opts: AcceptOptions = { method };
    if (method === 'bank') {
      const ref = transferReference.trim();
      if (ref) opts.transferReference = ref;
      const amt = receivedAmount.trim();
      if (amt) opts.receivedAmount = Number(amt);
    }
    onAccept(order.orderId, opts);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold truncate">{order.prisoner.name}</p>
          <p className="text-xs text-muted-fg">
            {order.prisoner.legacyId} · {order.serviceDate}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusChip
            tone="info"
            label={`${t('intendedMethodLabel')}: ${methodLabel(intended)}`}
          />
          <span className="text-xs text-muted-fg">
            {t('codeLabel')}: <span className="font-mono">{order.confirmationCode}</span>
          </span>
        </div>
      </div>

      <ul className="text-sm text-foreground flex flex-col gap-0.5">
        {order.items.map((item) => (
          <li key={item.menuItemId} className="flex justify-between gap-3">
            <span className="truncate">{item.name}</span>
            <span className="tabular-nums text-muted-fg">{formatVnd(item.unitPrice)}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-fg">
          {t('waitingSince', { time: formatTime(order.createdAt) })}
        </span>
        <span className="font-semibold tabular-nums">{formatVnd(order.totalAmount)}</span>
      </div>

      {order.paymentMethod === 'bank' && (
        <div
          data-testid="bank-amount-badge"
          className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        >
          <span className="text-sm font-medium">{t('bankBadgeLabel')}</span>
          <span className="text-base font-bold tabular-nums">{formatVnd(order.totalAmount)}</span>
        </div>
      )}

      {mode === 'idle' && (
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" disabled={busy} onClick={() => setMode('accept')}>
            {t('accept')}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setMode('reject')}>
            {t('reject')}
          </Button>
        </div>
      )}

      {mode === 'accept' && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <span className="text-sm font-medium">{t('overrideMethod')}</span>
          <div className="flex gap-4" role="radiogroup" aria-label={t('overrideMethod')}>
            {(['cash', 'bank'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name={`accept-method-${order.orderId}`}
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                  disabled={busy}
                  className="accent-primary"
                />
                {methodLabel(m)}
              </label>
            ))}
          </div>
          {method === 'bank' && (
            <div className="flex flex-col gap-2">
              <Input
                value={transferReference}
                onChange={(e) => setTransferReference(e.target.value)}
                placeholder={t('transferRefPlaceholder')}
                aria-label={t('transferRefLabel')}
                maxLength={120}
                disabled={busy}
              />
              <Input
                type="number"
                inputMode="numeric"
                value={receivedAmount}
                onChange={(e) => setReceivedAmount(e.target.value)}
                placeholder={t('receivedAmountPlaceholder')}
                aria-label={t('receivedAmountLabel')}
                disabled={busy}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              loading={busy}
              disabled={busy}
              onClick={confirmAccept}
            >
              {t('confirmAccept')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode('idle')}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('rejectReasonPlaceholder')}
            aria-label={t('rejectReasonLabel')}
            maxLength={200}
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="flex-1"
              loading={busy}
              disabled={busy}
              onClick={() => onReject(order.orderId, reason.trim())}
            >
              {t('confirmReject')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode('idle')}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
