import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { counter, menu } from '@/lib/api';
import { translateApiError } from '@/lib/api-client';
import { formatVnd } from '@/lib/format';
import { useQuery } from '@/lib/use-query';
import { Banner, Button, Card, CardHead, Field, QuantityStepper, Spinner } from '@/ui';
import { useToast } from '@/ui';
import type { PurchaseLimits } from '@/lib/types';
import { calculatePurchaseLimits, hasExceededPurchaseLimit, ITEM_CATEGORIES, UNLIMITED_PURCHASE_LIMITS } from '@/lib/purchase-limits';
import { PurchaseLimitSummary } from '@/features/_shared/purchase-limit-summary';
import { PurchaseLimitExceededBanner } from '@/features/_shared/purchase-limit-exceeded-banner';
import { ApiError } from '@/lib/api-client';

interface RelativeOrderFormProps {
  prisonId: string;
  disabled?: boolean;
  onSuccess: () => void;
  purchaseLimits?: PurchaseLimits;
  onRefreshPolicies?: () => Promise<void>;
}

interface FormErrors {
  items?: string;
  method?: string;
}

export function RelativeOrderForm({ prisonId, disabled = false, onSuccess, purchaseLimits = UNLIMITED_PURCHASE_LIMITS, onRefreshPolicies }: RelativeOrderFormProps) {
  const { t } = useTranslation('counter');
  const { toast } = useToast();

  // menuItemId → portions ordered (absent / 0 = not in the order). A stepper per item edits this.
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());
  const [method, setMethod] = useState<'cash' | 'bank' | ''>('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [limitRejected, setLimitRejected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // After a create, the order is pending (not paid) — show a persistent reminder
  // that payment is collected by accepting it in the queue.
  const [pendingNotice, setPendingNotice] = useState(false);

  // The menu is a single global list; the order buckets to today server-side.
  const menuQuery = useQuery(() => menu.listMenu(), []);
  const { data: menuItems, loading: menuLoading } = menuQuery;

  function setQuantity(itemId: string, qty: number) {
    setQuantities((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(itemId);
      else next.set(itemId, qty);
      return next;
    });
    setErrors((prev) => ({ ...prev, items: undefined }));
    setApiError(null);
    setLimitRejected(false);
    setPendingNotice(false);
  }

  const activeMenu = (menuItems ?? []).filter((i) => i.isActive);

  const orderedItems = activeMenu
    .map((i) => ({ menuItemId: i.id, quantity: quantities.get(i.id) ?? 0, price: i.price, category: i.category }))
    .filter((l) => l.quantity > 0);

  const runningTotal = orderedItems.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const limitCalculation = calculatePurchaseLimits(orderedItems, purchaseLimits);
  const blockedCategoryLimit = hasExceededPurchaseLimit(limitCalculation);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const nextErrors: FormErrors = {};
    if (orderedItems.length === 0) nextErrors.items = t('orderItemRequired');
    if (!method) nextErrors.method = t('orderMethodRequired');
    if (blockedCategoryLimit) nextErrors.items = t('toastBlockedCategoryLimit');

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setApiError(null);
    try {
      await counter.createRelativeOrder({
        prisonId,
        items: orderedItems.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
        method: method as 'cash' | 'bank',
      });
      toast({ tone: 'success', message: t('orderSuccess') });
      setQuantities(new Map());
      setMethod('');
      setPendingNotice(true);
      onSuccess();
    } catch (err) {
      const code = err instanceof ApiError && err.body && typeof err.body === 'object'
        ? (err.body as { code?: unknown }).code : undefined;
      const msg =
        code === 'ORDER.CATEGORY_LIMIT_EXCEEDED'
          ? err instanceof ApiError ? err.message : t('limitsChanged')
          : err instanceof Error
          ? translateApiError((err as { body?: unknown }).body ?? err.message, err.message)
          : String(err);
      setApiError(msg);
      setLimitRejected(code === 'ORDER.CATEGORY_LIMIT_EXCEEDED');
    } finally {
      setSubmitting(false);
    }
  }

  const isDisabled = disabled || submitting;

  return (
    <Card>
      <CardHead title={t('orderTitle')} />

      <form onSubmit={handleSubmit} noValidate>
        {apiError && (
          <Banner tone="danger" className="mb-4">
            {apiError}
          </Banner>
        )}

        {pendingNotice && (
          <Banner tone="info" className="mb-4">
            {t('orderPendingNotice')}
          </Banner>
        )}

        {/* Menu item multi-select (single global menu) */}
        <Field
          label={t('orderMenuLabel')}
          htmlFor="order-menu"
          required
          error={errors.items}
        >
          {menuLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-fg py-2">
              <Spinner size={14} />
              {t('orderMenuLoading')}
            </div>
          ) : activeMenu.length === 0 ? (
            <p className="text-sm text-muted-fg py-2">{t('orderMenuEmpty')}</p>
          ) : (
            <div
              className="border border-input rounded divide-y divide-border"
              role="group"
              aria-label={t('orderMenuLabel')}
            >
              {ITEM_CATEGORIES.filter((category) => activeMenu.some((item) => item.category === category)).map((category) => (
                <section key={category} aria-labelledby={`counter-category-${category}`}>
                <h3 id={`counter-category-${category}`} className="px-3 py-2 text-xs font-semibold bg-muted">{t(category === 'food' ? 'categoryFood' : 'categoryEssential')}</h3>
                {activeMenu.filter((item) => item.category === category).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    <span className="tabular-nums text-muted-fg">{formatVnd(item.price)}</span>
                    <QuantityStepper
                      value={quantities.get(item.id) ?? 0}
                      onChange={(qty) => setQuantity(item.id, qty)}
                      disabled={isDisabled}
                      decreaseLabel={t('qtyDecrease', { item: item.name })}
                      increaseLabel={t('qtyIncrease', { item: item.name })}
                    />
                  </span>
                </div>
                ))}</section>
              ))}
            </div>
          )}
        </Field>

        {/* Running total */}
        {orderedItems.length > 0 && (
          <div className="mb-3.5">
            <p className="text-sm font-semibold mb-2 text-right tabular-nums">{t('orderRunningTotal', { amount: formatVnd(runningTotal) })}</p>
            <PurchaseLimitSummary calculation={limitCalculation} namespace="counter" />
            {blockedCategoryLimit && <PurchaseLimitExceededBanner calculation={limitCalculation} namespace="counter" className="mt-2" />}
          </div>
        )}

        {limitRejected && onRefreshPolicies && (
          <Button type="button" variant="outline" className="w-full mb-3" onClick={() => { void Promise.all([menuQuery.refetch(), onRefreshPolicies()]).catch(() => undefined); }}>{t('refreshLimits')}</Button>
        )}

        {/* Payment method — cash/bank only; balance is not allowed for relative orders */}
        <Field label={t('orderMethodLabel')} htmlFor="order-method" required error={errors.method}>
          <div className="flex gap-4 mt-1" role="radiogroup" aria-labelledby="order-method-label">
            {(['cash', 'bank'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="order-method"
                  value={m}
                  checked={method === m}
                  onChange={() => {
                    setMethod(m);
                    setErrors((prev) => ({ ...prev, method: undefined }));
                  }}
                  disabled={isDisabled}
                  className="accent-primary"
                />
                {m === 'cash' ? t('methodCash') : t('methodBank')}
              </label>
            ))}
          </div>
        </Field>

        <Button
          type="submit"
          variant="primary"
          disabled={isDisabled || blockedCategoryLimit}
          loading={submitting}
          className="w-full mt-1"
        >
          {t('orderSubmit')}
        </Button>
      </form>
    </Card>
  );
}
