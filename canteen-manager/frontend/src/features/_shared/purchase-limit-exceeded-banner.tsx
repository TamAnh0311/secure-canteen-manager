import { useTranslation } from 'react-i18next';
import { Banner } from '@/ui';
import { formatVnd } from '@/lib/format';
import { ITEM_CATEGORIES, type PurchaseLimitCalculation } from '@/lib/purchase-limits';

export function PurchaseLimitExceededBanner({ calculation, namespace, className }: {
  calculation: PurchaseLimitCalculation;
  namespace: 'canteen' | 'counter' | 'verify';
  className?: string;
}) {
  const { t } = useTranslation(namespace);
  const row = ITEM_CATEGORIES.map((category) => calculation[category]).find((entry) => entry.exceeded);
  if (!row || row.limit == null) return null;

  return (
    <Banner tone="danger" className={className}>
      {t('categoryLimitWarning', {
        category: t(row.category === 'food' ? 'categoryFood' : 'categoryEssential'),
        actualAmount: formatVnd(row.subtotal),
        limitAmount: formatVnd(row.limit),
      })}
    </Banner>
  );
}
