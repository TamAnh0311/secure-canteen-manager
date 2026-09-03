import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { menu, scans } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatTime } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  Kpi,
  PageHeader,
  Spinner,
} from '@/ui';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';

export function DashboardPage() {
  const [range, setRange] = useState<DateRange>(tomorrowRange);
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');

  const kpiQuery = useQuery(
    () => scans.getKpi({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    [range.dateFrom, range.dateTo],
  );

  const menuQuery = useQuery(() => menu.listMenu(), []);
  const formQuery = useQuery(() => menu.getForm(), []);

  const kpi = kpiQuery.data;
  const menuItems = menuQuery.data ?? [];
  const generatedAt = formQuery.data?.generatedAt ?? null;

  return (
    <>
      <PageHeader
        title={t('title', { date: formatDate(new Date()) })}
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="primary" size="sm" onClick={() => navigate('/verify')}>
              {t('verifyQueue')}
            </Button>
          </div>
        }
      />

      {/* KPI row — driven by the selected service-date range */}
      {kpiQuery.loading && !kpi && (
        <div className="flex justify-center py-8">
          <Spinner size={24} />
        </div>
      )}
      {kpiQuery.error && (
        <Banner tone="danger" className="mb-4">
          {kpiQuery.error.message}
        </Banner>
      )}
      {kpi && (
        <div
          className="grid gap-4 mb-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
          aria-live="polite"
        >
          <Card>
            <Kpi label={t('kpi.pending')} value={kpi.pending} />
          </Card>
          <Card>
            <Kpi label={t('kpi.processing')} value={kpi.processing} />
          </Card>
          <Card>
            <Kpi
              label={t('kpi.autoAccepted')}
              value={<span className="text-success">{kpi.autoAccepted}</span>}
            />
          </Card>
          <Card>
            <Kpi
              label={t('kpi.flagged')}
              value={<span className="text-warning">{kpi.flagged}</span>}
            />
          </Card>
          <Card>
            <Kpi
              label={t('kpi.rejected')}
              value={<span className="text-danger">{kpi.rejected}</span>}
            />
          </Card>
          <Card>
            <Kpi
              label={t('kpi.verified')}
              value={<span className="text-success">{kpi.verified}</span>}
            />
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

          <div className="text-[13px] text-muted-fg">
            {generatedAt
              ? t('formGenerated', {
                  time: formatTime(generatedAt, { dateStyle: 'short', timeStyle: 'short' } as Intl.DateTimeFormatOptions),
                })
              : t('formNotGenerated')}
          </div>
        </Card>

        {/* Quick actions */}
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-base font-semibold mb-2">{t('quickActions')}</h2>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => navigate('/form-print')}>
                {t('printForms')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/scan-monitor')}>
                {t('openScanMonitor')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/kitchen-summary')}>
                {t('kitchenSummary')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/orders')}>
                {t('viewOrders')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
