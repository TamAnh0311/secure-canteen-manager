import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the orders table with a supersede-in-place audit trail, bucketed by service_date.
// Exactly one active order per (service_date, user_id, source) is enforced by a partial
// unique index: a warden (omr) order and a relative (visitor) order can be active at once for
// the same prisoner+date, while a re-scan supersedes only the prior order of the same origin.
// When a re-scan arrives, the prior order transitions to 'superseded' and the new order
// becomes active — full history is retained so kitchen counts only use active orders.
export class CreateOrders20260616040003 implements MigrationInterface {
  name = 'CreateOrders20260616040003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."orders_status_enum" AS ENUM ('active', 'superseded')
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id"                      UUID                            NOT NULL DEFAULT gen_random_uuid(),
        "service_date"            DATE                            NOT NULL,
        "user_id"                 UUID                            NOT NULL,
        "source"                  CHARACTER VARYING(50)           NOT NULL DEFAULT 'omr',
        "sheet_id"                UUID                            NULL,
        "status"                  "public"."orders_status_enum"   NOT NULL DEFAULT 'active',
        "superseded_at"           TIMESTAMPTZ                     NULL,
        "superseded_by_order_id"  UUID                            NULL,
        "created_at"              TIMESTAMPTZ                     NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMPTZ                     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    // Partial unique index: one active order per (service_date, user, source). Superseded /
    // rejected rows are excluded so audit history stays intact. The supersede/dedup query
    // scope must match this column tuple exactly.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_orders_active_date_user_source"
        ON "orders" ("service_date", "user_id", "source")
        WHERE status = 'active'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_orders_active_date_user_source"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
  }
}
