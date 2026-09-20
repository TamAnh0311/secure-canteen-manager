import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { menu } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import {
  Banner,
  Button,
  Card,
  EmptyRow,
  PageHeader,
  Spinner,
  Table,
  TBody,
  Th,
  THead,
  Tr,
  useToast,
} from '@/ui';
import type { MenuItem } from '@/lib/types';
import { MenuConfigRow } from './menu-config-row';
import { MenuConfigAddForm } from './menu-config-add-form';
import { DeleteItemDialog, EditItemDialog } from './menu-config-dialog';
import { PurchaseLimitsCard } from './purchase-limits-card';

export function MenuConfigPage() {
  const { t } = useTranslation('menu');
  const { toast } = useToast();

  const items = useQuery(() => menu.listMenu(), []);

  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);
  const [busy, setBusy] = useState(false);

  const list = items.data ?? [];

  const run = useCallback(
    async (action: () => Promise<unknown>, successKey: string) => {
      setBusy(true);
      try {
        await action();
        items.refetch();
        toast({ tone: 'success', message: t(successKey) });
        return true;
      } catch (err) {
        toast({ tone: 'danger', message: err instanceof Error ? err.message : t('toastError') });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [items, toast, t],
  );

  function handleMove(item: MenuItem, dir: -1 | 1) {
    const idx = list.findIndex((i) => i.id === item.id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= list.length) return;
    const ids = list.map((i) => i.id);
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    void run(() => menu.reorderMenu(ids), 'toastReordered');
  }

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
      />

      {items.error && (
        <Banner tone="danger" className="mb-4">
          {items.error.message}
        </Banner>
      )}

      <PurchaseLimitsCard />

      <MenuConfigAddForm
        busy={busy}
        onAdd={(name, price, category) => run(() => menu.createMenuItem(name, price, category), 'toastCreated')}
      />

      <Card className="p-0">
        {items.loading && !items.data && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}
        <Table>
          <THead>
            <Tr>
              <Th>{t('colCode')}</Th>
              <Th>{t('colName')}</Th>
              <Th numeric>{t('colPrice')}</Th>
              <Th>{t('colCategory')}</Th>
              <Th>{t('colActive')}</Th>
              <Th>{t('colPosition')}</Th>
              <Th>{t('colActions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {!items.loading && list.length === 0 ? (
              <EmptyRow colSpan={7}>{t('noItems')}</EmptyRow>
            ) : (
              list.map((item, idx) => (
                <MenuConfigRow
                  key={item.id}
                  item={item}
                  locked={false}
                  isFirst={idx === 0}
                  isLast={idx === list.length - 1}
                  busy={busy}
                  onMove={handleMove}
                  onToggleActive={(it) =>
                    run(() => menu.updateMenuItem(it.id, { isActive: !it.isActive }), 'toastToggled')
                  }
                  onEdit={setEditing}
                  onRemove={setDeleting}
                />
              ))
            )}
          </TBody>
        </Table>
      </Card>

      {editing && (
        <EditItemDialog
          item={editing}
          busy={busy}
          locked={false}
          onClose={() => setEditing(null)}
          onSave={(it, body) =>
            run(() => menu.updateMenuItem(it.id, body), 'toastUpdated').then((ok) => {
              if (ok) setEditing(null);
            })
          }
        />
      )}
      {deleting && (
        <DeleteItemDialog
          item={deleting}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={(it) =>
            run(() => menu.removeMenuItem(it.id), 'toastRemoved').then((ok) => {
              if (ok) setDeleting(null);
            })
          }
        />
      )}
    </>
  );
}
