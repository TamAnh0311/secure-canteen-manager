import { MigrationInterface, QueryRunner } from 'typeorm';

// Widens the operator role enum with 'cashier' — counter staff who record balance
// top-ups and take cash/bank payment for relative orders. Existing roles unchanged.
// Postgres 12+ permits ADD VALUE inside the migration transaction as long as the new
// label is not used in the same transaction (it is not — only operator rows reference it).
export class AddCashierOperatorRole20260617210001 implements MigrationInterface {
  name = 'AddCashierOperatorRole20260617210001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."operators_role_enum" ADD VALUE IF NOT EXISTS 'cashier'`,
    );
  }

  // Postgres cannot DROP a value from an enum, and operator rows may already hold the
  // role — removing it would orphan them. Reverting is therefore a deliberate no-op; the
  // extra label is inert when unused.
  public async down(): Promise<void> {
    // intentionally empty — enum value removal is unsafe and unnecessary
  }
}
