import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { scans } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/ui';
import type { QueueSheetItem } from '@/lib/types';
import { orderItems, type SheetDraft } from './verify-model';
import type { ExistingOrderSummary } from '@/lib/types';
import { IDENTITY_BLOCK_MESSAGE_KEYS, type IdentityBlockReason } from './confirm-bar';

interface ActionDeps {
  current: QueueSheetItem | null;
  draft: SheetDraft | null;
  identityReady: boolean;
  confirmationEnabled?: boolean;
  identityBlockReason?: IdentityBlockReason;
  selectedUserId?: string | null;
  identityReason?: string | null;
  existingOrder?: ExistingOrderSummary | null;
  // true when orderItems(draft) is empty — backend requires at least one item.
  blockedNoSelection: boolean;
  // true when any non-empty line has no resolved item (operator must reconcile).
  blockedUnresolvedLine: boolean;
  blockedCategoryLimit: boolean;
  unresolved: number;
  // Pulls focus to the first unresolved field (used as the Enter soft-block).
  focusUnresolved: () => void;
  // Removes the cleared sheet and advances the cursor.
  advance: () => string | null;
  // Moves the cursor without clearing (skip/defer).
  skipForward: () => string | null;
  onSheetTransition?: (sheetId: string | null) => void;
  // Called before the actual API confirm when a prior order exists; resolves
  // true when the operator has acknowledged the supersede warning.
  requestSupersedeAck: () => Promise<boolean>;
  onCategoryLimitRejected?: (error: ApiError) => void;
}

// Confirm/reject/skip wiring with toasts and the hard/soft block rules.
// Confirm requires an authoritative issued identity or an explicitly previewed
// generic selection, at least one item, and no unresolved lines.
// A remaining low-confidence field is a soft block that just refocuses.
// When an existing OMR order is present, the operator must acknowledge the
// supersede warning before the API call fires.
export function useVerifyActions(deps: ActionDeps) {
  const [saving, setSaving] = useState(false);
  // Authoritative in-flight guard: set synchronously before the await so a fast
  // double-press or Enter key-repeat cannot launch a second request. The `saving`
  // state below is only for button disabling/UX and lags a render behind.
  const inFlight = useRef(false);
  const { toast } = useToast();
  const { t } = useTranslation('verify');

  const {
    current,
    draft,
    identityReady,
    confirmationEnabled = true,
    identityBlockReason = 'issued_identity_missing',
    selectedUserId = null,
    identityReason = null,
    existingOrder = current?.existingOrder ?? null,
    blockedNoSelection,
    blockedUnresolvedLine,
    blockedCategoryLimit,
    unresolved,
    focusUnresolved,
    advance,
    skipForward,
    requestSupersedeAck,
    onCategoryLimitRejected,
    onSheetTransition,
  } = deps;

  const confirm = useCallback(async () => {
    if (!current || !draft || inFlight.current) return;
    if (!confirmationEnabled) {
      toast({ tone: 'danger', message: t('toastBlockedWorkflowMode') });
      return;
    }
    if (!identityReady) {
      const reason = identityBlockReason ?? 'issued_identity_missing';
      toast({
        tone: 'danger',
        message: t(IDENTITY_BLOCK_MESSAGE_KEYS[reason].toast),
      });
      return;
    }
    if ((current.bindingKind === 'generic' || current.bindingKind === 'scanner') && !selectedUserId) {
      toast({ tone: 'danger', message: t('toastBlockedIdentitySelection') });
      return;
    }
    if (blockedNoSelection) {
      toast({ tone: 'danger', message: t('toastBlockedNoSelection') });
      return;
    }
    if (blockedUnresolvedLine) {
      toast({ tone: 'danger', message: t('confirmBlockedUnresolvedLine') });
      return;
    }
    if (blockedCategoryLimit) {
      toast({ tone: 'danger', message: t('toastBlockedCategoryLimit') });
      return;
    }
    if (unresolved > 0) {
      focusUnresolved();
      return;
    }

    // When an existing active OMR order is present, require explicit operator
    // acknowledgment before firing the replace — this is the supersede guard.
    let replacementAck: true | undefined;
    if (existingOrder) {
      const ack = await requestSupersedeAck();
      if (!ack) return;
      replacementAck = true;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      const res = current.bindingKind !== 'issued'
        ? await scans.confirmGenericScan(current.id, {
          userId: selectedUserId!,
          items: orderItems(draft),
          replacementAck,
          reason: identityReason ?? undefined,
        })
        : await scans.confirmScan(current.id, {
          items: orderItems(draft),
          replacementAck,
        });
      toast({
        tone: 'success',
        message: res.replaced
          ? t('toastVerifiedReplaced', { sheetId: current.sheetId })
          : t('toastVerified', { sheetId: current.sheetId }),
      });
      onSheetTransition?.(advance());
    } catch (err) {
      const terminal = err instanceof ApiError && terminalFormCode(err);
      const categoryRejected = err instanceof ApiError && errorCode(err) === 'ORDER.CATEGORY_LIMIT_EXCEEDED';
      const msg = err instanceof ApiError ? err.message : t('toastSaveError');
      toast({ tone: 'danger', title: t('toastSaveFailed'), message: msg });
      if (categoryRejected && err instanceof ApiError) onCategoryLimitRejected?.(err);
      if (terminal) onSheetTransition?.(advance());
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [
    current,
    draft,
    identityReady,
    confirmationEnabled,
    identityBlockReason,
    selectedUserId,
    identityReason,
    existingOrder,
    blockedNoSelection,
    blockedUnresolvedLine,
    blockedCategoryLimit,
    unresolved,
    focusUnresolved,
    advance,
    requestSupersedeAck,
    onCategoryLimitRejected,
    onSheetTransition,
    toast,
    t,
  ]);

  const reject = useCallback(async () => {
    if (!current || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await scans.rejectScan(current.id);
      toast({ tone: 'info', message: t('toastRejected', { sheetId: current.sheetId }) });
      onSheetTransition?.(advance());
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('toastRejectError');
      toast({ tone: 'danger', title: t('toastRejectFailed'), message: msg });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [current, advance, onSheetTransition, toast, t]);

  const skip = useCallback(async () => {
    if (!current || inFlight.current) return;
    inFlight.current = true;
    try {
      await scans.skipScan(current.id);
    } catch {
      /* defer is best-effort; still move on */
    } finally {
      inFlight.current = false;
    }
    onSheetTransition?.(skipForward());
  }, [current, onSheetTransition, skipForward]);

  return { saving, confirm, reject, skip };
}

const TERMINAL_FORM_CODES = new Set([
  'OMR_FORM.ALREADY_CONSUMED',
  'OMR_FORM.VOID',
  'OMR_FORM.RESERVATION_CONFLICT',
  'OMR_FORM.ROI_MISMATCH',
  'OMR_FORM.DATE_MISMATCH',
]);

function terminalFormCode(error: ApiError): boolean {
  if (!error.body || typeof error.body !== 'object') return false;
  const code = (error.body as { code?: unknown }).code;
  return typeof code === 'string' && TERMINAL_FORM_CODES.has(code);
}

function errorCode(error: ApiError): unknown {
  return error.body && typeof error.body === 'object' ? (error.body as { code?: unknown }).code : undefined;
}
