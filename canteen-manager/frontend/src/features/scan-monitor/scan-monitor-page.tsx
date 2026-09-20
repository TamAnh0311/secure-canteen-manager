import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { scanLocal } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatTime } from '@/lib/format';
import {
  Button,
  Card,
  CardHead,
  EmptyRow,
  Kpi,
  PageHeader,
  Spinner,
  StatusChip,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Banner,
} from '@/ui';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';
import type { ScanHistoryItem } from '@/lib/api/scan-local';

const POLL_INTERVAL_MS = 5000;

/**
 * Displays a live-updating monitor of phone-scan activity.
 * Shows KPIs and a table of orders created via the scanner pipeline.
 */
export function ScanMonitorPage() {
  const [range, setRange] = useState<DateRange>(tomorrowRange);
  const [paused, setPaused] = useState(false);
  const { t } = useTranslation('scan');
  const { t: tCommon } = useTranslation('common');

  const { data: history, error, loading, refetch } = useQuery(
    () => scanLocal.getHistory({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    [range.dateFrom, range.dateTo],
  );

  const statsQuery = useQuery(
    () => scanLocal.getStats({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    [range.dateFrom, range.dateTo],
  );

  // Auto-poll unless paused.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const statsRefetchRef = useRef(statsQuery.refetch);
  statsRefetchRef.current = statsQuery.refetch;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      refetchRef.current();
      statsRefetchRef.current();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const items: ScanHistoryItem[] = history ?? [];
  const stats = statsQuery.data;

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? t('resumeFeed') : t('pauseFeed')}
            </Button>
          </div>
        }
      />

      {/* Scan action card */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-accent-subtle">
        <div>
          <p className="font-semibold">{t('openPhoneScan')}</p>
          <p className="mt-1 text-sm text-muted-fg">{t('openPhoneScanHint')}</p>
        </div>
        <Link
          to="/scan"
          target="_blank"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-semibold text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('openPhoneScan')}
        </Link>
      </Card>

      {/* KPI strip */}
      {stats && (
        <div
          className="grid gap-4 mb-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
        >
          <Card><Kpi label={t('kpiTotalScans')} value={<span className="text-info">{stats.totalScans}</span>} /></Card>
          <Card><Kpi label={t('kpiOrdersCreated')} value={<span className="text-success">{stats.ordersCreated}</span>} /></Card>
          <Card><Kpi label={t('kpiOrdersPaid')} value={<span className="text-success">{stats.ordersPaid}</span>} /></Card>
          <Card><Kpi label={t('kpiTotalRevenue')} value={<span className="text-primary">{stats.totalRevenue.toLocaleString()}</span>} /></Card>
        </div>
      )}

      {error && (
        <Banner tone="danger" className="mb-4">
          {error.message}
        </Banner>
      )}

      <Card className="p-0">
        <CardHead
          title={t('scanHistory')}
          className="px-4 pt-4"
          actions={
            <span className="text-[13px] text-muted-fg">
              {paused ? t('feedPaused') : t('feedAutoRefresh')}
            </span>
          }
        />

        {loading && !history && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}

        <Table>
          <THead>
            <Tr>
              <Th>{t('colOrderId')}</Th>
              <Th>{t('colServiceDate')}</Th>
              <Th numeric>{t('colAmount')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th>{t('colPayment')}</Th>
              <Th>{t('colTime')}</Th>
            </Tr>
          </THead>
          <TBody>
            {items.length === 0 && !loading ? (
              <EmptyRow colSpan={6}>{t('noScansYet')}</EmptyRow>
            ) : (
              items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <span className="font-mono text-sm">{item.id.slice(0, 8)}</span>
                  </Td>
                  <Td>{item.serviceDate}</Td>
                  <Td numeric>{item.totalAmount.toLocaleString()}</Td>
                  <Td>
                    <StatusChip
                      tone={item.status === 'active' ? 'success' : item.status === 'superseded' ? 'warning' : 'danger'}
                      label={tCommon(`status.order.${item.status}`)}
                      dot
                    />
                  </Td>
                  <Td>
                    <StatusChip
                      tone={item.paymentStatus === 'paid' ? 'success' : 'warning'}
                      label={item.paymentStatus === 'paid' ? t('paid') : t('unpaid')}
                      dot
                    />
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-muted-fg">
                      {formatTime(item.createdAt, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    </span>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
