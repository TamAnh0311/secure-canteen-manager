import { EntityManager } from 'typeorm';
import { MenuItem } from '../../menu/menu-item.entity';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { User } from '../../users/user.entity';
import { Order } from '../order.entity';
import { OrderItem } from '../order-item.entity';
import { Tg8Document } from '../tg8-document.entity';
import { createSnapshotAtAcceptance } from '../tg8-snapshot';

const acceptedAt = new Date('2026-07-17T17:30:00.000Z');
const order = {
  id: 'order-1',
  userId: 'user-1',
  totalAmount: 125_000,
} as Order;

function buildManager(existing: Tg8Document | null = null) {
  const user = {
    id: 'user-1',
    name: 'Nguyễn Văn A',
    legacyId: 'P001',
    dateOfBirth: null,
    offense: 'Trộm cắp tài sản',
  } as User;
  const orderItems = [
    {
      orderId: order.id,
      menuItemId: 'item-1',
      quantity: 2,
      category: MenuItemCategory.FOOD,
    },
  ] as OrderItem[];
  const menuItems = [{ id: 'item-1', name: 'Mì gói' }] as MenuItem[];
  const save = jest.fn(async (_entity: unknown, value: Tg8Document) => value);
  const manager = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Tg8Document) return existing;
      if (entity === User) return user;
      return null;
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === OrderItem) return orderItems;
      if (entity === MenuItem) return menuItems;
      return [];
    }),
    create: jest.fn((_entity: unknown, value: Tg8Document) => value),
    save,
  } as unknown as EntityManager;
  return { manager, save };
}

describe('createSnapshotAtAcceptance', () => {
  it('writes only approved immutable fields using the supplied transaction manager', async () => {
    process.env.APP_TZ = 'Asia/Ho_Chi_Minh';
    const { manager, save } = buildManager();

    const result = await createSnapshotAtAcceptance(
      manager,
      order,
      acceptedAt,
      'operator-1',
    );

    expect(result).toMatchObject({
      orderId: 'order-1',
      operatorId: 'operator-1',
      acceptedAt,
      templateRevision: 'tg8-v1',
      snapshot: {
        schemaVersion: 'tg8-snapshot-v1',
        prisoner: {
          name: 'Nguyễn Văn A',
          legacyId: 'P001',
          dateOfBirth: null,
          offense: 'Trộm cắp tài sản',
        },
        acceptedTotal: 125_000,
        acceptedTotalWords: 'một trăm hai mươi lăm nghìn đồng',
        items: [{ name: 'Mì gói', quantity: 2 }],
        acceptanceDate: '2026-07-18',
      },
    });
    expect(save).toHaveBeenCalledWith(Tg8Document, expect.objectContaining({ orderId: 'order-1' }));
    expect(JSON.stringify(result)).not.toContain('hometown');
    expect(JSON.stringify(result)).not.toContain('arrest');
  });

  it('fails closed when an impossible pre-existing snapshot is found', async () => {
    const existing = { orderId: 'order-1', snapshot: { preserved: true } } as unknown as Tg8Document;
    const { manager, save } = buildManager(existing);

    await expect(
      createSnapshotAtAcceptance(manager, order, acceptedAt, 'operator-1'),
    ).rejects.toMatchObject({ response: { code: 'TG8.SNAPSHOT_ALREADY_EXISTS' } });
    expect(save).not.toHaveBeenCalled();
  });
});
