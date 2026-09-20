import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { menu, orders } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { useQuery } from '@/lib/use-query';
import { formatDate } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  Kpi,
  PageHeader,
  Spinner,
} from '@/ui';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';

/** Format an integer as a compact VND string (e.g. 1 250 000). */
function formatVnd(amount: number): string {
  return amount.toLocaleString('vi-VN');
}

export function DashboardPage() {
  const [range, setRange] = useState<DateRange>(tomorrowRange);
  const [showQr, setShowQr] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');

  const statsQuery = useQuery(
    () => orders.getStats({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    [range.dateFrom, range.dateTo],
  );

  const menuQuery = useQuery(() => menu.listMenu(), []);
  const connQuery = useQuery(
    () => apiFetch<{ canteenUrl: string | null }>('/health/connection-info'),
    [],
  );

  const stats = statsQuery.data;
  const menuItems = menuQuery.data ?? [];
  const canteenUrl = connQuery.data?.canteenUrl ?? null;

  return (
    <>
      <PageHeader
        title={t('title', { date: formatDate(new Date()) })}
        actions={
          <DateRangePicker value={range} onChange={setRange} />
        }
      />

      {/* KPI row — driven by the selected service-date range */}
      {statsQuery.loading && !stats && (
        <div className="flex justify-center py-8">
          <Spinner size={24} />
        </div>
      )}
      {statsQuery.error && (
        <Banner tone="danger" className="mb-4">
          {statsQuery.error.message}
        </Banner>
      )}
      {stats && (
        <div
          className="grid gap-4 mb-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
          aria-live="polite"
        >
          <Card>
            <Kpi label={t('kpi.totalOrders')} value={stats.totalOrders} />
          </Card>
          <Card>
            <Kpi
              label={t('kpi.pending')}
              value={<span className="text-warning">{stats.pendingOrders}</span>}
            />
          </Card>
          <Card>
            <Kpi
              label={t('kpi.paidOrders')}
              value={<span className="text-success">{stats.paidOrders}</span>}
            />
          </Card>
          <Card>
            <Kpi label={t('kpi.revenue')} value={formatVnd(stats.totalRevenue)} />
          </Card>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Menu & form status */}
        <Card>
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="text-base font-semibold">{t('menuStatusTitle')}</h2>
            <a
              href="/menu"
              className="text-[13px] text-muted-fg hover:text-primary"
              onClick={(e) => {
                e.preventDefault();
                navigate('/menu');
              }}
            >
              {t('manageMenu')}
            </a>
          </div>

          {menuQuery.loading && (
            <div className="flex justify-center py-6">
              <Spinner size={20} />
            </div>
          )}
          {menuQuery.error && (
            <Banner tone="danger" className="mb-2">
              {menuQuery.error.message}
            </Banner>
          )}
          {!menuQuery.loading && (
            <div className="text-2xl font-semibold mb-1">
              {t('menuItemCount', { count: menuItems.length })}
            </div>
          )}

        </Card>

        {/* Quick actions */}
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-base font-semibold mb-2">{t('quickActions')}</h2>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => navigate('/kitchen-summary')}>
                {t('kitchenSummary')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/orders')}>
                {t('viewOrders')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/canteen')}>
                {t('openCanteen')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/counter')}>
                {t('openCounter')}
              </Button>
              {canteenUrl && (
                <Button variant="outline" onClick={() => setShowQr(true)}>
                  {t('tabletConnection')}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
      {/* Tablet connection QR dialog */}
      {canteenUrl && (
        <Dialog open={showQr} onOpenChange={setShowQr}>
          <DialogContent>
            <DialogTitle>{t('tabletConnection')}</DialogTitle>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="bg-white p-4 rounded-lg">
                <QRCode value={canteenUrl} size={220} level="M" />
              </div>
              <p className="text-sm text-muted-fg text-center break-all font-mono">{canteenUrl}</p>
              <p className="text-sm text-muted-fg text-center">{t('tabletHint')}</p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
