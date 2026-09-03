import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { kiosk } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { Banner, Button, Card, CardHead, QuantityStepper } from '@/ui';
import type { KioskMenuItem } from '@/lib/types';
import type { KioskOrderResult } from '@/lib/api/kiosk';
import type { PurchaseLimits } from '@/lib/types';
import { calculatePurchaseLimits, hasExceededPurchaseLimit, ITEM_CATEGORIES, UNLIMITED_PURCHASE_LIMITS } from '@/lib/purchase-limits';
import { PurchaseLimitSummary } from '@/features/_shared/purchase-limit-summary';
import { PurchaseLimitExceededBanner } from '@/features/_shared/purchase-limit-exceeded-banner';

export interface MenuCalculatorProps {
  prisonId: string;
  menu: KioskMenuItem[];
  // Gates the bank tender: when the canteen account isn't configured the bank
  // option is hidden, so a relative can never place a bank order with no QR to pay it.
  bankEnabled: boolean;
  purchaseLimits?: PurchaseLimits;
  onRefreshLimits?: () => Promise<void>;
  onReset: () => void;
  // Fired with the full order result once placed, so the page can branch on
  // bankTransfer (offline VietQR) vs. the plain cash confirmation.
  onPlaced: (result: KioskOrderResult) => void;
}

/**
 * Order builder for the relative kiosk against the single global menu. The backend
 * buckets one pending order to today; a relative picks items, chooses a tender, and
 * submits. Persists nothing; clears on reset.
 */
export function MenuCalculator({ prisonId, menu, bankEnabled, purchaseLimits = UNLIMITED_PURCHASE_LIMITS, onRefreshLimits, onReset, onPlaced }: MenuCalculatorProps) {
  const { t } = useTranslation('kiosk');
  // menuItemId → portions chosen (absent / 0 = not ordered). A stepper per item edits this.
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());
  const [method, setMethod] = useState<'cash' | 'bank' | null>(null);
  // Bank tender only when a canteen account is configured; otherwise cash-only.
  const tenders: ReadonlyArray<'cash' | 'bank'> = bankEnabled ? ['cash', 'bank'] : ['cash'];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitRejected, setLimitRejected] = useState(false);

  const setQuantity = useCallback((id: string, qty: number) => {
    setQuantities((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }, []);

  const orderedItems = menu
    .map((item) => ({ menuItemId: item.id, quantity: quantities.get(item.id) ?? 0, price: item.price, category: item.category }))
    .filter((l) => l.quantity > 0);

  const subtotal = orderedItems.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const limitCalculation = calculatePurchaseLimits(orderedItems, purchaseLimits);
  const blockedCategoryLimit = hasExceededPurchaseLimit(limitCalculation);

  const hasItems = orderedItems.length > 0;

  async function handlePlace() {
    if (!hasItems || !method || submitting || blockedCategoryLimit) return;
    setSubmitting(true);
    setError(null);
    setLimitRejected(false);
    try {
      const result = await kiosk.placeOrder({
        prisonId,
        items: orderedItems.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
        method,
      });
      onPlaced(result);
    } catch (err) {
      // A prior pending order for this prisoner today blocks a second one —
      // surface a friendly "see the cashier" note, not a raw error, and stay put.
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

      <Card>
        <CardHead title={t('menuLabel')} />
        {menu.length === 0 ? (
          <p className="text-muted-fg text-sm">{t('noMenu')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div role="group" aria-label={t('menuLabel')} className="flex flex-col gap-3">
            {ITEM_CATEGORIES.filter((category) => menu.some((item) => item.category === category)).map((category) => (
              <section key={category} aria-labelledby={`kiosk-category-${category}`}>
              <h3 id={`kiosk-category-${category}`} className="text-sm font-semibold mb-2">{t(category === 'food' ? 'categoryFood' : 'categoryEssential')}</h3>
              <ul role="group" aria-label={t(category === 'food' ? 'categoryFood' : 'categoryEssential')} className="flex flex-col gap-2">
              {menu.filter((item) => item.category === category).map((item) => {
                const qty = quantities.get(item.id) ?? 0;
                return (
                  <li key={item.id}>
                    <div
                      className={[
                        'flex items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 transition-colors',
                        qty > 0 ? 'border-primary bg-primary/10' : 'border-border bg-card',
                      ].join(' ')}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-base font-medium truncate">{item.name}</span>
                        <span className="text-sm font-semibold text-foreground whitespace-nowrap">
                          {formatNumber(item.price)}₫
                        </span>
                      </div>
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
              </ul></section>
            ))}
            </div>

            {/* Tender picker + submit appear only once something is selected. */}
            {hasItems && (
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                <div
                  data-testid="subtotal"
                  className="flex items-center justify-between text-base font-semibold"
                >
                  <span>{t('subtotal')}</span>
                  <span>{formatNumber(subtotal)}₫</span>
                </div>
                <PurchaseLimitSummary calculation={limitCalculation} namespace="kiosk" />
                {blockedCategoryLimit && <PurchaseLimitExceededBanner calculation={limitCalculation} namespace="kiosk" />}

                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium text-muted-fg mb-1">{t('chooseMethod')}</legend>
                  <div className="flex gap-3">
                    {tenders.map((m) => (
                      <label
                        key={m}
                        className={[
                          'flex-1 flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 cursor-pointer transition-colors',
                          method === m ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="method"
                          value={m}
                          checked={method === m}
                          onChange={() => setMethod(m)}
                          className="h-5 w-5 accent-primary"
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
          </div>
        )}
      </Card>
    </div>
  );
}
