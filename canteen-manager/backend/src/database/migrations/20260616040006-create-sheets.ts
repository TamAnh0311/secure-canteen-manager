import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the sheets table with SheetStatus enum and unique checksum index.
// checksum uniqueness is the idempotency mechanism: duplicate scan submissions
// return 409 without reprocessing the image.
// service_date is a plain indexed column (server-stamped at ingestion in the deploy
// timezone) used to bucket scans by day on the verify/monitor screens.
// order_id is a plain nullable column (no FK) to avoid a circular dependency between
// sheets and orders tables at the schema level.
export class CreateSheets20260616040006 implements MigrationInterface {
  name = 'CreateSheets20260616040006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."sheets_status_enum" AS ENUM (
        'pending',
        'processing',
        'auto_accepted',
        'flagged',
        'rejected',
        'verified'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sheets" (
        "id"              UUID                              NOT NULL DEFAULT gen_random_uuid(),
        "sheet_id"        CHARACTER VARYING(100)            NOT NULL,
        "batch"           CHARACTER VARYING(100)            NULL,
        "service_date"    DATE                              NOT NULL,
        "checksum"        CHARACTER VARYING(255)            NOT NULL,
        "image_path"      CHARACTER VARYING(500)            NOT NULL,
        "status"          "public"."sheets_status_enum"     NOT NULL DEFAULT 'pending',
        "result_json"     JSONB                             NULL,
        "avg_confidence"  DOUBLE PRECISION                  NULL,
        "recognized_id"   CHARACTER VARYING(255)            NULL,
        "matched_user_id" UUID                              NULL,
        "order_id"        UUID                              NULL,
        "flags"           JSONB                             NULL,
        "created_at"      TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "processed_at"    TIMESTAMPTZ                       NULL,
        CONSTRAINT "PK_sheets_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sheets_matched_user_id"
          FOREIGN KEY ("matched_user_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sheets_checksum" ON "sheets" ("checksum")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sheets_service_date" ON "sheets" ("service_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sheets_service_date"`);
    await queryRunner.query(`DROP INDEX "UQ_sheets_checksum"`);
    await queryRunner.query(`DROP TABLE "sheets"`);
    await queryRunner.query(`DROP TYPE "public"."sheets_status_enum"`);
  }
}
