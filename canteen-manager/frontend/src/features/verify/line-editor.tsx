import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui';
import { formatVnd } from '@/lib/format';
import type { FullMenuItem } from '@/lib/types';
import { lineHasUnresolvedReview, type LineDraft } from './verify-model';

export interface LineEditorHandle {
  focusFirst: () => void;
}

interface LineEditorProps {
  lines: LineDraft[];
  menuItems: FullMenuItem[];
  onLineCodeChange: (lineIndex: number, code: string) => void;
  onLineQtyChange: (lineIndex: number, qty: number) => void;
  onAddLine: () => void;
  onRemoveLine: (lineIndex: number) => void;
  onItemFocus?: (lineIndex: number) => void;
}

// Border accent per confidence state — matches DigitRow underline convention.
const rowBorder: Record<'normal' | 'low', string> = {
  normal: 'border-b-transparent',
  low: 'border-b-danger',
};

// One editable row: code input → resolved item name + price, qty spinner, remove button.
// Low-confidence rows get a red underline so the operator can spot them at a glance.
export const LineEditor = forwardRef<LineEditorHandle, LineEditorProps>(function LineEditor(
  { lines, menuItems: _menuItems, onLineCodeChange, onLineQtyChange, onAddLine, onRemoveLine, onItemFocus },
  ref,
) {
  const { t } = useTranslation('verify');
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focusFirst: () => firstInputRef.current?.focus(),
  }));

  // Running total across all resolved lines.
  const total = lines.reduce(
    (sum, l) => (l.resolvedItem ? sum + l.resolvedItem.unitPrice * l.quantity : sum),
    0,
  );
  const canAddCodeLine = lines.some((line) => line.mappingAuthority === 'code');

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[4rem_minmax(0,1fr)_4rem_8rem_2rem] gap-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        <span>{t('lineCodeHeader')}</span>
        <span>{t('lineNameHeader')}</span>
        <span>{t('lineQtyHeader')}</span>
        <span>{t('lineStateHeader')}</span>
        <span aria-hidden="true" />
      </div>
      {lines.map((line, i) => {
        const hasCode = line.codeInput !== '';
        const invalid = hasCode && line.resolvedItem === null;
        const errorId = `line-code-error-${line.lineIndex}`;
        const accent = lineHasUnresolvedReview(line) ? 'low' : 'normal';

        return (
          <div
            key={line.lineIndex}
            data-testid={`line-row-${line.lineIndex}`}
            className={[
              'grid grid-cols-[4rem_minmax(0,1fr)_4rem_8rem_2rem] items-center gap-2 px-3 py-2 bg-card border border-border rounded-md border-b-[3px]',
              rowBorder[accent],
              'focus-within:border-primary focus-within:ring-[3px] focus-within:ring-accent-subtle',
            ].join(' ')}
          >
            {/* Printed template rows bind identity; code-mode rows stay correctable. */}
            {line.mappingAuthority === 'template_row' ? (
              <span
                aria-label={`${t('lineCodeLabel', { index: line.lineIndex + 1 })} (${t('lineCodeHeader')})`}
                className="w-16 h-8 border border-border rounded px-2 inline-flex items-center justify-center text-sm font-mono bg-muted text-foreground"
              >
                {line.codeInput}
              </span>
            ) : (
              <input
                ref={i === 0 ? firstInputRef : undefined}
                type="text"
                inputMode="numeric"
                maxLength={3}
                value={line.codeInput}
                aria-label={`${t('lineCodeLabel', { index: line.lineIndex + 1 })} (${t('lineCodeHeader')})`}
                aria-invalid={invalid}
                aria-describedby={invalid ? errorId : undefined}
                onFocus={() => onItemFocus?.(line.lineIndex)}
                onChange={(e) => onLineCodeChange(line.lineIndex, e.target.value)}
                className={[
                  'w-16 h-8 border rounded px-2 text-sm font-mono text-center bg-card text-foreground',
                  'focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-accent-subtle',
                  invalid ? 'border-danger text-danger' : 'border-input',
                ].join(' ')}
              />
            )}

            {/* Resolved item info or error */}
            <span className="flex-1 text-sm min-w-0">
              {line.resolvedItem ? (
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium truncate">{line.resolvedItem.name}</span>
                  {line.mappingAuthority === 'template_row' && (
                    <span className="font-mono text-[10px] font-semibold px-1.5 py-px rounded-[4px] bg-accent-subtle text-primary shrink-0">
                      {t('linePrintedIdentityLocked')}
                    </span>
                  )}
                  {line.resolvedItem.inactive && (
                    <span
                      data-testid={`inactive-badge-${line.lineIndex}`}
                      className="font-mono text-[10px] font-semibold px-1.5 py-px rounded-[4px] bg-neutral-100 text-neutral-500 shrink-0"
                    >
                      {t('lineInactiveBadge')}
                    </span>
                  )}
                  <span className="text-xs text-muted-fg shrink-0 tabular-nums">
                    {formatVnd(line.resolvedItem.unitPrice)}
                  </span>
                  <span className="text-xs text-muted-fg">{t(line.resolvedItem.category === 'food' ? 'categoryFood' : 'categoryEssential')}</span>
                </span>
              ) : hasCode ? (
                <span
                  id={errorId}
                  data-testid={`unknown-code-${line.lineIndex}`}
                  className="text-danger text-xs font-medium"
                >
                  {t('lineUnknownCode')}
                </span>
              ) : (
                <span className="text-muted-fg text-xs">{t('lineCodeLabel', { index: line.lineIndex + 1 })}</span>
              )}
            </span>

            {/* Quantity input */}
            <input
              ref={i === 0 && line.mappingAuthority === 'template_row' ? firstInputRef : undefined}
              type="number"
              min={1}
              max={99}
              value={line.quantity}
              aria-label={`${t('lineQtyLabel', { index: line.lineIndex + 1 })} (${t('lineQtyHeader')})`}
              onFocus={() => onItemFocus?.(line.lineIndex)}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= 99) onLineQtyChange(line.lineIndex, v);
              }}
              className={[
                'w-14 h-8 border border-input rounded px-2 text-sm text-center bg-card text-foreground',
                'focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-accent-subtle',
              ].join(' ')}
            />

            <span className={[
              'text-xs font-semibold',
              accent === 'low' || invalid ? 'text-danger' : 'text-success',
            ].join(' ')}>
              {t(accent === 'low' || invalid ? 'lineStateNeedsReview' : 'lineStateReady')}
            </span>

            {/* Remove button */}
            {line.mappingAuthority === 'code' && (
              <button
                type="button"
                aria-label={t('lineRemove', { index: line.lineIndex + 1 })}
                onClick={() => onRemoveLine(line.lineIndex)}
                className={[
                  'h-8 w-8 flex items-center justify-center rounded text-muted-fg shrink-0',
                  'hover:bg-danger-bg hover:text-danger transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ].join(' ')}
              >
                ×
              </button>
            )}
            {line.mappingAuthority !== 'code' && <span aria-hidden="true" />}
          </div>
        );
      })}

      {/* Add line + running total */}
      <div className="flex items-center justify-between mt-1">
        {canAddCodeLine && (
          <Button variant="ghost" size="sm" type="button" onClick={onAddLine}>
            + {t('lineAdd')}
          </Button>
        )}
        {total > 0 && (
          <span
            data-testid="line-editor-total"
            className="text-sm font-semibold tabular-nums text-foreground"
          >
            {t('lineTotalLabel')} {formatVnd(total)}
          </span>
        )}
      </div>

      {/* Low-confidence hint */}
      {lines.some(lineHasUnresolvedReview) && (
        <p className="text-xs text-danger mt-1">{t('lineLowConfidenceHint')}</p>
      )}
    </div>
  );
});
