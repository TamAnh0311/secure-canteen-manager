import { forwardRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExistingOrderSummary, FullMenuItem, MatchedUser, QueueSheetItem } from '@/lib/types';
import { LockedIdentityBanner } from './locked-identity-banner';
import { LineEditor, type LineEditorHandle } from './line-editor';
import type { SheetDraft } from './verify-model';
import type { PurchaseLimitCalculation } from '@/lib/purchase-limits';
import { PurchaseLimitSummary } from '@/features/_shared/purchase-limit-summary';
import { PurchaseLimitExceededBanner } from '@/features/_shared/purchase-limit-exceeded-banner';
import { Banner, Button } from '@/ui';
import {
  IdentityResolutionPanel,
  type IdentityResolutionPanelProps,
} from './identity-resolution-panel';
import { ScannerEvidencePanel } from './scanner-evidence-panel';
import type { VerifyViewMode } from './use-verify-view-mode';

export interface FieldsPanelHandles {
  menu: RefObject<LineEditorHandle>;
}

interface VerifyFieldsPanelProps {
  draft: SheetDraft;
  identity: MatchedUser | null;
  balance: number | null;
  form: QueueSheetItem['form'];
  existingOrder: ExistingOrderSummary | null;
  identityResolution?: Omit<IdentityResolutionPanelProps, 'form'>;
  scannerEvidence?: QueueSheetItem['scannerEvidence'];
  menuItems: FullMenuItem[];
  handles: FieldsPanelHandles;
  onLineCodeChange: (lineIndex: number, code: string) => void;
  onLineQtyChange: (lineIndex: number, qty: number) => void;
  onAddLine: () => void;
  onRemoveLine: (lineIndex: number) => void;
  onLineFocus?: (lineIndex: number) => void;
  onRetryArtifact?: (artifactId: string) => Promise<void>;
  onRejectScanner?: () => void;
  limitCalculation: PurchaseLimitCalculation;
  categoryLimitError?: string | null;
  onRefreshLimits?: () => Promise<void>;
  className?: string;
  viewMode?: VerifyViewMode;
  identitySectionRef?: RefObject<HTMLDivElement>;
  itemsSectionRef?: RefObject<HTMLDivElement>;
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.06em] text-muted-fg font-semibold mb-2">
      {children}
    </div>
  );
}

// Scrollable right-pane field stack: immutable issued identity -> editable lines.
export const VerifyFieldsPanel = forwardRef<HTMLDivElement, VerifyFieldsPanelProps>(
  function VerifyFieldsPanel(
    {
      draft,
      identity,
      balance,
      form,
      existingOrder,
      identityResolution,
      scannerEvidence,
      menuItems,
      handles,
      onLineCodeChange,
      onLineQtyChange,
      onAddLine,
      onRemoveLine,
      onLineFocus,
      onRetryArtifact,
      onRejectScanner,
      limitCalculation,
      categoryLimitError,
      onRefreshLimits,
      className,
      viewMode = 'guided',
      identitySectionRef,
      itemsSectionRef,
    },
    ref,
  ) {
    const { t } = useTranslation('verify');

    return (
      <div ref={ref} className={['flex flex-col gap-4 overflow-auto bg-background px-5 py-4', className].filter(Boolean).join(' ')}>
        <div ref={identitySectionRef} tabIndex={-1}>
          {identityResolution ? (
            <IdentityResolutionPanel {...identityResolution} form={form} />
          ) : (
            <LockedIdentityBanner
              identity={identity}
              balance={balance}
              form={form}
              existingOrder={existingOrder}
            />
          )}
        </div>

        {scannerEvidence && (
          viewMode === 'detailed' ? (
            <ScannerEvidencePanel
              evidence={scannerEvidence}
              onSelectItemCandidate={onLineCodeChange}
              onRetryArtifact={onRetryArtifact}
              onReject={onRejectScanner}
            />
          ) : scannerEvidence.artifacts.some((artifact) => artifact.state !== 'available') ? (
            <Banner tone={scannerEvidence.reviewState === 'evidence_fault' ? 'danger' : 'warning'}>
              {t(scannerEvidence.reviewState === 'evidence_fault' ? 'scannerArtifactsTerminal' : 'scannerArtifactsPending')}
              {onRetryArtifact && scannerEvidence.artifacts.find((artifact) => artifact.state !== 'available' && artifact.state !== 'purged') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() => {
                    const artifact = scannerEvidence.artifacts.find((item) => item.state !== 'available' && item.state !== 'purged');
                    if (artifact) void onRetryArtifact(artifact.artifactId);
                  }}
                >
                  {t('scannerArtifactRetry')}
                </Button>
              )}
              {onRejectScanner && scannerEvidence.artifacts.some((artifact) =>
                ['missing', 'permanent_failed', 'integrity_fault', 'purged'].includes(artifact.state),
              ) && (
                <Button variant="ghost" size="sm" className="ml-2" onClick={onRejectScanner}>
                  {t('confirmReject')}
                </Button>
              )}
            </Banner>
          ) : null
        )}

        <div ref={itemsSectionRef} tabIndex={-1}>
          <GroupLabel>{t('groupMenu')}</GroupLabel>
          {categoryLimitError && (
            <Banner tone="danger" className="mb-3">
              {categoryLimitError}
              {onRefreshLimits && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-2"
                  onClick={() => { void onRefreshLimits().catch(() => undefined); }}
                >
                  {t('refreshLimits')}
                </Button>
              )}
            </Banner>
          )}
          <LineEditor
            ref={handles.menu}
            lines={draft.lines}
            menuItems={menuItems}
            onLineCodeChange={onLineCodeChange}
            onLineQtyChange={onLineQtyChange}
            onAddLine={onAddLine}
            onRemoveLine={onRemoveLine}
            onItemFocus={onLineFocus}
          />
          <div className="mt-3"><PurchaseLimitSummary calculation={limitCalculation} namespace="verify" /></div>
          <PurchaseLimitExceededBanner calculation={limitCalculation} namespace="verify" className="mt-2" />
        </div>
      </div>
    );
  },
);
