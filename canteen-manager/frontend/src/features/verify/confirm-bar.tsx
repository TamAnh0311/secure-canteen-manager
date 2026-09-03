import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui';
import { formatVnd } from '@/lib/format';

export interface ConfirmBarHandle {
  // Move keyboard focus to the primary action so Tab can land on this group.
  focus: () => void;
}

export type IdentityBlockReason =
  | 'issued_identity_missing'
  | 'selection_required'
  | 'preview_required'
  | 'reason_required'
  | 'scanner_review_reason_required'
  | null;

export const IDENTITY_BLOCK_MESSAGE_KEYS = {
  issued_identity_missing: {
    status: 'confirmBlockedIdentity',
    toast: 'toastBlockedIdentity',
  },
  selection_required: {
    status: 'confirmBlockedIdentitySelection',
    toast: 'toastBlockedIdentitySelection',
  },
  preview_required: {
    status: 'confirmBlockedIdentityPreview',
    toast: 'toastBlockedIdentityPreview',
  },
  reason_required: {
    status: 'confirmBlockedIdentityReason',
    toast: 'toastBlockedIdentityReason',
  },
  scanner_review_reason_required: {
    status: 'confirmBlockedScannerReviewReason',
    toast: 'toastBlockedScannerReviewReason',
  },
} as const;

interface ConfirmBarProps {
  unresolved: number;
  // Issued sheets require their locked identity; generic sheets require an
  // explicit selection, authorized preview, and any mandatory reason.
  identityReady: boolean;
  confirmationEnabled?: boolean;
  identityBlockReason?: IdentityBlockReason;
  // true when orderItems is empty — backend requires at least one item.
  blockedNoSelection: boolean;
  // true when any non-empty line has a codeInput but no resolved item; operator
  // must reconcile every flagged line before confirming (no silent drop).
  blockedUnresolvedLine: boolean;
  blockedCategoryLimit?: boolean;
  // Matched prisoner commissary balance (VND); null when the user is operator-assigned
  // and the balance is unknown client-side (no money line, no guard — server decides).
  balance: number | null;
  // Integer-VND total: Σ resolvedItem.unitPrice × quantity for all resolved lines.
  orderTotal: number;
  // true when orderTotal > balance. A SOFT flag: the server is source of truth and
  // the client balance may be stale, so Confirm stays pressable (server returns 400).
  insufficientFunds: boolean;
  saving: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onSkip: () => void;
}

// Sticky action bar under the right pane. Surfaces the live blocking count and
// keeps Confirm visually warned (not silently disabled) while issues remain, so
// the operator always sees why Enter did not advance.
export const ConfirmBar = forwardRef<ConfirmBarHandle, ConfirmBarProps>(function ConfirmBar(
  {
    unresolved,
    identityReady,
    confirmationEnabled = true,
    identityBlockReason = 'issued_identity_missing',
    blockedNoSelection,
    blockedUnresolvedLine,
    blockedCategoryLimit = false,
    balance,
    orderTotal,
    insufficientFunds,
    saving,
    onConfirm,
    onReject,
    onSkip,
  },
  ref,
) {
  const { t } = useTranslation('verify');
  const confirmRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => confirmRef.current?.focus() }));

  const hardBlocked = !confirmationEnabled || !identityReady || blockedNoSelection || blockedUnresolvedLine || blockedCategoryLimit;

  let statusText: string;
  let statusClass: string;
  if (!confirmationEnabled) {
    statusText = t('confirmBlockedWorkflowMode');
    statusClass = 'text-danger';
  } else if (!identityReady) {
    const reason = identityBlockReason ?? 'issued_identity_missing';
    statusText = t(IDENTITY_BLOCK_MESSAGE_KEYS[reason].status);
    statusClass = 'text-danger';
  } else if (blockedNoSelection) {
    statusText = t('confirmBlockedNoSelection');
    statusClass = 'text-danger';
  } else if (blockedUnresolvedLine) {
    statusText = t('confirmBlockedUnresolvedLine');
    statusClass = 'text-danger';
  } else if (blockedCategoryLimit) {
    statusText = t('confirmBlockedCategoryLimit');
    statusClass = 'text-danger';
  } else if (insufficientFunds) {
    statusText = t('confirmInsufficientFunds');
    statusClass = 'text-danger';
  } else if (unresolved > 0) {
    statusText = t('confirmUnresolved', { count: unresolved });
    statusClass = 'text-warning';
  } else {
    statusText = t('confirmAllResolved');
    statusClass = 'text-success';
  }

  return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-card border-t border-border shadow-[0_-4px_12px_rgba(15,23,42,0.06)]">
      <span className={['text-[13px] font-medium', statusClass].join(' ')} aria-live="polite">
        {statusText}
      </span>
      {balance != null && (
        <span
          data-testid="confirm-money-line"
          className={[
            'text-[12px] tabular-nums',
            insufficientFunds ? 'text-danger font-semibold' : 'text-muted-fg',
          ].join(' ')}
        >
          {t('confirmOrderTotal')} {formatVnd(orderTotal)} · {t('confirmBalance')} {formatVnd(balance)}
        </span>
      )}
      <span className="flex-1" />
      <div className="text-right">
        <Button variant="ghost" size="md" aria-label={t('confirmSkipAccessible')} onClick={onSkip} disabled={saving}>
          {t('confirmSkip')} <kbd className="ml-1 font-mono text-xs opacity-70">S</kbd>
        </Button>
        <p className="max-w-48 text-[11px] text-muted-fg">{t('confirmSkipHelp')}</p>
      </div>
      <Button
        variant="outline"
        size="md"
        onClick={onReject}
        disabled={saving}
        className="text-danger border-danger hover:bg-danger-bg"
      >
        {t('confirmReject')} <kbd className="ml-1 font-mono text-xs opacity-70">R</kbd>
      </Button>
      <Button
        ref={confirmRef}
        variant={hardBlocked ? 'outline' : 'primary'}
        size="lg"
        onClick={onConfirm}
        loading={saving}
        aria-disabled={hardBlocked}
        className={
          !hardBlocked && (unresolved > 0 || insufficientFunds)
            ? 'bg-warning text-white hover:opacity-90 border-warning'
            : undefined
        }
      >
        {t('confirmAndNext')} <kbd className="ml-1.5 font-mono text-xs opacity-80">↵</kbd>
      </Button>
    </div>
  );
});
