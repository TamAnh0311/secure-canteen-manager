import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Spinner } from '@/ui';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';
import { useVerifyQueue } from './use-verify-queue';
import { useVerifyActions } from './use-verify-actions';
import { useVerifyKeyboard } from './use-verify-keyboard';
import { useVerifyFocusNav } from './use-verify-focus-nav';
import { useDirtyNavGuard } from './use-dirty-nav-guard';
import { SheetImageViewer, type FocusedField } from './sheet-image-viewer';
import { VerifyFieldsPanel, type FieldsPanelHandles } from './verify-fields-panel';
import { ConfirmBar, type ConfirmBarHandle } from './confirm-bar';
import { SupersedeWarning } from './supersede-warning';
import { KeyboardCheatsheet } from './keyboard-cheatsheet';
import { VerifyTopStrip } from './verify-top-strip';
import type { LineEditorHandle } from './line-editor';
import {
  orderItems,
  orderTotal,
  unresolvedCount,
  setLineCode,
  setLineQty,
  addLine,
  removeLine,
} from './verify-model';
import { calculatePurchaseLimits, hasExceededPurchaseLimit } from '@/lib/purchase-limits';
import { AssignedZoneScope } from '@/features/_shared/assigned-zone-scope';
import { scans } from '@/lib/api';
import type { IdentityPreview } from '@/lib/types';
import {
  reviewReasonKind,
  scannerExactIdentitySelection,
  type IdentitySelection,
} from './identity-resolution-panel';
import type { IdentityBlockReason } from './confirm-bar';
import { RejectConfirmationDialog } from './reject-confirmation-dialog';
import { ReviewStepGuide, type ReviewStepStatus } from './review-step-guide';
import { useVerifyViewMode } from './use-verify-view-mode';
import { buildVerifyUrl, rangeContains } from './verify-route';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;

