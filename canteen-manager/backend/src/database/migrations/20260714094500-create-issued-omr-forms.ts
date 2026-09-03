import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIssuedOmrForms20260714094500 implements MigrationInterface {
  name = 'CreateIssuedOmrForms20260714094500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."issued_omr_forms_status_enum" AS ENUM ('issued', 'consumed', 'void')
    `);
    await queryRunner.query(`
      CREATE TABLE "issued_omr_forms" (
        "token" UUID NOT NULL,
        "user_id" UUID NOT NULL,
        "service_date" DATE NOT NULL,
        "roi_version" CHARACTER VARYING(32) NOT NULL,
        "issued_by" UUID NOT NULL,
        "status" "public"."issued_omr_forms_status_enum" NOT NULL DEFAULT 'issued',
        "consumed_sheet_id" UUID NULL,
        "issued_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "consumed_at" TIMESTAMPTZ NULL,
        "voided_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_issued_omr_forms_token" PRIMARY KEY ("token"),
        CONSTRAINT "FK_issued_omr_forms_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_issued_omr_forms_issuer" FOREIGN KEY ("issued_by") REFERENCES "operators" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_issued_omr_forms_consumed_sheet" FOREIGN KEY ("consumed_sheet_id") REFERENCES "sheets" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_issued_omr_forms_active_user_date"
      ON "issued_omr_forms" ("user_id", "service_date") WHERE "status" = 'issued'
    `);
    await queryRunner.query(`CREATE INDEX "IDX_issued_omr_forms_user_date" ON "issued_omr_forms" ("user_id", "service_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_issued_omr_forms_status" ON "issued_omr_forms" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ count: string }> = await queryRunner.query(`SELECT count(*)::text AS count FROM "issued_omr_forms"`);
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error('Refusing to drop non-empty issued_omr_forms audit history');
    }
    await queryRunner.query(`DROP INDEX "IDX_issued_omr_forms_status"`);
    await queryRunner.query(`DROP INDEX "IDX_issued_omr_forms_user_date"`);
    await queryRunner.query(`DROP INDEX "UQ_issued_omr_forms_active_user_date"`);
    await queryRunner.query(`DROP TABLE "issued_omr_forms"`);
    await queryRunner.query(`DROP TYPE "public"."issued_omr_forms_status_enum"`);
  }
}
