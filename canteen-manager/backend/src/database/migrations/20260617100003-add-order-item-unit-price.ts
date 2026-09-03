import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds unit_price (integer VND) to order_items — a per-line price snapshot taken at
// order-create time so later menu price edits never re-price an existing order.
export class AddOrderItemUnitPrice20260617100003 implements MigrationInterface {
  name = 'AddOrderItemUnitPrice20260617100003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD COLUMN "unit_price" BIGINT NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "unit_price"`);
  }
}
