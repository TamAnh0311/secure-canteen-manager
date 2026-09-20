import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canteen } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { Banner, Button, Spinner } from '@/ui';
import type { CanteenPrisonerView } from '@/lib/types';
import type { CanteenBankTransfer } from '@/lib/api/kiosk';
import { PrisonIdKeypad } from './prison-id-keypad';
import { MenuCalculator } from './menu-calculator';
import { BankQrScreen } from './bank-qr-screen';
import { useIdleReset } from './use-idle-reset';

type Screen = 'entry' | 'menu' | 'not-found' | 'confirm' | 'bank-qr';

// The bank-QR screen shows no PII (balance is never displayed) and a visitor
// types into their banking app, generating no kiosk events — so the short
// 60 s idle reset would wipe the QR mid-transfer. Dwell longer there.
const IDLE_MS = 60_000;
const BANK_QR_IDLE_MS = 600_000;

/**
 * Full-screen standalone canteen page for relatives to browse the shared menu and place
 * an order for a prisoner. No authentication. No AppShell. No operator chrome.
 * Route: /canteen (top-level public, outside ProtectedRoute).
 */
export function CanteenPage() {
  const { t } = useTranslation('canteen');

  const [screen, setScreen] = useState<Screen>('entry');
  const [idValue, setIdValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [prisonId, setPrisonId] = useState('');
  const [prisonerView, setPrisonerView] = useState<CanteenPrisonerView | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [bankTransfer, setBankTransfer] = useState<CanteenBankTransfer | null>(null);

  function resetToEntry() {
    setScreen('entry');
    setIdValue('');
    setPrisonId('');
    setPrisonerView(null);
    setLookupError(null);
    setConfirmationCode('');
    setBankTransfer(null);
    setLoading(false);
  }

  // Auto-reset after inactivity so the next relative starts fresh — but dwell
  // far longer on the bank-QR screen so it survives a quiet bank transfer.
  useIdleReset(resetToEntry, screen === 'bank-qr' ? BANK_QR_IDLE_MS : IDLE_MS);

  async function handleSubmit(prisonId: string) {
    setLoading(true);
    setLookupError(null);

    try {
      const view = await canteen.getPrisonerView(prisonId);
      setPrisonerView(view);
      setPrisonId(prisonId);
      setScreen('menu');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Unknown OR inactive prisoner — show generic not-found, no distinction.
        setScreen('not-found');
      } else {
        setLookupError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshView() {
    if (!prisonId) return;
    const view = await canteen.getPrisonerView(prisonId);
    setPrisonerView(view);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-primary text-primary-fg py-4 px-6 flex items-center justify-between shadow">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start px-4 py-8 gap-6 max-w-6xl mx-auto w-full">
        {/* ── Entry screen ── */}
        {screen === 'entry' && (
          <>
            <p className="text-center text-lg text-muted-fg">{t('welcome')}</p>
            {lookupError && (
              <Banner tone="danger" className="w-full">
                {lookupError}
              </Banner>
            )}
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <Spinner size={40} />
                <span className="text-muted-fg">{t('loading')}</span>
              </div>
            ) : (
              <PrisonIdKeypad
                value={idValue}
                onChange={setIdValue}
                onSubmit={handleSubmit}
              />
            )}
          </>
        )}

        {/* ── Not-found screen ── */}
        {screen === 'not-found' && (
          <div className="flex flex-col items-center gap-6 py-8 w-full">
            <Banner tone="warning" className="w-full text-center text-lg">
              {t('notFound')}
            </Banner>
            <Button
              variant="outline"
              size="lg"
              onClick={resetToEntry}
              className="min-w-[200px] h-14 text-lg"
            >
              {t('backToEntry')}
            </Button>
          </div>
        )}

        {/* ── Menu screen ── */}
        {screen === 'menu' && prisonerView && (
          <div className="w-full flex flex-col gap-4">
            <div className="rounded-lg bg-success-bg text-success-fg px-5 py-4">
              <p className="text-sm font-medium opacity-75 mb-2">{t('confirmName')}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1">
                <dt>{t('name')}</dt><dd className="font-bold">{prisonerView.name}</dd>
                <dt>{t('prisonId')}</dt><dd className="font-mono">{prisonerView.prisonId}</dd>
                <dt>{t('zone')}</dt><dd>{prisonerView.zone ?? t('notAvailable')}</dd>
                <dt>{t('cell')}</dt><dd>{prisonerView.cell ?? t('notAvailable')}</dd>
              </dl>
            </div>

            <MenuCalculator
              prisonId={prisonId}
              menu={prisonerView.menu}
              bankEnabled={prisonerView.bankEnabled}
              purchaseLimits={prisonerView.purchaseLimits}
              onRefreshLimits={refreshView}
              onReset={resetToEntry}
              onPlaced={(result) => {
                setConfirmationCode(result.confirmationCode);
                // A bank order with a server-built transfer goes to the offline
                // VietQR screen; cash falls through to the plain "give the code to
                // the cashier" confirmation. (A missing transfer is a defensive
                // backstop — the bank tender is already hidden when unconfigured.)
                if (result.bankTransfer) {
                  setBankTransfer(result.bankTransfer);
                  setScreen('bank-qr');
                } else {
                  setScreen('confirm');
                }
              }}
            />
          </div>
        )}

        {/* ── Bank-transfer (offline VietQR) screen ── */}
        {screen === 'bank-qr' && bankTransfer && (
          <BankQrScreen
            transfer={bankTransfer}
            confirmationCode={confirmationCode}
            onReset={resetToEntry}
          />
        )}

        {/* ── Confirmation screen ── */}
        {screen === 'confirm' && (
          <div className="flex flex-col items-center gap-6 py-8 w-full">
            <Banner tone="success" className="w-full text-center text-lg">
              {t('orderPlaced')}
            </Banner>
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-medium text-muted-fg">{t('confirmationCode')}</p>
              <p
                data-testid="confirmation-code"
                className="text-5xl font-extrabold tracking-widest text-primary"
              >
                {confirmationCode}
              </p>
            </div>
            <p className="text-center text-lg text-muted-fg max-w-md">{t('giveCodeToCashier')}</p>
            <Button
              variant="outline"
              size="lg"
              onClick={resetToEntry}
              className="min-w-[200px] h-14 text-lg"
            >
              {t('newOrder')}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
