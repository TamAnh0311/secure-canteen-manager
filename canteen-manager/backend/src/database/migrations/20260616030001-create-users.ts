import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the users table: local mirror of employees synced from the legacy SQL Server source.
// Upserted by natural key (legacy_id) on each sync run; never written by application operators.
export class CreateUsers20260616030001 implements MigrationInterface {
  name = 'CreateUsers20260616030001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"          UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "legacy_id"   CHARACTER VARYING(255)  NOT NULL,
        "name"        CHARACTER VARYING(500)  NOT NULL,
        "department"  CHARACTER VARYING(255)  NULL,
        "zone"        CHARACTER VARYING(255)  NULL,
        "is_active"   BOOLEAN                 NOT NULL DEFAULT true,
        "source"      CHARACTER VARYING(100)  NOT NULL DEFAULT 'sql2005',
        "synced_at"   TIMESTAMPTZ             NOT NULL,
        "created_at"  TIMESTAMPTZ             NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ             NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_legacy_id" ON "users" ("legacy_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_users_legacy_id"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
