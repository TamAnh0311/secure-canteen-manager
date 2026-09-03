import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenIssuedOmrFormRoiVersion20260717130000 implements MigrationInterface {
  name = 'WidenIssuedOmrFormRoiVersion20260717130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "issued_omr_forms"
      ALTER COLUMN "roi_version" TYPE CHARACTER VARYING(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE "issued_omr_forms" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "issued_omr_forms"
          WHERE length("roi_version") > 32
        ) THEN
          RAISE EXCEPTION
            'Cannot narrow issued_omr_forms.roi_version to 32 characters while longer values exist';
        END IF;
      END;
      $$
    `);
    await queryRunner.query(`
      ALTER TABLE "issued_omr_forms"
      ALTER COLUMN "roi_version" TYPE CHARACTER VARYING(32)
    `);
  }
}
