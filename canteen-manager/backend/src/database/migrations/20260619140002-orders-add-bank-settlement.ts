import { MigrationInterface, QueryRunner } from 'typeorm';

// Bank settlement fields for a cashier-accepted relative order: an optional free-text transfer
// reference (bank txn id / last-4) and the received amount. Both are nullable — cash accepts and
// the existing flow leave them NULL. The partial UNIQUE index on transfer_reference enforces the
// double-spend guard only for non-empty references (blank refs are stored NULL by the service),
// so the guard is advisory: it blocks reusing the same reference, never blank settlements.
export class OrdersAddBankSettlement20260619140002 implements MigrationInterface {
  name = 'OrdersAddBankSettlement20260619140002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "transfer_reference" CHARACTER VARYING(120) NULL,
        ADD COLUMN "received_amount"    BIGINT                 NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_orders_transfer_reference"
        ON "orders" ("transfer_reference")
        WHERE "transfer_reference" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_orders_transfer_reference"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN "received_amount",
        DROP COLUMN "transfer_reference"
    `);
  }
}
