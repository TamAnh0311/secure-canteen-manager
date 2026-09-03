import { MigrationInterface, QueryRunner } from 'typeorm';

// Constrains orders.source to the known origins. Today the column is an
// unconstrained varchar defaulting to 'omr' — a missing/garbage source on a
// relative order would otherwise silently fall into the balance-debiting branch.
export class ConstrainOrderSource20260617100004 implements MigrationInterface {
  name = 'ConstrainOrderSource20260617100004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "CHK_orders_source"
        CHECK ("source" IN ('omr', 'relative', 'manual'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "CHK_orders_source"`);
  }
}
