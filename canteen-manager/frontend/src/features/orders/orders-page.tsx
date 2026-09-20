import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orders } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatVnd } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyRow,
  PageHeader,
  Select,
  Spinner,
  StatusChip,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/ui';
import { orderStatusDisplay } from '@/lib/status-display';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';
import type { Order, OrderStatus } from '@/lib/types';
import { OrderDetailDialog } from './order-detail-dialog';
import { AssignedZoneScope, useAssignedZone } from '@/features/_shared/assigned-zone-scope';

export function OrdersPage() {
  const { t } = useTranslation('orders');
  const { t: tCommon } = useTranslation('common');
  const assignedZone = useAssignedZone();
  const [range, setRange]             = useState<DateRange>(tomorrowRange);
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const STATUS_ITEMS = [
    { value: 'all',        label: t('filterAll') },
    { value: 'active',     label: t('filterActive') },
    { value: 'superseded', label: t('filterSuperseded') },
    { value: 'rejected',   label: t('filterRejected') },
  ];

  const { data, error, loading } = useQuery(
    () =>
      orders.listOrders({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    [range.dateFrom, range.dateTo, statusFilter],
  );

  const orderList = data ?? [];

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <div className="w-40">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                items={STATUS_ITEMS}
                ariaLabel={t('filterAriaLabel')}
              />
            </div>
          </div>
        }
      />
      <AssignedZoneScope />

      {error && (
        <Banner tone="danger" className="mb-4">
          {error.message}
        </Banner>
      )}

      <Card className="p-0">
        <CardHead
          title={t('orderCount', { count: orderList.length })}
          className="px-4 pt-4"
        />

        {loading && !data && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}

        <Table>
          <THead>
            <Tr>
              <Th>{t('colOrderId')}</Th>
              <Th>{t('colUserId')}</Th>
              <Th>{t('colSource')}</Th>
              <Th>{t('colSheet')}</Th>
              <Th numeric>{t('colTotal')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th>{t('colCreated')}</Th>
            </Tr>
          </THead>
          <TBody>
            {!loading && orderList.length === 0 ? (
              <EmptyRow colSpan={7}>
                {assignedZone ? tCommon('assignedZoneEmpty', { zone: assignedZone }) : undefined}
              </EmptyRow>
            ) : (
              orderList.map((order) => {
                const display = orderStatusDisplay(order.status);
                return (
                  <Tr
                    key={order.id}
                    selected={selectedOrder?.id === order.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <Td>
                      <span className="font-mono text-sm">{order.id.slice(0, 8)}</span>
                    </Td>
                    <Td>
                      {order.userName ? (
                        <div>
                          <div className="text-sm font-medium">{order.userName}</div>
                          {order.userLegacyId && <div className="text-xs text-muted-fg font-mono">{order.userLegacyId}</div>}
                        </div>
                      ) : (
                        <span className="font-mono text-sm">{order.userId.slice(0, 8)}</span>
                      )}
                    </Td>
                    <Td>
                      <span className="capitalize text-sm">{order.source}</span>
                    </Td>
                    <Td>
                      {order.sheetId ? (
                        <span className="font-mono text-xs text-muted-fg">{order.sheetId}</span>
                      ) : (
                        <span className="text-muted-fg text-xs">—</span>
                      )}
                    </Td>
                    <Td numeric>
                      <span className="tabular-nums text-sm">{formatVnd(order.totalAmount)}</span>
                    </Td>
                    <Td>
                      <StatusChip tone={display.tone} label={tCommon(display.key)} dot />
                    </Td>
                    <Td>
                      <span className="text-xs text-muted-fg">
                        {formatDate(order.createdAt, { dateStyle: 'short', timeStyle: 'short' } as Intl.DateTimeFormatOptions)}
                      </span>
                    </Td>
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </Card>

      {selectedOrder && (
        <OrderDetailDialog
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </>
  );
}
