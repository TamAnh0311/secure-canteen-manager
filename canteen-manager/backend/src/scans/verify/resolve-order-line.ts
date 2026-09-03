import { MenuItem } from '../../menu/menu-item.entity';
import { CODE_DIGIT_COUNT } from '../../menu/menu.service';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';

export interface ResolvedItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
  inactive: boolean;
  category: MenuItemCategory;
}

/**
 * Resolves a handwritten code string to a menu item.
 *
 * Rules (authoritative, server-side — never delegate this to the UI):
 *  1. null code → null (ICR could not read a digit with sufficient confidence)
 *  2. non-numeric (any char outside 0-9) → null
 *  3. digit count ≠ CODE_DIGIT_COUNT → null; a stray extra digit must NOT silently
 *     match a numerically-equal shorter code (e.g. "0010" must not hit "010")
 *  4. no exact-string match among all menu items (active AND inactive) → null
 *
 * Inactive items resolve on the omr path — the position was printed on a form that
 * may still be in the field; resolving inactive preserves the "ordered the dish on
 * the printed form" semantics even when the dish was later retired from the menu.
 */
export function resolveCode(code: string | null, menuItems: MenuItem[]): ResolvedItem | null {
  if (code === null) return null;

  // Reject non-numeric codes (includes alphabetic prefixes, spaces, punctuation)
  if (!/^[0-9]+$/.test(code)) return null;

  // Reject wrong digit count. Exact length check prevents a stray extra digit from
  // silently matching a different valid item via numeric equivalence — the box count
  // is a hard constraint baked into the printed form.
  if (code.length !== CODE_DIGIT_COUNT) return null;

  // Exact-string match against the canonical stored code (uniform CODE_DIGIT_COUNT-width
  // after the fixed-width backfill migration). Includes inactive items.
  const item = menuItems.find((m) => m.code === code);
  if (!item) return null;

  return {
    menuItemId: item.id,
    name: item.name,
    unitPrice: item.price,
    inactive: !item.isActive,
    category: item.category,
  };
}
