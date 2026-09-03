import { MigrationInterface, QueryRunner } from 'typeorm';

// Widens the orders status enum with 'rejected' — the terminal state a cashier sets when
// declining a pending visitor (relative) order. A rejected order is non-active, so it frees
// the partial unique index slot (one active per service_date+user+source), letting a fresh
// order be placed. Existing statuses unchanged.
// Postgres 12+ permits ADD VALUE inside the migration transaction as long as the new label is
// not referenced in the same transaction (it is not — only later order updates use it). Kept
// in its own file so the enum change can never partial-apply alongside column DDL.
export class OrdersAddRejectedStatus20260618100001 implements MigrationInterface {
  name = 'OrdersAddRejectedStatus20260618100001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" ADD VALUE IF NOT EXISTS 'rejected'`,
    );
  }

  // Postgres cannot DROP a value from an enum, and order rows may already hold the status —
  // removing it would orphan them. Reverting is therefore a deliberate no-op; the extra label
  // is inert when unused.
  public async down(): Promise<void> {
    // intentionally empty — enum value removal is unsafe and unnecessary
  }
}
