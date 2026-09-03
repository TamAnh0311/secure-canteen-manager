import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds quantity (per-line portion count) to order_items. Order capture moves from binary
// selection (one row = one portion) to per-item quantity: total_amount = Σ unit_price × quantity,
// and delivery/kitchen tallies sum this column instead of counting rows. Historical rows backfill
// to 1 so pre-refactor output is byte-identical. NOTE: down() is destructive once any qty>1 row
// exists (it drops real quantity data) — it is not a safe standalone rollback; pair it with a
// matching code rollback.
export class AddOrderItemQuantity20260620170300 implements MigrationInterface {
  name = 'AddOrderItemQuantity20260620170300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "quantity"`);
  }
}
