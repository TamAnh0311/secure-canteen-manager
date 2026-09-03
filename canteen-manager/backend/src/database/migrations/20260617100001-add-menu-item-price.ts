import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds a selling price (integer VND) to menu items. Defaults 0 so existing rows
// remain valid; admins set real prices via the menu editor.
export class AddMenuItemPrice20260617100001 implements MigrationInterface {
  name = 'AddMenuItemPrice20260617100001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "menu_items"
        ADD COLUMN "price" BIGINT NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "menu_items" DROP COLUMN "price"`);
  }
}
