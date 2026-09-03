import { useTranslation } from 'react-i18next';
import { Button, Td, Tr } from '@/ui';
import { formatVnd } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

export interface MenuConfigRowProps {
  item: MenuItem;
  // True once the OMR form is generated: reorder/rename/delete are permanently
  // locked so printed checkbox rows stay bound to their items. Only the active
  // toggle stays live.
  locked: boolean;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (item: MenuItem, dir: -1 | 1) => void;
  onToggleActive: (item: MenuItem) => void;
  onEdit: (item: MenuItem) => void;
  onRemove: (item: MenuItem) => void;
}

export function MenuConfigRow({
  item,
  locked,
  isFirst,
  isLast,
  busy,
  onMove,
  onToggleActive,
  onEdit,
  onRemove,
}: MenuConfigRowProps) {
  const { t } = useTranslation('menu');

  return (
    <Tr>
      <Td>
        <span className="font-mono text-sm">{item.code}</span>
      </Td>
      <Td>
        <span className={item.isActive ? '' : 'text-muted-fg line-through'}>{item.name}</span>
      </Td>
      <Td numeric>
        <span className="tabular-nums text-sm">{formatVnd(item.price)}</span>
      </Td>
      <Td>{t(item.category === 'food' ? 'categoryFood' : 'categoryEssential')}</Td>
      <Td>
        <button
          type="button"
          role="switch"
          aria-checked={item.isActive}
          aria-label={item.isActive ? t('active') : t('off')}
          disabled={busy}
          onClick={() => onToggleActive(item)}
          className={[
            'inline-flex h-5 w-9 items-center rounded-full transition-colors',
            item.isActive ? 'bg-primary' : 'bg-muted',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-4 w-4 rounded-full bg-card transition-transform',
              item.isActive ? 'translate-x-4' : 'translate-x-0.5',
            ].join(' ')}
          />
        </button>
      </Td>
      <Td>
        <span className="font-mono text-xs text-muted-fg">{item.position}</span>
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('moveUp')}
            disabled={locked || busy || isFirst}
            onClick={() => onMove(item, -1)}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('moveDown')}
            disabled={locked || busy || isLast}
            onClick={() => onMove(item, 1)}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('edit')}
            disabled={busy}
            onClick={() => onEdit(item)}
          >
            {t('edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('remove')}
            disabled={locked || busy}
            onClick={() => onRemove(item)}
          >
            {t('remove')}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}
