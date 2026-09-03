import { ConflictException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { todayInDeployTz } from '../common/today-in-tz';
import { toVietnameseAmountWords } from '../common/vietnamese-amount-words';
import { MenuItem } from '../menu/menu-item.entity';
import { User } from '../users/user.entity';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';
import { Tg8Document } from './tg8-document.entity';

export const TG8_SNAPSHOT_SCHEMA_VERSION = 'tg8-snapshot-v1' as const;
export const TG8_TEMPLATE_REVISION = 'tg8-v1' as const;

export interface Tg8Snapshot {
  schemaVersion: typeof TG8_SNAPSHOT_SCHEMA_VERSION;
  prisoner: {
    name: string;
    legacyId: string;
    dateOfBirth: string | null;
    offense: string | null;
  };
  acceptedTotal: number;
  acceptedTotalWords: string;
  items: Array<{ name: string; quantity: number }>;
  acceptanceDate: string;
}

function sourceMissing(message: string): ConflictException {
  return new ConflictException({ message, code: 'TG8.SNAPSHOT_SOURCE_MISSING' });
}

export async function createSnapshotAtAcceptance(
  em: EntityManager,
  lockedOrder: Order,
  acceptedAt: Date,
  operatorId: string,
): Promise<Tg8Document> {
  const existing = await em.findOne(Tg8Document, { where: { orderId: lockedOrder.id } });
  if (existing) {
    throw new ConflictException({
      message: 'A TG8 snapshot already exists for this pending order',
      code: 'TG8.SNAPSHOT_ALREADY_EXISTS',
    });
  }

  const user = await em.findOne(User, { where: { id: lockedOrder.userId } });
  if (!user) throw sourceMissing('Prisoner identity is unavailable for the TG8 snapshot');

  const orderItems = await em.find(OrderItem, {
    where: { orderId: lockedOrder.id },
    order: { menuItemId: 'ASC' },
  });
  const menuIds = orderItems.map((item) => item.menuItemId);
  const menuItems =
    menuIds.length === 0
      ? []
      : await em.find(MenuItem, { where: { id: In(menuIds) }, order: { id: 'ASC' } });
  const menuNameById = new Map(menuItems.map((item) => [item.id, item.name]));
  const items = orderItems.map((item) => {
    const name = menuNameById.get(item.menuItemId);
    if (!name) throw sourceMissing('Order item name is unavailable for the TG8 snapshot');
    return { name, quantity: item.quantity };
  });

  const snapshot: Tg8Snapshot = {
    schemaVersion: TG8_SNAPSHOT_SCHEMA_VERSION,
    prisoner: {
      name: user.name,
      legacyId: user.legacyId,
      dateOfBirth: user.dateOfBirth,
      offense: user.offense,
    },
    acceptedTotal: lockedOrder.totalAmount,
    acceptedTotalWords: toVietnameseAmountWords(lockedOrder.totalAmount),
    items,
    acceptanceDate: todayInDeployTz(acceptedAt),
  };
  const document = em.create(Tg8Document, {
    orderId: lockedOrder.id,
    templateRevision: TG8_TEMPLATE_REVISION,
    snapshot,
    acceptedAt,
    operatorId,
  });
  return em.save(Tg8Document, document);
}
