import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the order_items table: junction between orders and menu_items.
// ON DELETE RESTRICT on menu_item_id prevents accidental removal of a dish
// that is already referenced by submitted orders.
export class CreateOrderItems20260616040004 implements MigrationInterface {
  name = 'CreateOrderItems20260616040004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
        "order_id"      UUID        NOT NULL,
        "menu_item_id"  UUID        NOT NULL,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_order_id"
          FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_menu_item_id"
          FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_order_items_order_menu_item"
        ON "order_items" ("order_id", "menu_item_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_order_items_order_menu_item"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
  }
}
