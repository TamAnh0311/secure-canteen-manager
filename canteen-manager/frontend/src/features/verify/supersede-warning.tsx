import { useTranslation } from 'react-i18next';
import { Button } from '@/ui';
import { formatVnd } from '@/lib/format';
import type { ExistingOrderSummary } from '@/lib/types';

interface SupersedeWarningProps {
  // null = no prior order; component renders nothing.
  existingOrder: ExistingOrderSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Blocking overlay that surfaces the prior active OMR order before the operator
// confirms. Confirming REPLACES (not appends) the existing order — this warning
// ensures the operator sees exactly what will be reversed before proceeding.
export function SupersedeWarning({ existingOrder, onConfirm, onCancel }: SupersedeWarningProps) {
  const { t } = useTranslation('verify');

  if (!existingOrder) return null;

  return (
    <div
      data-testid="supersede-warning"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="supersede-title"
      aria-describedby="supersede-desc"
    >
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-xl p-6 flex flex-col gap-4">
        <div>
          <h2
            id="supersede-title"
            className="text-base font-semibold text-danger flex items-center gap-2"
          >
            <span aria-hidden="true">⚠</span>
            {t('supersedeTitle')}
          </h2>
          <p id="supersede-desc" className="text-sm text-muted-fg mt-1">
            {t('supersedeBody')}
          </p>
        </div>

        {/* Prior order item list */}
        <ul className="text-sm divide-y divide-border rounded-md border border-border overflow-hidden">
          {existingOrder.items.map((item) => (
            <li
              key={item.menuItemId}
              className="flex justify-between items-center px-3 py-2 bg-muted/40"
            >
              <span>
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-fg ml-1.5">× {item.quantity}</span>
              </span>
              <span className="tabular-nums text-muted-fg">
                {formatVnd(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        {/* Prior order total */}
        <div className="flex justify-between items-center text-sm font-semibold">
          <span>{t('supersedePriorTotal')}</span>
          <span data-testid="supersede-prior-total" className="tabular-nums text-danger">
            {formatVnd(existingOrder.total)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            data-testid="supersede-cancel-btn"
            variant="outline"
            size="md"
            onClick={onCancel}
          >
            {t('supersedeCancel')}
          </Button>
          <Button
            data-testid="supersede-confirm-btn"
            variant="danger"
            size="md"
            onClick={onConfirm}
          >
            {t('supersedeReplace')}
          </Button>
        </div>
      </div>
    </div>
  );
}
