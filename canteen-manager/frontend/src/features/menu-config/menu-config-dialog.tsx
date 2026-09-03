import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  Input,
  Select,
} from '@/ui';
import type { ItemCategory, MenuItem } from '@/lib/types';

// Edit name + price for a single item. Name editing is only reachable while the
// menu is unlocked (the page gates the Edit control), so the dialog itself need
// not re-check the lock.
export interface EditItemDialogProps {
  item: MenuItem;
  busy: boolean;
  locked?: boolean;
  onSave: (item: MenuItem, body: { name?: string; price: number; category: ItemCategory }) => void;
  onClose: () => void;
}

export function EditItemDialog({ item, busy, locked = false, onSave, onClose }: EditItemDialogProps) {
  const { t } = useTranslation('menu');
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [category, setCategory] = useState<ItemCategory>(item.category);

  const parsedPrice = Number(price);
  const valid = name.trim().length > 0 && Number.isInteger(parsedPrice) && parsedPrice >= 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{t('editTitle')}</DialogTitle>
        <div className="mt-4">
          <Field label={t('editNameLabel')} htmlFor="edit-name" required>
            <Input
              id="edit-name"
              value={name}
              disabled={busy || locked}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('editCategoryLabel')} htmlFor="edit-category" required>
            <Select id="edit-category" value={category} disabled={busy} onValueChange={(value) => setCategory(value as ItemCategory)} items={[
              { value: 'food', label: t('categoryFood') },
              { value: 'essential', label: t('categoryEssential') },
            ]} />
          </Field>
          <Field label={t('editPriceLabel')} htmlFor="edit-price" required>
            <Input
              id="edit-price"
              type="number"
              min={0}
              step={1}
              value={price}
              disabled={busy}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('editCancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || !valid}
            onClick={() => onSave(item, { ...(locked ? {} : { name: name.trim() }), price: parsedPrice, category })}
          >
            {t('editSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface DeleteItemDialogProps {
  item: MenuItem;
  busy: boolean;
  onConfirm: (item: MenuItem) => void;
  onClose: () => void;
}

export function DeleteItemDialog({ item, busy, onConfirm, onClose }: DeleteItemDialogProps) {
  const { t } = useTranslation('menu');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent maxWidth={400}>
        <DialogTitle>{t('deleteTitle')}</DialogTitle>
        <DialogDescription>{t('deleteConfirm', { name: item.name })}</DialogDescription>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('deleteCancel')}
          </Button>
          <Button variant="danger" loading={busy} disabled={busy} onClick={() => onConfirm(item)}>
            {t('deleteConfirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
