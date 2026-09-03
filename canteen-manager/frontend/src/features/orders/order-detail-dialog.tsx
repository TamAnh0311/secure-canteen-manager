import { useTranslation } from 'react-i18next';
import { orders } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatVnd } from '@/lib/format';
import {
  Banner,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Spinner,
  StatusChip,
  Table,
  TBody,
  Td,
  Tr,
} from '@/ui';
import { orderStatusDisplay } from '@/lib/status-display';
import type { Order } from '@/lib/types';

interface OrderDetailDialogProps {
  order: Order;
  onClose: () => void;
}

export function OrderDetailDialog({ order, onClose }: OrderDetailDialogProps) {
  const { t } = useTranslation('orders');
  const { t: tCommon } = useTranslation('common');
  const { data, loading, error } = useQuery(
    () => orders.getOrder(order.id),
    [order.id],
  );
  const display = orderStatusDisplay(order.status);

  const formatTs = (iso: string) =>
    formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' } as Intl.DateTimeFormatOptions);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent maxWidth={520}>
        <DialogTitle>{t('dialogTitle', { id: order.id.slice(0, 8) })}</DialogTitle>

        {loading && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}

        {error && (
          <Banner tone="danger" className="mt-3">
            {error.message}
          </Banner>
        )}

        {data && (
          <div className="mt-4 space-y-4">
            {/* Meta row */}
            <div className="flex items-center gap-3 text-sm">
              <div
                className="w-8 h-8 rounded-full bg-accent-subtle text-primary grid place-items-center font-semibold text-xs shrink-0"
                aria-hidden="true"
              >
                {data.userId.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-medium font-mono">{data.userId}</div>
                <div className="text-xs text-muted-fg capitalize">
                  {data.sheetId
                    ? t('dialogSourceSheet', { source: data.source, sheetId: data.sheetId })
                    : t('dialogSource', { source: data.source })}
                </div>
              </div>
              <div className="ml-auto">
                <StatusChip tone={display.tone} label={tCommon(display.key)} dot />
              </div>
            </div>

            {/* Items list */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.06em] text-muted-fg mb-1">
                {t('dialogItemsLabel')}
              </div>
              {data.items.length === 0 ? (
                <p className="text-sm text-muted-fg italic">{t('dialogNoItems')}</p>
              ) : (
                <Table>
                  <TBody>
                    {data.items.map((item, idx) => (
                      <Tr key={item.id}>
                        <Td>
                          <span className="font-mono text-xs text-muted-fg">{idx + 1}</span>
                        </Td>
                        <Td className="font-medium">{item.menuItemId}</Td>
                        <Td numeric className="text-muted-fg text-xs tabular-nums">
                          {formatVnd(item.unitPrice)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>

            {/* Total + payment */}
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-fg">{t('dialogTotalLabel')}</span>
              <span className="font-semibold tabular-nums">{formatVnd(data.totalAmount)}</span>
            </div>
            <div className="text-xs text-muted-fg">
              {t('dialogPaymentLabel', {
                status: t(data.paymentStatus === 'paid' ? 'paymentPaid' : 'paymentUnpaid'),
              })}
              {data.paymentMethod ? ` · ${data.paymentMethod}` : ''}
            </div>

            {/* Timestamps */}
            <div className="text-xs text-muted-fg space-y-0.5">
              <div>{t('dialogCreated', { ts: formatTs(data.createdAt) })}</div>
              {data.supersededAt && (
                <div>{t('dialogSuperseded', { ts: formatTs(data.supersededAt) })}</div>
              )}
              <div>{t('dialogUpdated', { ts: formatTs(data.updatedAt) })}</div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('dialogClose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
