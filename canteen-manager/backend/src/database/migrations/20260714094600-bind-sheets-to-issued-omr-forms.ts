import { MigrationInterface, QueryRunner } from 'typeorm';

export class BindSheetsToIssuedOmrForms20260714094600 implements MigrationInterface {
  name = 'BindSheetsToIssuedOmrForms20260714094600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ADD "reserved_sheet_id" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ADD "void_reason" CHARACTER VARYING(100) NULL`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ADD CONSTRAINT "FK_issued_omr_forms_reserved_sheet" FOREIGN KEY ("reserved_sheet_id") REFERENCES "sheets" ("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_issued_omr_forms_reserved_sheet" ON "issued_omr_forms" ("reserved_sheet_id") WHERE "reserved_sheet_id" IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE "sheets" ADD "issued_form_id" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "rejection_code" CHARACTER VARYING(100) NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "processing_attempts" INTEGER NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "next_retry_at" TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "last_error_code" CHARACTER VARYING(100) NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "FK_sheets_issued_form" FOREIGN KEY ("issued_form_id") REFERENCES "issued_omr_forms" ("token") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_sheets_issued_form" ON "sheets" ("issued_form_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_sheets_retry_due" ON "sheets" ("next_retry_at") WHERE "status" = 'pending'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sheets_retry_due"`);
    await queryRunner.query(`DROP INDEX "IDX_sheets_issued_form"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "FK_sheets_issued_form"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "last_error_code"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "next_retry_at"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "processing_attempts"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "rejection_code"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "issued_form_id"`);
    await queryRunner.query(`DROP INDEX "UQ_issued_omr_forms_reserved_sheet"`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" DROP CONSTRAINT "FK_issued_omr_forms_reserved_sheet"`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" DROP COLUMN "void_reason"`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" DROP COLUMN "reserved_sheet_id"`);
  }
}
