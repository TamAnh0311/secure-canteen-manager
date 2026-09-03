import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds money + payment columns to orders: total_amount (integer VND snapshot),
// payment_status (paid|unpaid), payment_method (cash|bank|balance, nullable).
// Behaviour-neutral on existing rows: total defaults 0, payment defaults unpaid/null.
export class AddOrderMoneyColumns20260617100002 implements MigrationInterface {
  name = 'AddOrderMoneyColumns20260617100002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."orders_payment_status_enum" AS ENUM ('paid', 'unpaid')
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "total_amount"   BIGINT                                  NOT NULL DEFAULT 0,
        ADD COLUMN "payment_status" "public"."orders_payment_status_enum"   NOT NULL DEFAULT 'unpaid',
        ADD COLUMN "payment_method" CHARACTER VARYING(20)                   NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN "payment_method",
        DROP COLUMN "payment_status",
        DROP COLUMN "total_amount"
    `);
    await queryRunner.query(`DROP TYPE "public"."orders_payment_status_enum"`);
  }
}
