import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, StatusChip } from '@/ui';
import type { VerifyViewMode } from './use-verify-view-mode';

interface VerifyTopStripProps {
  datePicker: ReactNode;
  index: number;
  total: number;
  flags: string[];
  onShortcuts: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  viewMode: VerifyViewMode;
  onViewModeChange: (mode: VerifyViewMode) => void;
}

// Sheet position, date-range filter, sort note, and a progress bar over the queue.
// Position is 1-based for the operator; progress reflects how much of the loaded
// queue is behind the cursor.
export function VerifyTopStrip({
  datePicker,
  index,
  total,
  flags,
  onShortcuts,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  viewMode,
  onViewModeChange,
}: VerifyTopStripProps) {
  const { t } = useTranslation('verify');
  const position = total === 0 ? 0 : index + 1;
  const pct = total === 0 ? 0 : Math.round((index / total) * 100);

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-2.5">
      <div className="flex items-center gap-3.5">
        <Link
          to="/scan-monitor"
          className="text-[13px] text-muted-fg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          {t('backQueue')}
        </Link>
        <b className="font-mono">
          {t('sheetPosition', { position, total })}
        </b>
        {flags.includes('NOT_MATCHED') && <StatusChip tone="danger" label={t('flagNotMatched')} dot />}
        {flags.includes('LOW_CONFIDENCE') && <StatusChip tone="warning" label={t('flagLowConfidence')} dot />}
        <span className="text-xs text-muted-fg">{t('sortNote')}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1" aria-label={t('sheetPosition', { position, total })}>
          <Button variant="outline" size="sm" onClick={onPrevious} disabled={previousDisabled}>
            ← {t('previousSheet')}
          </Button>
          <Button variant="outline" size="sm" onClick={onNext} disabled={nextDisabled}>
            {t('nextSheet')} →
          </Button>
        </div>
        <div className="flex items-center rounded-md border border-border bg-background p-0.5" aria-label={t('viewModeLabel')}>
          {(['guided', 'detailed'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode}
              className={[
                'rounded px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                viewMode === mode ? 'bg-primary text-primary-fg' : 'text-muted-fg hover:text-foreground',
              ].join(' ')}
              onClick={() => onViewModeChange(mode)}
            >
              {t(mode === 'guided' ? 'viewModeGuided' : 'viewModeDetailed')}
            </button>
          ))}
        </div>
        {datePicker}
        <div
          className="h-1 w-40 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('queueProgress')}
        >
          <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <Button variant="outline" size="sm" onClick={onShortcuts}>
          {t('shortcuts')}
        </Button>
      </div>
    </div>
  );
}
