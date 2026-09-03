import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the operators table: stores system users (admins and operators)
// who authenticate locally via bcrypt-hashed passwords in air-gapped deployment.
export class CreateOperators20260616023005 implements MigrationInterface {
  name = 'CreateOperators20260616023005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."operators_role_enum" AS ENUM ('admin', 'operator')
    `);

    await queryRunner.query(`
      CREATE TABLE "operators" (
        "id"            UUID                            NOT NULL DEFAULT gen_random_uuid(),
        "username"      CHARACTER VARYING(100)          NOT NULL,
        "password_hash" CHARACTER VARYING(255)          NOT NULL,
        "display_name"  CHARACTER VARYING(200)          NOT NULL,
        "role"          "public"."operators_role_enum"  NOT NULL DEFAULT 'operator',
        "is_active"     BOOLEAN                         NOT NULL DEFAULT true,
        "created_at"    TIMESTAMP                       NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP                       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operators_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operators_username" UNIQUE ("username")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "operators"`);
    await queryRunner.query(`DROP TYPE "public"."operators_role_enum"`);
  }
}
