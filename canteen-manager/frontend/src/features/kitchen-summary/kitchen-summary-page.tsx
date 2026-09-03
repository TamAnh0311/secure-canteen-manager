import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { menu } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatTime } from '@/lib/format';
import { Banner, Button, PageHeader, Spinner } from '@/ui';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';
import '@/styles/print.css';
import { AssignedZoneScope, useAssignedZone } from '@/features/_shared/assigned-zone-scope';

export function KitchenSummaryPage() {
  const { t } = useTranslation('kitchen');
  const { t: tCommon } = useTranslation('common');
  const assignedZone = useAssignedZone();
  // The kitchen sheet covers one service date; the range collapses to its end
  // bound so the printed list is always a single cooking day.
  const [range, setRange] = useState<DateRange>(tomorrowRange);
  const serviceDate = range.dateTo;

  const summaryQuery = useQuery(() => menu.getSummary(serviceDate), [serviceDate]);

  const summaryItems = summaryQuery.data ?? [];
  const totalPortions = summaryItems.reduce((acc, item) => acc + item.count, 0);

  const generatedAt = formatTime(new Date(), { timeStyle: 'short' } as Intl.DateTimeFormatOptions);

  return (
    <>
      {/* Controls — hidden on print */}
      <div className="no-print">
        <PageHeader
          title={t('pageTitle')}
          subtitle={t('pageSubtitle')}
          actions={
            <div className="flex items-center gap-2">
              <DateRangePicker
                value={{ dateFrom: serviceDate, dateTo: serviceDate }}
                onChange={(r) => setRange({ dateFrom: r.dateTo, dateTo: r.dateTo })}
              />
              <Button variant="primary" size="sm" onClick={() => window.print()}>
                {t('printSummary')}
              </Button>
            </div>
          }
        />
      </div>
      <div className="no-print"><AssignedZoneScope /></div>

      {summaryQuery.error && (
        <Banner tone="danger" className="mb-4 no-print">
          {summaryQuery.error.message}
        </Banner>
      )}

      {summaryQuery.loading && !summaryQuery.data && (
        <div className="flex justify-center py-8 no-print">
          <Spinner size={24} />
        </div>
      )}

      {/* Printable region */}
      <div className="print-area max-w-[760px] mx-auto bg-card border border-border rounded shadow p-7">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-[22px] font-semibold uppercase">{t('summaryHeading')}</h2>
            <div className="text-[13px] text-muted-fg mt-0.5">
              {formatDate(serviceDate, { day: '2-digit', month: 'short', year: 'numeric' })}
              {' · '}
              {t('generatedAt', { time: generatedAt })}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-fg">{t('totalOrdersLabel')}</div>
            <div className="font-mono text-[30px] font-semibold leading-tight">{totalPortions}</div>
          </div>
        </div>

        {/* Summary table */}
        <table className="w-full border-collapse mt-3.5">
          <thead>
            <tr>
              <th className="bg-foreground text-card text-left px-3 py-2.5 text-[13px] font-semibold">
                {t('colNumber')}
              </th>
              <th className="bg-foreground text-card text-left px-3 py-2.5 text-[13px] font-semibold">
                {t('colMenuItem')}
              </th>
              <th className="bg-foreground text-card text-right px-3 py-2.5 text-[13px] font-semibold font-mono">
                {t('colPortions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summaryItems.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-muted-fg">
                  {assignedZone ? tCommon('assignedZoneEmpty', { zone: assignedZone }) : t('noData')}
                </td>
              </tr>
            ) : (
              [...summaryItems]
                .sort((a, b) => a.position - b.position)
                .map((item, idx) => (
                  <tr key={item.menuItemId}>
                    <td className="px-3 py-3 border-b border-border font-mono text-sm">{idx + 1}</td>
                    <td className="px-3 py-3 border-b border-border text-base">{item.name}</td>
                    <td className="px-3 py-3 border-b border-border text-right font-mono text-[22px] font-semibold">
                      {item.count}
                    </td>
                  </tr>
                ))
            )}
            {/* Total row */}
            {summaryItems.length > 0 && (
              <tr>
                <td className="px-3 py-3 border-t-2 border-foreground font-bold text-[18px]"></td>
                <td className="px-3 py-3 border-t-2 border-foreground font-bold text-[18px] uppercase">
                  {t('totalPortions')}
                </td>
                <td className="px-3 py-3 border-t-2 border-foreground text-right font-mono font-bold text-[18px]">
                  {totalPortions}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="text-xs text-muted-fg mt-3">{t('footerNote')}</p>
      </div>
    </>
  );
}
