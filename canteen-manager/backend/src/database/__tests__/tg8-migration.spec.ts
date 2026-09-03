import { QueryRunner } from 'typeorm';
import { CreateOrderTg8Documents20260717112000 } from '../migrations/20260717112000-create-order-tg8-documents';

describe('CreateOrderTg8Documents20260717112000.down', () => {
  it('refuses destructive rollback while immutable snapshots exist', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValueOnce([{ count: 1 }]),
    } as unknown as QueryRunner;
    const migration = new CreateOrderTg8Documents20260717112000();

    await expect(migration.down(queryRunner)).rejects.toThrow(
      'Cannot revert TG8 document migration while immutable snapshots exist',
    );
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
  });

  it('allows rollback only when the audit table is empty', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const migration = new CreateOrderTg8Documents20260717112000();

    await expect(migration.down(queryRunner)).resolves.toBeUndefined();
    expect(queryRunner.query).toHaveBeenCalledTimes(5);
  });
});
