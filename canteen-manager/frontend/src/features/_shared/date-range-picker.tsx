import { useTranslation } from 'react-i18next';
import { Input } from '@/ui';
import { today, tomorrow } from '@/lib/today';
import type { DateRangeParams } from '@/lib/api/scans';

// A from/to service_date range. Both bounds are inclusive YYYY-MM-DD; the picker
// keeps them populated so a query is never sent with an open-ended bound.
export type DateRange = Required<DateRangeParams>;

// Default range = today/today, computed in the local (deploy) zone so it matches
// the day the backend buckets new scans/orders into. Used by views that report on
// what already happened (e.g. the voucher page).
export function todayRange(): DateRange {
  const d = today();
  return { dateFrom: d, dateTo: d };
}

// Default range = tomorrow/tomorrow. Orders are stamped for the next collection day,
// so the collection-day dashboards open on the day they are building toward rather
// than on an empty today bucket.
export function tomorrowRange(): DateRange {
  const d = tomorrow();
  return { dateFrom: d, dateTo: d };
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  disabled?: boolean;
}

export function DateRangePicker({ value, onChange, disabled }: DateRangePickerProps) {
  const { t } = useTranslation('common');

  return (
    <div className="flex items-center gap-2" role="group" aria-label={t('dateRange.label')}>
      <Input
        type="date"
        aria-label={t('dateRange.from')}
        value={value.dateFrom}
        max={value.dateTo}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
        className="w-40"
      />
      <span aria-hidden="true" className="text-muted-fg">
        –
      </span>
      <Input
        type="date"
        aria-label={t('dateRange.to')}
        value={value.dateTo}
        min={value.dateFrom}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
        className="w-40"
      />
    </div>
  );
}
