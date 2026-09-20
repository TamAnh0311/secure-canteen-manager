import { useTranslation } from 'react-i18next';
import { formatVnd } from '@/lib/format';
import { ITEM_CATEGORIES, type PurchaseLimitCalculation } from '@/lib/purchase-limits';

export function PurchaseLimitSummary({ calculation, namespace }: {
  calculation: PurchaseLimitCalculation;
  namespace: 'canteen' | 'counter' | 'verify';
}) {
  const { t } = useTranslation(namespace);
  return (
    <div aria-live="polite" aria-label={t('categorySummary')} className="border border-border rounded divide-y divide-border">
      {ITEM_CATEGORIES.map((category) => {
        const row = calculation[category];
        return (
          <div key={category} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="font-medium">{t(category === 'food' ? 'categoryFood' : 'categoryEssential')}</span>
            <span className={row.exceeded ? 'text-danger font-semibold tabular-nums' : 'tabular-nums'}>
              {row.limit == null ? `${formatVnd(row.subtotal)} · ${t('categoryUnlimited')}` : `${formatVnd(row.subtotal)} / ${formatVnd(row.limit)} · ${
                row.exceeded
                  ? t('categoryExceeded', { amount: formatVnd(row.subtotal - row.limit) })
                  : t('categoryRemaining', { amount: formatVnd(row.remaining ?? 0) })
              }`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
