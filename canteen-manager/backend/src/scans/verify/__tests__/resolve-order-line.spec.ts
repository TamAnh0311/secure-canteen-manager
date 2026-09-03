import { resolveCode } from '../resolve-order-line';
import { MenuItem } from '../../../menu/menu-item.entity';
import { MenuItemCategory } from '../../../menu/menu-item-category.enum';

function makeItem(code: string, id: string, isActive = true): MenuItem {
  return { id, code, name: `item-${code}`, price: 1000, position: 0, category: MenuItemCategory.FOOD, isActive } as MenuItem;
}

const ITEMS: MenuItem[] = [
  makeItem('001', 'id-001'),
  makeItem('002', 'id-002'),
  makeItem('003', 'id-003-inactive', false),
  makeItem('010', 'id-010'),
];

describe('resolveCode', () => {
  it('resolves a known code to its menu item', () => {
    const result = resolveCode('001', ITEMS);
    expect(result).not.toBeNull();
    expect(result?.menuItemId).toBe('id-001');
    expect(result?.name).toBe('item-001');
    expect(result?.unitPrice).toBe(1000);
    expect(result?.inactive).toBe(false);
    expect(result?.category).toBe(MenuItemCategory.FOOD);
  });

  it('resolves an inactive item on the omr path', () => {
    const result = resolveCode('003', ITEMS);
    expect(result).not.toBeNull();
    expect(result?.menuItemId).toBe('id-003-inactive');
    expect(result?.inactive).toBe(true);
  });

  it('returns null for null code', () => {
    expect(resolveCode(null, ITEMS)).toBeNull();
  });

  it('returns null for non-numeric code', () => {
    expect(resolveCode('abc', ITEMS)).toBeNull();
    expect(resolveCode('A01', ITEMS)).toBeNull();
    expect(resolveCode('1a1', ITEMS)).toBeNull();
  });

  it('returns null for wrong digit count (too short)', () => {
    // digit count ≠ CODE_DIGIT_COUNT (3) → null, even if item exists for that numeric value
    expect(resolveCode('01', ITEMS)).toBeNull();
    expect(resolveCode('1', ITEMS)).toBeNull();
  });

  it('returns null for wrong digit count (too long — stray extra digit)', () => {
    // '0010' is 4 chars → digit count mismatch; must NOT hit item '010'
    expect(resolveCode('0010', ITEMS)).toBeNull();
    // '0001' is 4 chars → must NOT hit item '001'
    expect(resolveCode('0001', ITEMS)).toBeNull();
  });

  it('stray extra digit does NOT silently resolve to a different valid item', () => {
    // Ensure '0010' cannot slip through to match '010' numerically
    const result010 = resolveCode('010', ITEMS);
    expect(result010?.menuItemId).toBe('id-010');

    const resultStray = resolveCode('0010', ITEMS);
    expect(resultStray).toBeNull();
  });

  it('returns null for an unknown code with correct digit count', () => {
    expect(resolveCode('999', ITEMS)).toBeNull();
    expect(resolveCode('005', ITEMS)).toBeNull();
  });

  it('exact-string match only — no numeric equivalence', () => {
    // '1' does not match '001' even though they are numerically equal
    expect(resolveCode('1', ITEMS)).toBeNull();
  });
});