export function VerifyPage() {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const { sheetId: routeSheetId } = useParams<{ sheetId?: string }>();
  const [searchParams] = useSearchParams();
  const hasDateContext = searchParams.has('dateFrom') && searchParams.has('dateTo');
  const [fallbackRange] = useState<DateRange>(tomorrowRange);
  const range = useMemo(() => {
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    return dateFrom && dateTo ? { dateFrom, dateTo } : fallbackRange;
  }, [fallbackRange, searchParams]);
  const [zoom, setZoom] = useState(1);
  const [focused, setFocused] = useState<FocusedField>(null);
  const [cheatsheet, setCheatsheet] = useState(false);
  const [categoryLimitError, setCategoryLimitError] = useState<string | null>(null);
  const [identitySheetId, setIdentitySheetId] = useState<string | null>(null);
  const [storedIdentitySelection, setStoredIdentitySelection] = useState<IdentitySelection | null>(null);
  const [storedIdentityPreview, setStoredIdentityPreview] = useState<IdentityPreview | null>(null);
  const [identityPreviewLoading, setIdentityPreviewLoading] = useState(false);
  const [identityPreviewError, setIdentityPreviewError] = useState<string | null>(null);
  const [storedIdentityReason, setStoredIdentityReason] = useState('');
  const [identityPreviewRetry, setIdentityPreviewRetry] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  const [routeNavigationPending, setRouteNavigationPending] = useState(false);
  const [linkState, setLinkState] = useState<'idle' | 'resolving' | 'ready' | 'processed' | 'outside' | 'not-found'>('idle');
  const [linkedServiceDate, setLinkedServiceDate] = useState<string | null>(null);
  const { mode: viewMode, setMode: setViewMode } = useVerifyViewMode();
  // Supersede warning: non-null while awaiting operator acknowledgment.
  const [supersedeResolve, setSupersedeResolve] = useState<
    ((ack: boolean) => void) | null
  >(null);

  const q = useVerifyQueue(range, routeSheetId ?? null);
  const menuRef = useRef<LineEditorHandle>(null);
  const confirmRef = useRef<ConfirmBarHandle>(null);
  const rejectTriggerRef = useRef<HTMLElement | null>(null);
  const identitySectionRef = useRef<HTMLDivElement>(null);
  const itemsSectionRef = useRef<HTMLDivElement>(null);
  const actionsSectionRef = useRef<HTMLDivElement>(null);
  const handles: FieldsPanelHandles = { menu: menuRef };

  const { syncGroup, tabGroup } = useVerifyFocusNav({
    menu: menuRef,
    confirm: confirmRef,
    setFocused,
  });
  syncGroup(focused?.group ?? 'menu');

  const { current, draft, setDraft } = q;
  const requiresIdentityResolution = current?.bindingKind === 'generic' || current?.bindingKind === 'scanner';
  const identitySelection = identitySheetId === current?.id ? storedIdentitySelection : null;
  const identityPreview = identitySheetId === current?.id ? storedIdentityPreview : null;
  const identityReason = identitySheetId === current?.id ? storedIdentityReason : '';
  const reasonKind = current
    ? reviewReasonKind(identitySelection, current.rankedCandidates, current.scannerEvidence)
    : null;
  const reasonRequired = reasonKind !== null;
  let identityBlockReason: IdentityBlockReason = null;
  if (current) {
    if (requiresIdentityResolution) {
      if (!identitySelection) identityBlockReason = 'selection_required';
      else if (!identityPreview || identityPreview.user.id !== identitySelection.user.id) {
        identityBlockReason = 'preview_required';
      } else if (reasonRequired && !identityReason.trim()) {
        identityBlockReason = reasonKind === 'scanner_review'
          ? 'scanner_review_reason_required'
          : 'reason_required';
      }
    } else if (!current.identity) {
      identityBlockReason = 'issued_identity_missing';
    }
    if (!current.form.serial || !current.form.revision || !current.form.serviceDate) {
      identityBlockReason = requiresIdentityResolution ? 'preview_required' : 'issued_identity_missing';
    }
  }
  const identityReady = Boolean(current) && identityBlockReason === null;
  const confirmationEnabled = current?.bindingKind === 'scanner'
    ? q.scannerConfirmationEnabled
    : q.omrConfirmationEnabled;
  // Hard block: no resolved items to submit.
  const items = draft ? orderItems(draft) : [];
  const blockedNoSelection = items.length === 0;
  // Hard block: at least one line has a non-empty code but no resolved item —
  // the operator must reconcile every flagged line before confirm fires.
  const blockedUnresolvedLine = draft
    ? draft.lines.some((l) => l.codeInput !== '' && l.resolvedItem === null)
    : false;
  const unresolved = draft ? unresolvedCount(draft) : 0;
  const balance = requiresIdentityResolution ? identityPreview?.balance ?? null : current?.balance ?? null;
  const existingOrder = requiresIdentityResolution ? identityPreview?.existingOrder ?? null : current?.existingOrder ?? null;
  const orderAmount = draft ? orderTotal(draft) : 0;
  const insufficientFunds = balance != null && orderAmount > balance;
  const limitCalculation = calculatePurchaseLimits(
    draft?.lines.filter((line) => line.resolvedItem).map((line) => ({
      category: line.resolvedItem!.category,
      price: line.resolvedItem!.unitPrice,
      quantity: line.quantity,
    })) ?? [],
    q.purchaseLimits,
  );
  const blockedCategoryLimit = hasExceededPurchaseLimit(limitCalculation);

  const navigateToSheet = useCallback((sheetId: string | null, nextRange = range) => {
    navigate(buildVerifyUrl(sheetId, nextRange), { replace: true });
  }, [navigate, range]);

  const requestSheetNavigation = useCallback((sheetId: string | null, nextRange = range) => {
    if (draft?.dirty && !window.confirm(t('dirtyNavPrompt'))) return;
    setRouteNavigationPending(true);
    window.setTimeout(() => {
      navigateToSheet(sheetId, nextRange);
      window.setTimeout(() => setRouteNavigationPending(false), 0);
    }, 0);
  }, [draft?.dirty, navigateToSheet, range, t]);

  const focusUnresolved = useCallback(() => menuRef.current?.focusFirst(), []);

  // Returns a promise that resolves when the operator dismisses the supersede
  // warning. True = confirmed (replace), false = cancelled.
  const requestSupersedeAck = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      setSupersedeResolve(() => resolve);
    });
  }, []);

  const { saving, confirm, reject, skip } = useVerifyActions({
    current,
    draft,
    identityReady,
    confirmationEnabled,
    identityBlockReason,
    selectedUserId: requiresIdentityResolution ? identitySelection?.user.id ?? null : null,
    identityReason: reasonRequired ? identityReason.trim() : null,
    existingOrder,
    blockedNoSelection,
    blockedUnresolvedLine,
    blockedCategoryLimit,
    unresolved,
    focusUnresolved,
    advance: q.advance,
    skipForward: q.skipForward,
    onSheetTransition: navigateToSheet,
    requestSupersedeAck,
    onCategoryLimitRejected: (error) => setCategoryLimitError(error.message),
  });

  useEffect(() => {
    if (routeSheetId || q.loading || !q.firstId) return;
    navigateToSheet(q.firstId);
  }, [navigateToSheet, q.firstId, q.loading, routeSheetId]);

  useEffect(() => {
    if (!routeSheetId) {
      setLinkState('idle');
      setLinkedServiceDate(null);
      return;
    }
    let cancelled = false;
    setLinkState('resolving');
    setLinkedServiceDate(null);
    scans.getScan(routeSheetId)
      .then((sheet) => {
        if (cancelled) return;
        setLinkedServiceDate(sheet.serviceDate);
        if (sheet.status !== 'flagged') {
          setLinkState('processed');
          return;
        }
        if (!rangeContains(range, sheet.serviceDate)) {
          if (hasDateContext) {
            setLinkState('outside');
          } else {
            const nextRange = { dateFrom: sheet.serviceDate, dateTo: sheet.serviceDate };
            navigateToSheet(routeSheetId, nextRange);
            setLinkState('ready');
          }
          return;
        }
        setLinkState('ready');
      })
      .catch(() => {
        if (!cancelled) setLinkState('not-found');
      });
    return () => { cancelled = true; };
  }, [hasDateContext, navigateToSheet, range, routeSheetId]);

  // On each new sheet: reset transient UI and autofocus the lowest-confidence field.
  useEffect(() => {
    setZoom(1);
    setFocused(current ? { group: 'menu', position: 0 } : null);
    setCategoryLimitError(null);
    setIdentitySheetId(current?.id ?? null);
    setStoredIdentitySelection(scannerExactIdentitySelection(current));
    setStoredIdentityPreview(null);
    setIdentityPreviewLoading(false);
    setIdentityPreviewError(null);
    setStoredIdentityReason('');
    setIdentityPreviewRetry(0);
    const id = window.setTimeout(() => menuRef.current?.focusFirst(), 0);
    return () => window.clearTimeout(id);
  }, [current]);

  useEffect(() => {
    if (!current || !['generic', 'scanner'].includes(current.bindingKind) ||
      identitySheetId !== current.id || !storedIdentitySelection) {
      return;
    }
    let cancelled = false;
    setIdentityPreviewLoading(true);
    setIdentityPreviewError(null);
    setStoredIdentityPreview(null);
    scans.getIdentityPreview(current.id, storedIdentitySelection.user.id)
      .then((preview) => {
        if (!cancelled) setStoredIdentityPreview(preview);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIdentityPreviewError(error instanceof Error ? error.message : t('identityPreviewFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setIdentityPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current, identityPreviewRetry, identitySheetId, storedIdentitySelection, t]);

  // Action shortcuts go inert while any modal overlay is open.
  const shortcutsEnabled =
    Boolean(current) && !cheatsheet && !rejectOpen && supersedeResolve === null;

  const requestReject = useCallback(() => {
    rejectTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setRejectOpen(true);
  }, []);
  const handleRejectOpenChange = useCallback((open: boolean) => {
    setRejectOpen(open);
    if (!open) {
      window.setTimeout(() => rejectTriggerRef.current?.focus(), 0);
    }
  }, []);
  const requestSkip = useCallback(() => {
    if (draft?.dirty && !window.confirm(t('dirtyNavPrompt'))) return;
    setSkipPending(true);
    void skip().finally(() => setSkipPending(false));
  }, [draft?.dirty, skip, t]);

  useVerifyKeyboard(
    {
      onConfirm: confirm,
      onReject: requestReject,
      onSkip: requestSkip,
      onZoomIn: () => setZoom((z) => Math.min(MAX_ZOOM, z + 0.15)),
      onZoomOut: () => setZoom((z) => Math.max(MIN_ZOOM, z - 0.15)),
      onFit: () => setZoom(1),
      onToggleCheatsheet: () => setCheatsheet((c) => !c),
      onTabGroup: tabGroup,
    },
    shortcutsEnabled,
  );

  useDirtyNavGuard(Boolean(draft?.dirty) && !saving && !skipPending && !routeNavigationPending);

  const identityStepStatus: ReviewStepStatus = identityReady ? 'complete' : 'blocked';
  const itemsStepStatus: ReviewStepStatus = blockedNoSelection || blockedUnresolvedLine || blockedCategoryLimit
    ? 'blocked'
    : unresolved > 0 ? 'attention' : 'complete';
  const actionStepStatus: ReviewStepStatus = !confirmationEnabled || !identityReady || blockedNoSelection || blockedUnresolvedLine || blockedCategoryLimit
    ? 'blocked'
    : insufficientFunds || unresolved > 0 ? 'attention' : 'complete';
  const currentStep = !identityReady ? 'identity' : itemsStepStatus !== 'complete' ? 'items' : 'actions';

  const focusStep = useCallback((target: 'identity' | 'items' | 'actions') => {
    const element = target === 'identity'
      ? identitySectionRef.current
      : target === 'items' ? itemsSectionRef.current : actionsSectionRef.current;
    element?.scrollIntoView({ behavior: 'auto', block: 'start' });
    element?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-h))', margin: '-1.25rem' }}>
      <div className="px-4 pt-4"><AssignedZoneScope /></div>
      <VerifyTopStrip
        datePicker={<DateRangePicker value={range} onChange={(nextRange) => {
          requestSheetNavigation(routeSheetId ?? null, nextRange);
        }} />}
        index={q.index}
        total={q.total}
        flags={current?.flags ?? []}
        onShortcuts={() => setCheatsheet(true)}
        previousDisabled={!q.previousId}
        nextDisabled={!q.nextId}
        onPrevious={() => q.previousId && requestSheetNavigation(q.previousId)}
        onNext={() => q.nextId && requestSheetNavigation(q.nextId)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {q.error && (
        <Banner tone="danger" className="m-4">
          {q.error.message}
        </Banner>
      )}

      {(q.loading || linkState === 'resolving') && !current && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={28} />
        </div>
      )}

      {!q.loading && !current && !q.error && routeSheetId && linkState === 'processed' && (
        <CalmState
          message={t('linkedSheetUnavailable')}
          detail={t('linkedSheetUnavailableHint')}
          action={<Button variant="primary" onClick={() => navigateToSheet(q.firstId)}>{t('returnToQueue')}</Button>}
        />
      )}

      {!q.loading && !current && !q.error && routeSheetId && linkState === 'outside' && linkedServiceDate && (
        <CalmState
          message={t('linkedSheetUnavailable')}
          detail={t('linkedSheetUnavailableHint')}
          action={<Button variant="primary" onClick={() => {
            const nextRange = { dateFrom: linkedServiceDate, dateTo: linkedServiceDate };
            navigateToSheet(routeSheetId, nextRange);
          }}>{t('returnToQueue')}</Button>}
        />
      )}

      {!q.loading && !current && !q.error && routeSheetId && (linkState === 'not-found' || linkState === 'ready') && (
        <CalmState
          message={t('linkedSheetNotFound')}
          action={<Button variant="primary" onClick={() => navigateToSheet(q.firstId)}>{t('returnToQueue')}</Button>}
        />
      )}

      {!q.loading && !current && !q.error && !routeSheetId && (
        <CalmState
          message={t('queueClear')}
          action={
            <Link to="/scan-monitor" className="text-primary underline">
              {t('backToScanMonitor')}
            </Link>
          }
        />
      )}

      {current && draft && (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '52% 48%' }}>
          <SheetImageViewer
            imageUrl={q.imageUrl}
            mediaType={q.imageMediaType}
            loading={q.imageLoading}
            error={q.imageError}
            roiTemplate={q.roiTemplate}
            focused={focused}
            zoom={zoom}
            onRetry={q.retryImage}
          />

          <div className="flex min-h-0 flex-col">
            <ReviewStepGuide
              identityStatus={identityStepStatus}
              itemsStatus={itemsStepStatus}
              actionStatus={actionStepStatus}
              currentStep={currentStep}
              onSelect={focusStep}
            />
            <VerifyFieldsPanel
              className="min-h-0 flex-1"
              draft={draft}
              identity={current.identity}
              balance={balance}
              form={current.form}
              existingOrder={existingOrder}
              identityResolution={requiresIdentityResolution ? {
                sheetId: current.id,
                bindingKind: current.bindingKind === 'scanner' ? 'scanner' : 'generic',
                evidence: current.identityEvidence,
                rankedCandidates: current.rankedCandidates,
                selection: identitySelection,
                preview: identityPreview,
                previewLoading: identityPreviewLoading,
                previewError: identityPreviewError,
                reason: identityReason,
                reasonKind,
                onSelect: (selection) => {
                  setIdentitySheetId(current.id);
                  setStoredIdentitySelection(selection);
                  setStoredIdentityPreview(null);
                  setIdentityPreviewError(null);
                  setStoredIdentityReason('');
                },
                onReasonChange: setStoredIdentityReason,
                onRetryPreview: () => setIdentityPreviewRetry((value) => value + 1),
              } : undefined}
              scannerEvidence={current.scannerEvidence}
              menuItems={q.menuItems}
              handles={handles}
              onLineCodeChange={(li, code) =>
                setDraft(setLineCode(draft, li, code, q.menuItems))
              }
              onLineQtyChange={(li, qty) => setDraft(setLineQty(draft, li, qty))}
              onAddLine={() => setDraft(addLine(draft))}
              onRemoveLine={(li) => setDraft(removeLine(draft, li))}
              onLineFocus={(lineIndex) => setFocused({ group: 'menu', position: lineIndex })}
              onRetryArtifact={async (artifactId) => {
                await scans.retryScannerArtifact(current.id, artifactId);
                q.reload();
              }}
              onRejectScanner={requestReject}
              limitCalculation={limitCalculation}
              categoryLimitError={categoryLimitError}
              onRefreshLimits={async () => {
                await q.refreshReferenceData();
                setCategoryLimitError(null);
              }}
              viewMode={viewMode}
              identitySectionRef={identitySectionRef}
              itemsSectionRef={itemsSectionRef}
            />
            <div ref={actionsSectionRef} tabIndex={-1}>
              <ConfirmBar
                ref={confirmRef}
                unresolved={unresolved}
                identityReady={identityReady}
                confirmationEnabled={confirmationEnabled}
                identityBlockReason={identityBlockReason}
                blockedNoSelection={blockedNoSelection}
                blockedUnresolvedLine={blockedUnresolvedLine}
                blockedCategoryLimit={blockedCategoryLimit}
                balance={balance}
                orderTotal={orderAmount}
                insufficientFunds={insufficientFunds}
                saving={saving}
                onConfirm={confirm}
                onReject={requestReject}
                onSkip={requestSkip}
              />
            </div>
          </div>
        </div>
      )}

      {/* Supersede warning — blocking modal; only shown while operator must ack */}
      {supersedeResolve && existingOrder && (
        <SupersedeWarning
          existingOrder={existingOrder}
          onConfirm={() => {
            supersedeResolve(true);
            setSupersedeResolve(null);
          }}
          onCancel={() => {
            supersedeResolve(false);
            setSupersedeResolve(null);
          }}
        />
      )}

      <KeyboardCheatsheet open={cheatsheet} onOpenChange={setCheatsheet} />
      <RejectConfirmationDialog
        open={rejectOpen}
        saving={saving}
        onOpenChange={handleRejectOpenChange}
        onConfirm={() => { void reject().finally(() => setRejectOpen(false)); }}
      />
    </div>
  );
}

function CalmState({ message, detail, action }: { message: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-fg">
      <span aria-hidden="true" className="text-4xl">
        ✓
      </span>
      <p className="text-[15px]">{message}</p>
      {detail && <p className="max-w-lg text-sm">{detail}</p>}
      {action}
    </div>
  );
}
