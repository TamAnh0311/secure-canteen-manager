import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { purchaseLimits } from '@/lib/api';
import { ITEM_CATEGORIES } from '@/lib/purchase-limits';
import type { PurchaseLimitAudience, PurchaseLimitConfiguration } from '@/lib/types';
import { Banner, Button, Card, CardHead, Input, Spinner, useToast } from '@/ui';

const AUDIENCES: PurchaseLimitAudience[] = ['prisoner', 'visitor'];

function clone(value: PurchaseLimitConfiguration): PurchaseLimitConfiguration {
  return structuredClone(value);
}

export function PurchaseLimitsCard() {
  const { t } = useTranslation('menu');
  const { toast } = useToast();
  const [draft, setDraft] = useState<PurchaseLimitConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    purchaseLimits.getPurchaseLimits().then((value) => {
      setDraft(clone(value));
    }).catch(() => setError(t('limitsLoadError'))).finally(() => setLoading(false));
  }, [t]);

  if (loading) return <Card className="mb-4"><Spinner size={18} /></Card>;
  if (!draft) return <Card className="mb-4"><Banner tone="danger">{error ?? t('limitsLoadError')}</Banner></Card>;

  const invalid = AUDIENCES.some((audience) => ITEM_CATEGORIES.some((category) => {
    const rule = draft[audience][category];
    return rule.enabled && (rule.amount == null || !Number.isInteger(rule.amount) || rule.amount <= 0 || rule.amount > 1_000_000_000);
  }));

  async function save() {
    if (invalid || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const value = await purchaseLimits.updatePurchaseLimits(draft);
      setDraft(clone(value));
      toast({ tone: 'success', message: t('toastLimitsSaved') });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('toastError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHead title={t('purchaseLimitsTitle')} />
      <p className="text-sm text-muted-fg mb-3">{t('purchaseLimitsHelp')}</p>
      {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {AUDIENCES.map((audience) => (
          <fieldset key={audience} className="border border-border rounded p-3">
            <legend className="text-sm font-semibold px-1">{t(audience === 'prisoner' ? 'audiencePrisoner' : 'audienceVisitor')}</legend>
            {ITEM_CATEGORIES.map((category) => {
              const rule = draft[audience][category];
              const label = t(category === 'food' ? 'categoryFood' : 'categoryEssential');
              const id = `limit-${audience}-${category}`;
              const rowInvalid = rule.enabled && (rule.amount == null || !Number.isInteger(rule.amount) || rule.amount <= 0 || rule.amount > 1_000_000_000);
              return (
                <div key={category} className="grid grid-cols-[1fr_160px] gap-3 items-end mb-3">
                  <label className="flex items-center gap-2 text-sm min-h-9">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={saving}
                      aria-label={t('enableLimit', { audience: t(audience === 'prisoner' ? 'audiencePrisoner' : 'audienceVisitor'), category: label })}
                      onChange={(e) => setDraft({ ...draft, [audience]: { ...draft[audience], [category]: { ...rule, enabled: e.target.checked } } })}
                    />
                    {label}
                  </label>
                  <div>
                    <label htmlFor={id} className="text-xs font-medium block mb-1">{t('limitAmount', { category: label })}</label>
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={1_000_000_000}
                      step={1}
                      value={rule.amount ?? ''}
                      disabled={!rule.enabled || saving}
                      aria-invalid={rowInvalid}
                      aria-describedby={rowInvalid ? `${id}-error` : undefined}
                      onChange={(e) => setDraft({ ...draft, [audience]: { ...draft[audience], [category]: { ...rule, amount: e.target.value === '' ? null : Number(e.target.value) } } })}
                    />
                    {rowInvalid && <p id={`${id}-error`} className="text-xs text-danger mt-1">{t('limitInvalid')}</p>}
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
      <div className="flex justify-end mt-3"><Button onClick={() => void save()} disabled={invalid || saving} loading={saving}>{t('saveLimits')}</Button></div>
    </Card>
  );
}
