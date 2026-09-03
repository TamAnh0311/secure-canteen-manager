import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds settle/reject audit columns to orders: the operator who accepted/rejected a pending
// relative order, when it happened, and (for a rejection) the reason. Behaviour-neutral on
// existing rows (all default NULL). Runs after the enum-widening migration; isolated in its
// own file so the enum ADD VALUE can never partial-apply alongside this column DDL under
// TypeORM's single-batch transaction.
export class OrdersSettleRejectColumns20260618100002 implements MigrationInterface {
  name = 'OrdersSettleRejectColumns20260618100002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "settled_by_operator_id" UUID                   NULL,
        ADD COLUMN "settled_at"             TIMESTAMPTZ            NULL,
        ADD COLUMN "reject_reason"          CHARACTER VARYING(200) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "FK_orders_settled_by_operator_id"
          FOREIGN KEY ("settled_by_operator_id") REFERENCES "operators" ("id") ON DELETE RESTRICT
    `);
  }

  // Reverting drops the audit columns; this is LOSSY for any already-accepted/rejected order
  // (settled_by / settled_at / reject_reason are gone). Acceptable only as a deploy rollback.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_settled_by_operator_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN "reject_reason",
        DROP COLUMN "settled_at",
        DROP COLUMN "settled_by_operator_id"
    `);
  }
}
