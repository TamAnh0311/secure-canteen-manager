import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { counter } from '@/lib/api';
import { Banner, Spinner, useToast } from '@/ui';
import { usePendingOrders } from './use-pending-orders';
import { PendingOrderRow, type AcceptOptions } from './pending-order-row';

/**
 * Cashier pending-approval queue: relative orders (kiosk or counter) awaiting a
 * decision. Polls ~4s. Accept settles to paid (optional method override); Reject
 * frees the pending slot. After either action the queue refetches so the row drops.
 */
export function PendingOrdersQueue() {
  const { t } = useTranslation('counter');
  const { toast } = useToast();
  const { orders, loading, error, refresh } = usePendingOrders();
  const [actingId, setActingId] = useState<string | null>(null);

  function handleActionError(err: unknown) {
    const status = (err as { status?: number }).status;
    const code = (err as { body?: { code?: string } }).body?.code;
    // A reused transfer reference is a real cashier mistake on a still-pending order —
    // surface the (localized) reason instead of the "handled elsewhere" soft note.
    if (code === 'ORDER.REFERENCE_DUPLICATE') {
      toast({ tone: 'danger', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    // A row accepted/rejected on another device is no longer pending (409) or gone
    // (404) here — soft-note and let the refresh drop it, don't hard-error.
    if (status === 409 || status === 404) {
      toast({ tone: 'warning', message: t('alreadyHandled') });
    } else {
      toast({ tone: 'danger', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleAccept(id: string, opts: AcceptOptions) {
    setActingId(id);
    try {
      await counter.acceptOrder(id, opts);
      toast({ tone: 'success', message: t('acceptSuccess') });
    } catch (err) {
      handleActionError(err);
    } finally {
      setActingId(null);
      await refresh();
    }
  }

  async function handleReject(id: string, reason: string) {
    setActingId(id);
    try {
      await counter.rejectOrder(id, reason ? { reason } : {});
      toast({ tone: 'success', message: t('rejectSuccess') });
    } catch (err) {
      handleActionError(err);
    } finally {
      setActingId(null);
      await refresh();
    }
  }

  return (
    <section aria-label={t('pendingQueue')} className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('pendingQueue')}</h2>
        <p className="text-sm text-muted-fg">{t('pendingQueueHint')}</p>
      </div>

      {error ? (
        <Banner tone="danger">{t('pendingError')}</Banner>
      ) : loading && orders.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-fg text-sm py-4">
          <Spinner size={16} />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-fg py-4">{t('noPending')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <PendingOrderRow
              key={order.orderId}
              order={order}
              busy={actingId === order.orderId}
              onAccept={handleAccept}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </section>
  );
}
