import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orders } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { today } from '@/lib/today';
import { Banner, Button, PageHeader, Spinner } from '@/ui';
import { VoucherSheet } from './voucher-sheet';
import '@/styles/print.css';

// Distinct, sorted, non-null values of one field across the voucher set.
function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function VouchersPage() {
  const { t } = useTranslation('vouchers');
  // Vouchers are printed on the delivery morning — default to today (orders are
  // stamped for the next collection day, so today's vouchers are what gets delivered).
  const [date, setDate] = useState(today());
  const [zone, setZone] = useState(''); // '' = all
  const [cell, setCell] = useState(''); // '' = all

  const vouchersQuery = useQuery(() => orders.getDeliveryVouchers({ date }), [date]);
  const all = useMemo(() => vouchersQuery.data ?? [], [vouchersQuery.data]);

  // Cell options narrow to the chosen zone so the two dropdowns stay consistent.
  const zoneOptions = useMemo(() => distinct(all.map((v) => v.zone)), [all]);
  const cellOptions = useMemo(
    () => distinct(all.filter((v) => !zone || v.zone === zone).map((v) => v.cell)),
    [all, zone],
  );

  const filtered = useMemo(
    () => all.filter((v) => (!zone || v.zone === zone) && (!cell || v.cell === cell)),
    [all, zone, cell],
  );

  // Reselecting a zone can orphan the chosen cell; clear it when it no longer applies.
  function onZoneChange(next: string) {
    setZone(next);
    setCell('');
  }

  return (
    <>
      {/* Controls — hidden on print */}
      <div className="no-print">
        <PageHeader
          title={t('pageTitle')}
          subtitle={t('pageSubtitle')}
          actions={
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label={t('dateLabel')}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 rounded border border-border bg-card px-2 text-sm"
              />
              <select
                aria-label={t('filterZone')}
                value={zone}
                onChange={(e) => onZoneChange(e.target.value)}
                className="h-9 rounded border border-border bg-card px-2 text-sm"
              >
                <option value="">{t('allZones')}</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('filterCell')}
                value={cell}
                onChange={(e) => setCell(e.target.value)}
                className="h-9 rounded border border-border bg-card px-2 text-sm"
              >
                <option value="">{t('allCells')}</option>
                {cellOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Button variant="primary" size="sm" onClick={() => window.print()}>
                {t('printVouchers')}
              </Button>
            </div>
          }
        />
      </div>

      {vouchersQuery.error && (
        <Banner tone="danger" className="mb-4 no-print">
          {vouchersQuery.error.message}
        </Banner>
      )}

      {vouchersQuery.loading && !vouchersQuery.data && (
        <div className="flex justify-center py-8 no-print">
          <Spinner size={24} />
        </div>
      )}

      {!vouchersQuery.loading && filtered.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-fg no-print">{t('noData')}</div>
      )}

      {/* One printable sheet per prisoner */}
      <div className="print-area">
        {filtered.map((voucher) => (
          <VoucherSheet key={voucher.userId} voucher={voucher} />
        ))}
      </div>
    </>
  );
}
