import { MigrationInterface, QueryRunner } from 'typeorm';

// True-singleton global config table. Holds the OMR/ICR thresholds plus the single global
// OMR form ROI template. Row is seeded lazily (get-or-create) on first access.
// The `singleton` column carries a UNIQUE index and is always true, so a second insert raises
// 23505. This keeps the roi_template owner from splitting into two rows — a split read could
// return null mid-operation and surface as a spurious FORM_NOT_GENERATED.
export class CreateThresholdConfig20260616040007 implements MigrationInterface {
  name = 'CreateThresholdConfig20260616040007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "threshold_config" (
        "id"               UUID             NOT NULL DEFAULT gen_random_uuid(),
        "singleton"        BOOLEAN          NOT NULL DEFAULT true,
        "icr_threshold"    DOUBLE PRECISION NOT NULL DEFAULT 0.85,
        "omr_empty_max"    DOUBLE PRECISION NOT NULL DEFAULT 0.30,
        "omr_ticked_min"   DOUBLE PRECISION NOT NULL DEFAULT 0.70,
        "digit_box_count"  INTEGER          NOT NULL DEFAULT 6,
        "roi_template"     JSONB            NULL,
        "roi_version"      CHARACTER VARYING(50) NULL,
        "roi_generated_at" TIMESTAMPTZ      NULL,
        "updated_at"       TIMESTAMPTZ      NOT NULL DEFAULT now(),
        CONSTRAINT "PK_threshold_config_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_threshold_config_singleton"
        ON "threshold_config" ("singleton")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_threshold_config_singleton"`);
    await queryRunner.query(`DROP TABLE "threshold_config"`);
  }
}
