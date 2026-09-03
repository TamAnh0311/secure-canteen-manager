import { useCallback, useEffect, useMemo, useState } from 'react';
import { scans } from '@/lib/api';
import type { ApiError } from '@/lib/api-client';
import type { FullMenuItem, PurchaseLimits, QueueSheetItem, RoiTemplate } from '@/lib/types';
import { UNLIMITED_PURCHASE_LIMITS } from '@/lib/purchase-limits';
import type { DateRange } from '@/features/_shared/date-range-picker';
import { buildDraft, refreshDraftReferenceData, type SheetDraft } from './verify-model';
import { useWarpedImage } from './use-warped-image';

interface QueueState {
  scannerConfirmationEnabled: boolean;
  omrConfirmationEnabled: boolean;
  sheets: QueueSheetItem[];
  roiTemplate: RoiTemplate | null;
  roiTemplates: Record<string, RoiTemplate>;
  menuItems: FullMenuItem[];
  purchaseLimits: PurchaseLimits;
  loading: boolean;
  error: ApiError | Error | null;
}

const EMPTY: QueueState = {
  scannerConfirmationEnabled: false,
  omrConfirmationEnabled: false,
  sheets: [],
  roiTemplate: null,
  roiTemplates: {},
  menuItems: [],
  purchaseLimits: UNLIMITED_PURCHASE_LIMITS,
  loading: false,
  error: null,
};

// Owns the verify queue and per-sheet editable draft. Route-owned selection keeps
// the address bar and visible sheet from drifting apart.
// Image loading/prefetch is delegated to useWarpedImage. Removing a cleared sheet
// keeps the cursor on the next pending sheet. The queue is scoped to a service-date
// range so operators can revisit prior days; defaults to today.
export function useVerifyQueue(range: DateRange, selectedSheetId: string | null) {
  const [state, setState] = useState<QueueState>(EMPTY);
  const [draft, setDraft] = useState<SheetDraft | null>(null);

  const { dateFrom, dateTo } = range;
  const index = selectedSheetId
    ? state.sheets.findIndex((sheet) => sheet.id === selectedSheetId)
    : (state.sheets.length > 0 ? 0 : -1);
  const current = index >= 0 ? state.sheets[index] ?? null : null;
  const previous = index > 0 ? state.sheets[index - 1] ?? null : null;
  const next = index >= 0 ? state.sheets[index + 1] ?? null : null;

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    let cancelled = false;
    scans
      .getVerifyQueue({ dateFrom, dateTo })
      .then((res) => {
        if (cancelled) return;
        setState({
          scannerConfirmationEnabled: res.workflow.scannerConfirmationEnabled,
          omrConfirmationEnabled: res.workflow.omrConfirmationEnabled,
          sheets: res.sheets,
          roiTemplate: res.roiTemplate,
          roiTemplates: res.roiTemplates ?? {},
          menuItems: res.menuItems,
          purchaseLimits: res.purchaseLimits,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          ...EMPTY,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  // Rebuild the editable draft whenever the focused sheet changes.
  useEffect(() => {
    setDraft(current ? buildDraft(current, state.menuItems) : null);
  }, [current]);

  // Refresh only reference data after an authoritative stale-policy rejection.
  // Preserve queue objects, cursor, and the operator's current draft/focus.
  const refreshReferenceData = useCallback(async () => {
    const res = await scans.getVerifyQueue({ dateFrom, dateTo });
    setState((s) => ({
      ...s,
      scannerConfirmationEnabled: res.workflow.scannerConfirmationEnabled,
      omrConfirmationEnabled: res.workflow.omrConfirmationEnabled,
      roiTemplate: res.roiTemplate,
      roiTemplates: res.roiTemplates ?? {},
      menuItems: res.menuItems,
      purchaseLimits: res.purchaseLimits,
    }));
    setDraft((currentDraft) =>
      currentDraft ? refreshDraftReferenceData(currentDraft, res.menuItems) : currentDraft,
    );
  }, [dateFrom, dateTo]);

  const image = useWarpedImage(current, next);

  // Remove the current sheet from the queue after it is cleared (confirm/reject)
  // and keep the cursor pointing at the next pending sheet.
  const advance = useCallback((): string | null => {
    if (!current) return null;
    const remaining = state.sheets.filter((sheet) => sheet.id !== current.id);
    const nextIndex = Math.min(Math.max(index, 0), Math.max(0, remaining.length - 1));
    const nextId = remaining[nextIndex]?.id ?? null;
    setState((s) => {
      const sheets = s.sheets.filter((sheet) => sheet.id !== current.id);
      return { ...s, sheets };
    });
    return nextId;
  }, [current, index, state.sheets]);

  // Skip leaves the sheet in the queue; just move the cursor forward (wrapping).
  const skipForward = useCallback((): string | null => {
    if (state.sheets.length <= 1 || index < 0) return current?.id ?? null;
    return state.sheets[(index + 1) % state.sheets.length]?.id ?? null;
  }, [current?.id, index, state.sheets]);

  const total = useMemo(() => state.sheets.length, [state.sheets.length]);

  return {
    scannerConfirmationEnabled: state.scannerConfirmationEnabled,
    omrConfirmationEnabled: state.omrConfirmationEnabled,
    current,
    draft,
    setDraft,
    roiTemplate: current?.template?.id
      ? state.roiTemplates[current.template.id] ?? null
      : state.roiTemplate,
    menuItems: state.menuItems,
    purchaseLimits: state.purchaseLimits,
    index: Math.max(index, 0),
    total,
    previousId: previous?.id ?? null,
    nextId: next?.id ?? null,
    firstId: state.sheets[0]?.id ?? null,
    hasSelectedSheet: index >= 0,
    loading: state.loading,
    error: state.error,
    imageUrl: image.imageUrl,
    imageMediaType: image.mediaType,
    imageError: image.imageError,
    imageLoading: image.imageLoading,
    retryImage: image.retryImage,
    reload: load,
    refreshReferenceData,
    advance,
    skipForward,
  };
}
