import { assembleQueueItem, assembleMenuItems } from '../verify-queue.assembler';
import { Sheet } from '../../sheet.entity';
import { SheetStatus } from '../../sheet-status.enum';
import { User } from '../../../users/user.entity';
import { MenuItem } from '../../../menu/menu-item.entity';
import { Order, OrderStatus, PaymentStatus } from '../../../orders/order.entity';
import { OrderItem } from '../../../orders/order-item.entity';
import { MenuItemCategory } from '../../../menu/menu-item-category.enum';

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: 'sheet-1',
    sheetId: 'S-1001',
    status: SheetStatus.FLAGGED,
    avgConfidence: 0.72,
    recognizedId: '100001',
    matchedUserId: 'user-1',
    flags: ['FLAG_DIGIT_IDX_2'],
    resultJson: {
      id_digits: [
        { index: 0, value: 1, confidence: 0.96 },
        { index: 1, value: 0, confidence: 0.96 },
        { index: 2, value: 0, confidence: 0.45 },
      ],
      order_lines: [
        {
          line_index: 0,
          code: '001',
          qty: 2,
          code_digits: [
            { index: 0, value: 0, confidence: 0.95 },
            { index: 1, value: 0, confidence: 0.95 },
            { index: 2, value: 1, confidence: 0.95 },
          ],
          qty_digits: [{ index: 0, value: 2, confidence: 0.88 }],
          flags: [],
        },
        {
          line_index: 1,
          code: null,
          qty: null,
          code_digits: [
            { index: 0, value: null, confidence: 0.32 },
            { index: 1, value: 0, confidence: 0.91 },
            { index: 2, value: 3, confidence: 0.91 },
          ],
          qty_digits: [{ index: 0, value: 1, confidence: 0.9 }],
          flags: ['LOW_CONF_CODE'],
        },
      ],
    },
    ...overrides,
  } as unknown as Sheet;
}

function makeUser(): User {
  return { id: 'user-1', legacyId: '100001', name: 'Test User', zone: 'A1', cell: 'B2' } as User;
}

function makeStaleUser(): User {
  return { id: 'stale-user', legacyId: '999999', name: 'Stale Match', zone: 'Z9', cell: 'X9' } as User;
}

function makeMenuItems(): MenuItem[] {
  return [
    { id: 'id-001', code: '001', position: 0, name: 'Mì tôm', price: 15000, category: MenuItemCategory.FOOD, isActive: true } as MenuItem,
    { id: 'id-002', code: '002', position: 1, name: 'Nước suối', price: 8000, category: MenuItemCategory.ESSENTIAL, isActive: false } as MenuItem,
    { id: 'id-003', code: '003', position: 2, name: 'Sữa', price: 12000, category: MenuItemCategory.FOOD, isActive: true } as MenuItem,
  ];
}

function makeExistingOrder(): { items: { menuItemId: string; name: string; quantity: number; unitPrice: number; category: MenuItemCategory }[]; total: number } {
  return {
    items: [
      { menuItemId: 'id-001', name: 'Mì tôm', quantity: 1, unitPrice: 15000, category: MenuItemCategory.FOOD },
    ],
    total: 15000,
  };
}

describe('assembleQueueItem', () => {
  const userMap = new Map<string, User>([['user-1', makeUser()]]);
  const balanceMap = new Map<string, number>([['user-1', 45000]]);
  const menuItems = makeMenuItems();

  it('emits per-line resolved items with correct resolution', () => {
    const sheet = makeSheet();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, null);

    expect(item.orderLines).toHaveLength(2);
    const line0 = item.orderLines[0];
    expect(line0.lineIndex).toBe(0);
    expect(line0.code).toBe('001');
    expect(line0.qty).toBe(2);
    expect(line0.resolved).not.toBeNull();
    expect(line0.resolved?.menuItemId).toBe('id-001');
    expect(line0.resolved?.inactive).toBe(false);
  });

  it('line with null code resolves to null', () => {
    const sheet = makeSheet();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, null);

    const line1 = item.orderLines[1];
    expect(line1.resolved).toBeNull();
    expect(line1.flags).toContain('LOW_CONF_CODE');
  });

  it('computes per-line confidence as min of all digit confidences', () => {
    const sheet = makeSheet();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, null);

    // line 0: min(0.95, 0.95, 0.95, 0.88) = 0.88
    expect(item.orderLines[0].confidence).toBeCloseTo(0.88);
    // line 1: min(0.32, 0.91, 0.91, 0.9) = 0.32
    expect(item.orderLines[1].confidence).toBeCloseTo(0.32);
  });

  it('does NOT include checkboxes key', () => {
    const sheet = makeSheet();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, null);
    expect('checkboxes' in item).toBe(false);
  });

  it('includes existingOrder summary when one exists', () => {
    const sheet = makeSheet();
    const existing = makeExistingOrder();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, existing);

    expect(item.existingOrder).not.toBeNull();
    expect(item.existingOrder?.total).toBe(15000);
    expect(item.existingOrder?.items).toHaveLength(1);
  });

  it('existingOrder is null when no prior order', () => {
    const sheet = makeSheet();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, null);
    expect(item.existingOrder).toBeNull();
  });

  it('balance from balanceMap is included', () => {
    const sheet = makeSheet();
    const item = assembleQueueItem(sheet, userMap, balanceMap, menuItems, null, {
      userId: 'user-1',
      serial: 'FORM0001',
      revision: 'v3',
      serviceDate: '2026-07-15',
    });
    expect(item.balance).toBe(45000);
  });

  it('derives locked identity and balance from the issued-form owner, never the sheet cache', () => {
    const sheet = makeSheet({ matchedUserId: 'stale-user' });
    const users = new Map<string, User>([
      ['user-1', makeUser()],
      ['stale-user', makeStaleUser()],
    ]);
    const balances = new Map<string, number>([
      ['user-1', 45000],
      ['stale-user', 1],
    ]);
    const formContext = {
      userId: 'user-1',
      serial: 'FORM0001',
      revision: 'v3',
      serviceDate: '2026-07-15',
    };

    const item = assembleQueueItem(sheet, users, balances, menuItems, null, formContext);

    expect(item.identity).toMatchObject({ id: 'user-1', legacyId: '100001', name: 'Test User' });
    expect(item.balance).toBe(45000);
  });

  it('returns a non-confirmable identity when no authoritative form owner is available', () => {
    const sheet = makeSheet({ matchedUserId: 'stale-user' });

    const item = assembleQueueItem(
      sheet,
      new Map([['stale-user', makeStaleUser()]]),
      new Map([['stale-user', 1]]),
      menuItems,
      null,
      { serial: '—', revision: 'v3', serviceDate: sheet.serviceDate },
    );

    expect(item.identity).toBeNull();
    expect(item.balance).toBeNull();
  });
});

describe('assembleMenuItems', () => {
  it('returns ALL items (active + inactive) with their code', () => {
    const items = makeMenuItems();
    const result = assembleMenuItems(items);

    // Must include both active and inactive so operator can resolve inactive codes
    expect(result).toHaveLength(3);
    const codes = result.map((r) => r.code);
    expect(codes).toContain('001');
    expect(codes).toContain('002'); // inactive
    expect(codes).toContain('003');
  });

  it('includes inactive flag on each item', () => {
    const items = makeMenuItems();
    const result = assembleMenuItems(items);
    const item002 = result.find((r) => r.code === '002');
    expect(item002?.isActive).toBe(false);
  });
});
