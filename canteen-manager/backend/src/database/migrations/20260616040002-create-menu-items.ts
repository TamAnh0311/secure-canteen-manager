import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the menu_items table: the global, persistent list of commissary dishes.
// `code` is an auto-generated label-only identifier, globally unique (monotonic, gaps OK).
// `position` is zero-based, maps 1-to-1 to OMR sheet checkbox rows, and is globally unique
// so a printed checkbox index can never be remapped to a different item — a remap would
// debit the wrong dish.
export class CreateMenuItems20260616040002 implements MigrationInterface {
  name = 'CreateMenuItems20260616040002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "menu_items" (
        "id"          UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "code"        CHARACTER VARYING(20)   NOT NULL,
        "position"    INTEGER                 NOT NULL,
        "name"        CHARACTER VARYING(255)  NOT NULL,
        "is_active"   BOOLEAN                 NOT NULL DEFAULT true,
        "created_at"  TIMESTAMPTZ             NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ             NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_items_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_menu_items_code" ON "menu_items" ("code")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_menu_items_position" ON "menu_items" ("position")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_menu_items_position"`);
    await queryRunner.query(`DROP INDEX "UQ_menu_items_code"`);
    await queryRunner.query(`DROP TABLE "menu_items"`);
  }
}
