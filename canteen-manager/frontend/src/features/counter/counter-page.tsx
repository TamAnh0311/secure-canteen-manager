import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { counter } from '@/lib/api';
import { Banner, Button, Input, PageHeader, Spinner } from '@/ui';
import type { PrisonerLookup } from '@/lib/types';
import { PrisonerCard } from './prisoner-card';
import { TopupForm } from './topup-form';
import { RelativeOrderForm } from './relative-order-form';
import { PendingOrdersQueue } from './pending-orders-queue';

export function CounterPage() {
  const { t } = useTranslation('counter');

  const [prisonId, setPrisonId] = useState('');
  const [lookup, setLookup] = useState<PrisonerLookup | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  async function doLookup(id: string, preserve = false) {
    const trimmed = id.trim();
    if (!trimmed) return;

    setLoading(true);
    setNotFound(false);
    setLookupError(null);
    if (!preserve) setLookup(null);

    try {
      const result = await counter.lookupPrisoner(trimmed);
      setLookup(result);
    } catch (err) {
      // 404 → show not-found banner; other errors → show message
      const status = (err as { status?: number }).status;
      if (status === 404) {
        setNotFound(true);
      } else {
        setLookupError(
          err instanceof Error ? err.message : String(err),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch after a successful transaction so balance + ledger stay fresh.
  async function refreshLookup() {
    if (prisonId.trim()) {
      await doLookup(prisonId, true);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      void doLookup(prisonId);
    }
  }

  const panelsDisabled = !lookup?.user.isActive;

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

      {/* Search row */}
      <div className="flex gap-2 mb-4 max-w-md">
        <Input
          ref={inputRef}
          type="search"
          value={prisonId}
          onChange={(e) => setPrisonId(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchAriaLabel')}
          disabled={loading}
        />
        <Button
          variant="outline"
          onClick={() => void doLookup(prisonId)}
          disabled={loading || !prisonId.trim()}
          loading={loading}
        >
          {t('searchButton')}
        </Button>
      </div>

      {/* Status indicators */}
      {loading && (
        <div className="flex items-center gap-2 text-muted-fg text-sm mb-4">
          <Spinner size={16} />
        </div>
      )}

      {notFound && (
        <Banner tone="warning" className="mb-4">
          {t('notFound')}
        </Banner>
      )}

      {lookupError && (
        <Banner tone="danger" className="mb-4">
          {t('lookupError', { message: lookupError })}
        </Banner>
      )}

      {/* Results */}
      {lookup && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
          {/* Left: prisoner info + ledger */}
          <PrisonerCard lookup={lookup} />

          {/* Right: action panels */}
          <div className="flex flex-col gap-4">
            <TopupForm
              prisonId={lookup.user.legacyId}
              disabled={panelsDisabled}
              onSuccess={refreshLookup}
            />
            <RelativeOrderForm
              prisonId={lookup.user.legacyId}
              disabled={panelsDisabled}
              onSuccess={refreshLookup}
              purchaseLimits={lookup.purchaseLimits}
              onRefreshPolicies={refreshLookup}
            />
          </div>
        </div>
      )}

      {/* Pending-approval queue — always visible to cashier/admin, independent of lookup. */}
      <section className="mt-8 border-t border-border pt-6">
        <PendingOrdersQueue />
      </section>
    </>
  );
}
