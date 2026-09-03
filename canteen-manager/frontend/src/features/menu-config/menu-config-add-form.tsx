import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Input, Select } from '@/ui';
import type { ItemCategory } from '@/lib/types';

interface MenuConfigAddFormProps {
  busy: boolean;
  // Returns true on success so the form can clear its fields.
  onAdd: (name: string, price: number, category: ItemCategory) => Promise<boolean>;
}

// Add-item row: name + integer VND price. Price must be a non-negative integer
// (commissary prices have no fractional VND), enforced before enabling submit.
export function MenuConfigAddForm({ busy, onAdd }: MenuConfigAddFormProps) {
  const { t } = useTranslation('menu');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<ItemCategory>('food');

  const parsedPrice = Number(price);
  const canAdd =
    !busy && name.trim().length > 0 && Number.isInteger(parsedPrice) && parsedPrice >= 0;

  async function handleAdd() {
    if (!canAdd) return;
    const ok = await onAdd(name.trim(), parsedPrice, category);
    if (ok) {
      setName('');
      setPrice('');
      setCategory('food');
    }
  }

  return (
    <Card className="mb-4">
      <div className="flex items-end gap-3">
        <Field label={t('addLabel')} htmlFor="add-name" className="flex-1 mb-0">
          <Input
            id="add-name"
            value={name}
            placeholder={t('addPlaceholder')}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('addPriceLabel')} htmlFor="add-price" className="w-40 mb-0">
          <Input
            id="add-price"
            type="number"
            min={0}
            step={1}
            value={price}
            placeholder={t('addPricePlaceholder')}
            disabled={busy}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label={t('addCategoryLabel')} htmlFor="add-category" className="w-44 mb-0">
          <Select id="add-category" value={category} onValueChange={(value) => setCategory(value as ItemCategory)} items={[
            { value: 'food', label: t('categoryFood') },
            { value: 'essential', label: t('categoryEssential') },
          ]} />
        </Field>
        <Button variant="primary" disabled={!canAdd} onClick={handleAdd}>
          {t('addButton')}
        </Button>
      </div>
    </Card>
  );
}
