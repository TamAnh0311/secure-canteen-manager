import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { counter } from '@/lib/api';
import { translateApiError } from '@/lib/api-client';
import { formatVnd } from '@/lib/format';
import { Banner, Button, Card, CardHead, Field, Input } from '@/ui';
import { useToast } from '@/ui';

const MAX_VND = 1_000_000_000;

interface TopupFormProps {
  prisonId: string;
  disabled?: boolean;
  onSuccess: () => void;
}

interface FormState {
  amount: string;
  method: 'cash' | 'bank';
  ref: string;
}

interface FormErrors {
  amount?: string;
}

function validateAmount(raw: string, t: (k: string) => string): string | undefined {
  if (!raw.trim()) return t('topupAmountRequired');
  const n = Number(raw);
  if (!Number.isInteger(n)) return t('topupAmountInteger');
  if (n <= 0) return t('topupAmountMin');
  if (n > MAX_VND) return t('topupAmountMax');
  return undefined;
}

export function TopupForm({ prisonId, disabled = false, onSuccess }: TopupFormProps) {
  const { t } = useTranslation('counter');
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>({ amount: '', method: 'cash', ref: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'amount') setErrors((prev) => ({ ...prev, amount: undefined }));
    setApiError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const amountErr = validateAmount(form.amount, t);
    if (amountErr) {
      setErrors({ amount: amountErr });
      return;
    }

    setSubmitting(true);
    setApiError(null);
    try {
      const result = await counter.createTopup({
        prisonId,
        amount: Number(form.amount),
        method: form.method,
        ref: form.ref.trim() || undefined,
      });
      toast({ tone: 'success', message: t('topupSuccess', { balance: formatVnd(result.balance) }) });
      setForm({ amount: '', method: 'cash', ref: '' });
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof Error
          ? translateApiError((err as { body?: unknown }).body ?? err.message, err.message)
          : String(err);
      setApiError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHead title={t('topupTitle')} />

      <form onSubmit={handleSubmit} noValidate>
        {apiError && (
          <Banner tone="danger" className="mb-4">
            {apiError}
          </Banner>
        )}

        <Field
          label={t('topupAmountLabel')}
          htmlFor="topup-amount"
          required
          error={errors.amount}
        >
          <Input
            id="topup-amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_VND}
            step={1}
            value={form.amount}
            onChange={(e) => setField('amount', e.target.value)}
            placeholder={t('topupAmountPlaceholder')}
            disabled={disabled || submitting}
            aria-describedby={errors.amount ? 'topup-amount-error' : undefined}
          />
        </Field>

        <Field label={t('topupMethodLabel')} htmlFor="topup-method">
          <div className="flex gap-4 mt-1" role="radiogroup" aria-labelledby="topup-method-label">
            {(['cash', 'bank'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="topup-method"
                  value={m}
                  checked={form.method === m}
                  onChange={() => setField('method', m)}
                  disabled={disabled || submitting}
                  className="accent-primary"
                />
                {m === 'cash' ? t('methodCash') : t('methodBank')}
              </label>
            ))}
          </div>
        </Field>

        <Field label={t('topupRefLabel')} htmlFor="topup-ref">
          <Input
            id="topup-ref"
            type="text"
            value={form.ref}
            onChange={(e) => setField('ref', e.target.value)}
            placeholder={t('topupRefPlaceholder')}
            disabled={disabled || submitting}
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          disabled={disabled || submitting}
          loading={submitting}
          className="w-full mt-1"
        >
          {t('topupSubmit')}
        </Button>
      </form>
    </Card>
  );
}
