import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddItemCategories20260715154401 implements MigrationInterface {
  name = 'AddItemCategories20260715154401';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "menu_item_category_enum" AS ENUM ('food', 'essential')`);
    await queryRunner.query(`ALTER TABLE "menu_items" ADD "category" "menu_item_category_enum"`);
    await queryRunner.query(`UPDATE "menu_items" SET "category" = 'food' WHERE "category" IS NULL`);
    await queryRunner.query(`ALTER TABLE "menu_items" ALTER COLUMN "category" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "order_items" ADD "category" "menu_item_category_enum"`);
    await queryRunner.query(`
      UPDATE "order_items" oi
         SET "category" = mi."category"
        FROM "menu_items" mi
       WHERE mi."id" = oi."menu_item_id" AND oi."category" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "order_items" ALTER COLUMN "category" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "category"`);
    await queryRunner.query(`ALTER TABLE "menu_items" DROP COLUMN "category"`);
    await queryRunner.query(`DROP TYPE "menu_item_category_enum"`);
  }
}
