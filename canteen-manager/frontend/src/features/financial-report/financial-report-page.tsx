import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { financial } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatVnd, formatNumber } from '@/lib/format';
import { presetRange, previousPeriod, type RangePreset } from '@/lib/date-ranges';
import type { FinancialReport } from '@/lib/api/financial';
import {
  Banner,
  Button,
  Card,
  EmptyRow,
  Input,
  Kpi,
  PageHeader,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/ui';
import '@/styles/print.css';

const PRESETS: RangePreset[] = ['day', 'week', 'month', 'quarter', 'year'];

/** Percentage change indicator. */
function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+∞' : '—';
  const pct = ((current - previous) / previous) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function pctClass(current: number, previous: number): string {
  if (previous === 0 || current === previous) return 'text-gray-500';
  return current > previous ? 'text-green-600' : 'text-red-600';
}

export function FinancialReportPage() {
  const { t } = useTranslation('financialReport');

  const [activePreset, setActivePreset] = useState<RangePreset>('month');
  const [dateFrom, setDateFrom] = useState(() => presetRange('month').dateFrom);
  const [dateTo, setDateTo] = useState(() => presetRange('month').dateTo);
  const [compare, setCompare] = useState(false);

  const reportQuery = useQuery(
    () => financial.getFinancialReport(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  const prev = previousPeriod(dateFrom, dateTo);
  const prevQuery = useQuery(
    () => compare ? financial.getFinancialReport(prev.dateFrom, prev.dateTo) : Promise.resolve(null),
    [compare, prev.dateFrom, prev.dateTo],
  );

  const report = reportQuery.data;
  const prevReport = prevQuery.data as FinancialReport | null;

  function selectPreset(p: RangePreset) {
    setActivePreset(p);
    const r = presetRange(p);
    setDateFrom(r.dateFrom);
    setDateTo(r.dateTo);
  }

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t('pageTitle')}
          subtitle={t('pageSubtitle')}
          actions={
            <Button variant="primary" size="sm" onClick={() => window.print()}>
              {t('print')}
            </Button>
          }
        />

        {/* Preset buttons */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {PRESETS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={activePreset === p ? 'primary' : 'outline'}
              onClick={() => selectPreset(p)}
            >
              {t(`preset_${p}`)}
            </Button>
          ))}
        </div>

        {/* Date range + compare */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input type="date" value={dateFrom} max={dateTo} onChange={(e) => { setDateFrom(e.target.value); setActivePreset('day'); }} className="w-40" />
          <span className="text-muted-fg">–</span>
          <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => { setDateTo(e.target.value); setActivePreset('day'); }} className="w-40" />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="rounded" />
            {t('comparePrevious')}
          </label>
        </div>
      </div>

      {reportQuery.error && <Banner tone="danger" className="mb-4 no-print">{reportQuery.error.message}</Banner>}
      {reportQuery.loading && !report && <div className="flex justify-center py-8 no-print"><Spinner size={24} /></div>}

      {report && (
        <div className="print-area space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label={t('paidRevenue')} value={formatVnd(report.totals.paidRevenue)}>
              {compare && prevReport && (
                <span className={`text-xs font-mono ${pctClass(report.totals.paidRevenue, prevReport.totals.paidRevenue)}`}>
                  {pctChange(report.totals.paidRevenue, prevReport.totals.paidRevenue)}
                </span>
              )}
            </Kpi>
            <Kpi label={t('paidOrders')} value={formatNumber(report.totals.paidOrders)}>
              {compare && prevReport && (
                <span className={`text-xs font-mono ${pctClass(report.totals.paidOrders, prevReport.totals.paidOrders)}`}>
                  {pctChange(report.totals.paidOrders, prevReport.totals.paidOrders)}
                </span>
              )}
            </Kpi>
            <Kpi label={t('unpaidOrders')} value={formatNumber(report.totals.unpaidOrders)} />
            <Kpi label={t('unpaidAmount')} value={formatVnd(report.totals.unpaidAmount)} />
          </div>

          {compare && prevReport && (
            <div className="text-xs text-muted-fg no-print">
              {t('comparedWith')}: {formatDate(prev.dateFrom, { day: '2-digit', month: 'short' })} – {formatDate(prev.dateTo, { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          )}

          {/* Revenue by source */}
          <Card>
            <h3 className="text-base font-semibold mb-3">{t('bySource')}</h3>
            <Table>
              <THead><Tr><Th>{t('source')}</Th><Th className="text-right">{t('orders')}</Th><Th className="text-right">{t('revenue')}</Th></Tr></THead>
              <TBody>
                {report.bySource.length === 0 ? <EmptyRow colSpan={3}>{t('noData')}</EmptyRow> : (
                  report.bySource.map((r) => (
                    <Tr key={r.source}>
                      <Td className="font-medium">{t(`source_${r.source}`, { defaultValue: r.source })}</Td>
                      <Td className="text-right font-mono">{formatNumber(r.orderCount)}</Td>
                      <Td className="text-right font-mono">{formatVnd(r.revenue)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>

          {/* Revenue by payment method */}
          <Card>
            <h3 className="text-base font-semibold mb-3">{t('byMethod')}</h3>
            <Table>
              <THead><Tr><Th>{t('method')}</Th><Th className="text-right">{t('orders')}</Th><Th className="text-right">{t('revenue')}</Th></Tr></THead>
              <TBody>
                {report.byMethod.length === 0 ? <EmptyRow colSpan={3}>{t('noData')}</EmptyRow> : (
                  report.byMethod.map((r) => (
                    <Tr key={r.method}>
                      <Td className="font-medium">{t(`method_${r.method}`, { defaultValue: r.method })}</Td>
                      <Td className="text-right font-mono">{formatNumber(r.orderCount)}</Td>
                      <Td className="text-right font-mono">{formatVnd(r.revenue)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>

          {/* Revenue by category */}
          <Card>
            <h3 className="text-base font-semibold mb-3">{t('byCategory')}</h3>
            <Table>
              <THead><Tr><Th>{t('category')}</Th><Th className="text-right">{t('quantity')}</Th><Th className="text-right">{t('revenue')}</Th></Tr></THead>
              <TBody>
                {report.byCategory.length === 0 ? <EmptyRow colSpan={3}>{t('noData')}</EmptyRow> : (
                  report.byCategory.map((r) => (
                    <Tr key={r.category}>
                      <Td className="font-medium">{t(`cat_${r.category}`, { defaultValue: r.category })}</Td>
                      <Td className="text-right font-mono">{formatNumber(r.totalQuantity)}</Td>
                      <Td className="text-right font-mono">{formatVnd(r.revenue)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>

          {/* Daily breakdown */}
          <Card>
            <h3 className="text-base font-semibold mb-3">{t('dailyBreakdown')}</h3>
            <Table>
              <THead><Tr><Th>{t('date')}</Th><Th className="text-right">{t('orders')}</Th><Th className="text-right">{t('revenue')}</Th></Tr></THead>
              <TBody>
                {report.daily.length === 0 ? <EmptyRow colSpan={3}>{t('noData')}</EmptyRow> : (
                  report.daily.map((r) => (
                    <Tr key={r.date}>
                      <Td>{formatDate(r.date, { weekday: 'short', day: '2-digit', month: 'short' })}</Td>
                      <Td className="text-right font-mono">{formatNumber(r.orderCount)}</Td>
                      <Td className="text-right font-mono">{formatVnd(r.revenue)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
