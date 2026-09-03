import { MigrationInterface, QueryRunner } from 'typeorm';

// Scanner and legacy OMR orders share one active balance-backed channel per
// prisoner/service date while preserving their source provenance in history.
export class AddScannerOrderChannel20260806113000 implements MigrationInterface {
  name = 'AddScannerOrderChannel20260806113000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "CHK_orders_source"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "CHK_orders_source"
        CHECK ("source" IN ('omr', 'scanner', 'relative', 'manual'))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_orders_active_date_user_scanned_channel"
        ON "orders" ("service_date", "user_id")
        WHERE "status" = 'active' AND "source" IN ('omr', 'scanner')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "orders" WHERE "source" = 'scanner'`,
    );
    if (Number(count) > 0) {
      throw new Error('Cannot remove scanner order source while scanner orders exist');
    }
    await queryRunner.query(`DROP INDEX "UQ_orders_active_date_user_scanned_channel"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "CHK_orders_source"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "CHK_orders_source"
        CHECK ("source" IN ('omr', 'relative', 'manual'))
    `);
  }
}
