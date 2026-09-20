import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { menu } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatTime, formatNumber } from '@/lib/format';
import { presetRange, previousPeriod, type RangePreset } from '@/lib/date-ranges';
import { Banner, Button, Card, Input, PageHeader, Spinner } from '@/ui';
import { AssignedZoneScope, useAssignedZone } from '@/features/_shared/assigned-zone-scope';
import '@/styles/print.css';

const PRESETS: RangePreset[] = ['shift', 'day', 'week', 'month', 'quarter', 'year'];

export function KitchenSummaryPage() {
  const { t } = useTranslation('kitchen');
  const { t: tCommon } = useTranslation('common');
  const assignedZone = useAssignedZone();

  const [activePreset, setActivePreset] = useState<RangePreset>('day');
  const [dateFrom, setDateFrom] = useState(() => presetRange('day').dateFrom);
  const [dateTo, setDateTo] = useState(() => presetRange('day').dateTo);
  const [compare, setCompare] = useState(false);

  const summaryQuery = useQuery(
    () => menu.getSummaryRange(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  const prev = previousPeriod(dateFrom, dateTo);
  const compareQuery = useQuery(
    () => compare ? menu.getSummaryRange(prev.dateFrom, prev.dateTo) : Promise.resolve([]),
    [compare, prev.dateFrom, prev.dateTo],
  );

  const summaryItems = summaryQuery.data ?? [];
  const compareItems = compareQuery.data ?? [];
  const totalPortions = summaryItems.reduce((acc, item) => acc + item.count, 0);
  const compareTotalPortions = compareItems.reduce((acc, item) => acc + item.count, 0);

  const generatedAt = formatTime(new Date(), { timeStyle: 'short' } as Intl.DateTimeFormatOptions);

  /** Build a map of menuItemId → count for the comparison period. */
  const compareMap = new Map(compareItems.map((i) => [i.menuItemId, i.count]));

  /** Format a delta indicator: +N, -N, or blank. */
  function delta(current: number, previous: number | undefined): string {
    if (previous === undefined || previous === current) return '';
    const diff = current - previous;
    return diff > 0 ? `+${diff}` : String(diff);
  }

  function deltaClass(current: number, previous: number | undefined): string {
    if (previous === undefined || previous === current) return '';
    return current > previous ? 'text-green-600' : 'text-red-600';
  }

  function selectPreset(p: RangePreset) {
    setActivePreset(p);
    const r = presetRange(p);
    setDateFrom(r.dateFrom);
    setDateTo(r.dateTo);
  }

  return (
    <>
      {/* Controls — hidden on print */}
      <div className="no-print">
        <PageHeader
          title={t('pageTitle')}
          subtitle={t('pageSubtitle')}
          actions={
            <Button variant="primary" size="sm" onClick={() => window.print()}>
              {t('printSummary')}
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

        {/* Custom date range + compare toggle */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input
            type="date"
            aria-label={t('dateFrom')}
            value={dateFrom}
            max={dateTo}
            onChange={(e) => { setDateFrom(e.target.value); setActivePreset('day'); }}
            className="w-40"
          />
          <span className="text-muted-fg">–</span>
          <Input
            type="date"
            aria-label={t('dateTo')}
            value={dateTo}
            min={dateFrom}
            onChange={(e) => { setDateTo(e.target.value); setActivePreset('day'); }}
            className="w-40"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              className="rounded"
            />
            {t('comparePrevious')}
          </label>
        </div>
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
              {dateFrom === dateTo
                ? formatDate(dateFrom, { day: '2-digit', month: 'short', year: 'numeric' })
                : `${formatDate(dateFrom, { day: '2-digit', month: 'short' })} – ${formatDate(dateTo, { day: '2-digit', month: 'short', year: 'numeric' })}`}
              {' · '}
              {t('generatedAt', { time: generatedAt })}
            </div>
            {compare && (
              <div className="text-[11px] text-muted-fg mt-0.5">
                {t('comparedWith')}: {formatDate(prev.dateFrom, { day: '2-digit', month: 'short' })} – {formatDate(prev.dateTo, { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-fg">{t('totalOrdersLabel')}</div>
            <div className="font-mono text-[30px] font-semibold leading-tight">{formatNumber(totalPortions)}</div>
            {compare && compareTotalPortions > 0 && (
              <div className={`text-xs font-mono ${deltaClass(totalPortions, compareTotalPortions)}`}>
                {delta(totalPortions, compareTotalPortions)} ({compareTotalPortions})
              </div>
            )}
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
              {compare && (
                <th className="bg-foreground text-card text-right px-3 py-2.5 text-[13px] font-semibold font-mono">
                  {t('colDelta')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {summaryItems.length === 0 ? (
              <tr>
                <td colSpan={compare ? 4 : 3} className="px-3 py-6 text-center text-sm text-muted-fg">
                  {assignedZone ? tCommon('assignedZoneEmpty', { zone: assignedZone }) : t('noData')}
                </td>
              </tr>
            ) : (
              [...summaryItems]
                .sort((a, b) => a.position - b.position)
                .map((item, idx) => {
                  const prev = compareMap.get(item.menuItemId);
                  return (
                    <tr key={item.menuItemId}>
                      <td className="px-3 py-3 border-b border-border font-mono text-sm">{idx + 1}</td>
                      <td className="px-3 py-3 border-b border-border text-base">{item.name}</td>
                      <td className="px-3 py-3 border-b border-border text-right font-mono text-[22px] font-semibold">
                        {item.count}
                      </td>
                      {compare && (
                        <td className={`px-3 py-3 border-b border-border text-right font-mono text-sm ${deltaClass(item.count, prev)}`}>
                          {delta(item.count, prev)}
                          {prev !== undefined && <span className="text-gray-400 ml-1">({prev})</span>}
                        </td>
                      )}
                    </tr>
                  );
                })
            )}
            {/* Total row */}
            {summaryItems.length > 0 && (
              <tr>
                <td className="px-3 py-3 border-t-2 border-foreground font-bold text-[18px]"></td>
                <td className="px-3 py-3 border-t-2 border-foreground font-bold text-[18px] uppercase">
                  {t('totalPortions')}
                </td>
                <td className="px-3 py-3 border-t-2 border-foreground text-right font-mono font-bold text-[18px]">
                  {formatNumber(totalPortions)}
                </td>
                {compare && (
                  <td className={`px-3 py-3 border-t-2 border-foreground text-right font-mono font-bold text-sm ${deltaClass(totalPortions, compareTotalPortions)}`}>
                    {delta(totalPortions, compareTotalPortions)}
                    {compareTotalPortions > 0 && <span className="text-gray-400 ml-1">({formatNumber(compareTotalPortions)})</span>}
                  </td>
                )}
              </tr>
            )}
          </tbody>
        </table>

        <p className="text-xs text-muted-fg mt-3">{t('footerNote')}</p>
      </div>
    </>
  );
}
