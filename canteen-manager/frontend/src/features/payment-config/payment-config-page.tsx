import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { paymentConfig } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusChip,
  useToast,
} from '@/ui';

// Client-side mirrors of the backend format rules (the NAPAS allowlist check stays
// server-side — a bad-but-well-formed BIN surfaces as a save error).
const BIN_RE = /^\d{6}$/;
const ACCT_RE = /^\d{6,19}$/;

interface FieldErrors {
  bin?: string;
  acct?: string;
  name?: string;
}

/**
 * Admin page to set the single canteen bank account the kiosk renders as an offline VietQR.
 * BIN + holder name come back in full and prefill; the account number is masked on read, so its
 * editable field starts empty and the admin re-enters it to change (doubles as the confirm step).
 */
export function PaymentConfigPage() {
  const { t } = useTranslation('paymentConfig');
  const { toast } = useToast();
  const config = useQuery(() => paymentConfig.getPaymentConfig(), []);

  const [bankBin, setBankBin] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // Hydrate BIN + name once the current config loads; never the masked number.
  useEffect(() => {
    if (!config.data) return;
    setBankBin(config.data.bankBin ?? '');
    setAccountName(config.data.accountName ?? '');
  }, [config.data]);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!BIN_RE.test(bankBin)) next.bin = t('errorBinFormat');
    if (!ACCT_RE.test(accountNumber)) next.acct = t('errorAccountNumber');
    if (accountName.trim().length === 0 || accountName.length > 140) {
      next.name = t('errorAccountName');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (saving || !validate()) return;
    setSaving(true);
    try {
      await paymentConfig.updatePaymentConfig({ bankBin, accountNumber, accountName });
      toast({ tone: 'success', message: t('saveSuccess') });
      setAccountNumber('');
      config.refetch();
    } catch (err) {
      // apiFetch already localizes backend codes (PAYMENT_CONFIG.*) via the errors namespace.
      toast({ tone: 'danger', message: err instanceof Error ? err.message : t('saveError') });
    } finally {
      setSaving(false);
    }
  }

  if (config.loading && !config.data) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={24} />
      </div>
    );
  }

  const masked = config.data?.accountNumber ?? null;

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={
          <StatusChip
            tone={config.data?.isConfigured ? 'success' : 'warning'}
            label={config.data?.isConfigured ? t('configured') : t('notConfigured')}
          />
        }
      />

      {config.error && (
        <Banner tone="danger" className="mb-4">
          {t('loadError')}
        </Banner>
      )}

      <Card className="max-w-md">
        <Field label={t('bankBinLabel')} htmlFor="pc-bank-bin" help={t('bankBinHelp')} error={errors.bin}>
          <Input
            id="pc-bank-bin"
            inputMode="numeric"
            value={bankBin}
            onChange={(e) => setBankBin(e.target.value.trim())}
            disabled={saving}
          />
        </Field>

        <Field
          label={t('accountNumberLabel')}
          htmlFor="pc-account-number"
          help={masked ? t('currentMasked', { value: masked }) : t('accountNumberHelp')}
          error={errors.acct}
        >
          <Input
            id="pc-account-number"
            inputMode="numeric"
            value={accountNumber}
            placeholder={t('accountNumberHelp')}
            onChange={(e) => setAccountNumber(e.target.value.trim())}
            disabled={saving}
          />
        </Field>

        <Field label={t('accountNameLabel')} htmlFor="pc-account-name" help={t('accountNameHelp')} error={errors.name}>
          <Input
            id="pc-account-name"
            value={accountName}
            maxLength={140}
            onChange={(e) => setAccountName(e.target.value)}
            disabled={saving}
          />
        </Field>

        <Button variant="primary" loading={saving} disabled={saving} onClick={handleSave}>
          {saving ? t('saving') : t('save')}
        </Button>
      </Card>
    </>
  );
}
