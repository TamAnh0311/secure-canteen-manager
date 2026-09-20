import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { canteen } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { Banner, Button, Card, QuantityStepper } from '@/ui';
import type { KioskMenuItem } from '@/lib/types';
import type { CanteenOrderResult } from '@/lib/api/kiosk';
import type { PurchaseLimits } from '@/lib/types';
import { calculatePurchaseLimits, hasExceededPurchaseLimit, ITEM_CATEGORIES, UNLIMITED_PURCHASE_LIMITS } from '@/lib/purchase-limits';
import { PurchaseLimitSummary } from '@/features/_shared/purchase-limit-summary';
import { PurchaseLimitExceededBanner } from '@/features/_shared/purchase-limit-exceeded-banner';

export interface MenuCalculatorProps {
  prisonId: string;
  menu: KioskMenuItem[];
  bankEnabled: boolean;
  purchaseLimits?: PurchaseLimits;
  onRefreshLimits?: () => Promise<void>;
  onReset: () => void;
  onPlaced: (result: CanteenOrderResult) => void;
}

type CategoryFilter = 'all' | 'food' | 'essential';

/**
 * Two-panel order builder: left side has category tabs + item grid,
 * right side is a sticky order summary with payment and submit.
 */
export function MenuCalculator({ prisonId, menu, bankEnabled, purchaseLimits = UNLIMITED_PURCHASE_LIMITS, onRefreshLimits, onReset, onPlaced }: MenuCalculatorProps) {
  const { t } = useTranslation('canteen');
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());
  const [method, setMethod] = useState<'cash' | 'bank' | null>(null);
  const tenders: ReadonlyArray<'cash' | 'bank'> = bankEnabled ? ['cash', 'bank'] : ['cash'];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitRejected, setLimitRejected] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const setQuantity = useCallback((id: string, qty: number) => {
    setQuantities((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }, []);

  const orderedItems = menu
    .map((item) => ({ menuItemId: item.id, quantity: quantities.get(item.id) ?? 0, price: item.price, category: item.category, name: item.name }))
    .filter((l) => l.quantity > 0);

  const subtotal = orderedItems.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const limitCalculation = calculatePurchaseLimits(orderedItems, purchaseLimits);
  const blockedCategoryLimit = hasExceededPurchaseLimit(limitCalculation);
  const hasItems = orderedItems.length > 0;

  const filteredMenu = categoryFilter === 'all'
    ? menu
    : menu.filter((item) => item.category === categoryFilter);

  const availableCategories = ITEM_CATEGORIES.filter((c) => menu.some((item) => item.category === c));

  async function handlePlace() {
    if (!hasItems || !method || submitting || blockedCategoryLimit) return;
    setSubmitting(true);
    setError(null);
    setLimitRejected(false);
    try {
      const result = await canteen.placeOrder({
        prisonId,
        items: orderedItems.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
        method,
      });
      onPlaced(result);
    } catch (err) {
      const code = err instanceof ApiError && err.body && typeof err.body === 'object'
        ? (err.body as { code?: unknown }).code : undefined;
      if (err instanceof ApiError && code === 'ORDER.ALREADY_PENDING') {
        setError(t('alreadyPending'));
      } else if (err instanceof ApiError && code === 'ORDER.CATEGORY_LIMIT_EXCEEDED') {
        setError(err.message);
        setLimitRejected(true);
      } else {
        setError(err instanceof Error ? err.message : t('orderError'));
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Start-over bar */}
      <div className="flex items-center justify-between rounded-lg bg-primary text-primary-fg px-5 py-3">
        <span className="text-lg font-semibold">{t('pickItemsHint')}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          aria-label={t('startOver')}
          className="text-primary-fg hover:bg-primary-hover border-primary-fg/30 border"
        >
          {t('startOver')}
        </Button>
      </div>

      {menu.length === 0 ? (
        <Card><p className="text-muted-fg text-sm">{t('noMenu')}</p></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 items-start">
          {/* ── Left: category tabs + item grid ── */}
          <Card>
            {/* Category tabs */}
            {availableCategories.length > 1 && (
              <div className="flex gap-2 mb-4" role="tablist">
                {(['all', ...availableCategories] as CategoryFilter[]).map((cat) => (
                  <button
                    key={cat}
                    role="tab"
                    aria-selected={categoryFilter === cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={[
                      'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                      categoryFilter === cat
                        ? 'bg-primary text-primary-fg'
                        : 'bg-muted text-muted-fg hover:bg-muted/80',
                    ].join(' ')}
                  >
                    {cat === 'all' ? t('categoryAll') : t(cat === 'food' ? 'categoryFood' : 'categoryEssential')}
                  </button>
                ))}
              </div>
            )}

            {/* Item grid */}
            <ul role="group" aria-label={t('menuLabel')} className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {filteredMenu.map((item) => {
                const qty = quantities.get(item.id) ?? 0;
                return (
                  <li key={item.id}>
                    <div
                      className={[
                        'flex flex-col items-center gap-2 rounded-lg border-2 px-3 py-3 transition-colors text-center h-full',
                        qty > 0 ? 'border-primary bg-primary/10' : 'border-border bg-card',
                      ].join(' ')}
                    >
                      <span className="text-sm font-medium leading-tight line-clamp-2">{item.name}</span>
                      <span className="text-sm font-semibold text-foreground whitespace-nowrap">
                        {formatNumber(item.price)}₫
                      </span>
                      <QuantityStepper
                        value={qty}
                        onChange={(next) => setQuantity(item.id, next)}
                        size="lg"
                        decreaseLabel={t('qtyDecrease', { item: item.name })}
                        increaseLabel={t('qtyIncrease', { item: item.name })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* ── Right: sticky order summary + payment ── */}
          <div className="md:sticky md:top-4">
            <Card>
              <h3 className="text-base font-semibold mb-3">{t('orderSummary')}</h3>

              {!hasItems ? (
                <p className="text-sm text-muted-fg">{t('noItemsSelected')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {/* Selected items list */}
                  <ul className="flex flex-col gap-1 text-sm">
                    {orderedItems.map((item) => (
                      <li key={item.menuItemId} className="flex justify-between">
                        <span className="truncate mr-2">{item.name} ×{item.quantity}</span>
                        <span className="font-semibold whitespace-nowrap">{formatNumber(item.price * item.quantity)}₫</span>
                      </li>
                    ))}
                  </ul>

                  <div className="border-t border-border pt-2">
                    <div
                      data-testid="subtotal"
                      className="flex items-center justify-between text-base font-bold"
                    >
                      <span>{t('subtotal')}</span>
                      <span>{formatNumber(subtotal)}₫</span>
                    </div>
                  </div>

                  <PurchaseLimitSummary calculation={limitCalculation} namespace="canteen" />
                  {blockedCategoryLimit && <PurchaseLimitExceededBanner calculation={limitCalculation} namespace="canteen" />}

                  {/* Payment method */}
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium text-muted-fg mb-1">{t('chooseMethod')}</legend>
                    <div className="flex gap-2">
                      {tenders.map((m) => (
                        <label
                          key={m}
                          className={[
                            'flex-1 flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 cursor-pointer transition-colors text-sm',
                            method === m ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted',
                          ].join(' ')}
                        >
                          <input
                            type="radio"
                            name="method"
                            value={m}
                            checked={method === m}
                            onChange={() => setMethod(m)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="font-medium">{m === 'cash' ? t('methodCash') : t('methodBank')}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {error && (
                    <Banner tone="warning" className="w-full">
                      {error}
                      {limitRejected && onRefreshLimits && <Button variant="ghost" size="sm" className="ml-2" onClick={() => { void onRefreshLimits().catch(() => undefined); }}>{t('refreshLimits')}</Button>}
                    </Banner>
                  )}

                  <Button
                    size="lg"
                    onClick={handlePlace}
                    disabled={!method || submitting || blockedCategoryLimit}
                    className="w-full h-14 text-lg"
                  >
                    {submitting ? t('submitting') : t('placeOrder')}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
