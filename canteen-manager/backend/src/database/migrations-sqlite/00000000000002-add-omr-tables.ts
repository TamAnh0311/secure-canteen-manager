import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds OMR form generation and scan processing tables to existing SQLite databases.
 * These tables were added to the initial schema but existing databases need this migration.
 */
export class AddOmrTables00000000000002 implements MigrationInterface {
  name = 'AddOmrTables00000000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Only create tables if they don't already exist (idempotent for fresh DBs).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "threshold_config" (
        "id"               VARCHAR(36)  NOT NULL,
        "singleton"        INTEGER      NOT NULL DEFAULT 1 UNIQUE,
        "icr_threshold"    REAL         NOT NULL DEFAULT 0.85,
        "omr_empty_max"    REAL         NOT NULL DEFAULT 0.30,
        "omr_ticked_min"   REAL         NOT NULL DEFAULT 0.70,
        "digit_box_count"  INTEGER      NOT NULL DEFAULT 6,
        "roi_template"     TEXT,
        "roi_version"      VARCHAR(50),
        "roi_generated_at" DATETIME,
        "updated_at"       DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_threshold_config_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "omr_form_templates" (
        "id"             VARCHAR(36)  NOT NULL,
        "revision"       VARCHAR(64)  NOT NULL,
        "mode"           VARCHAR(20)  NOT NULL
                         CHECK("mode" IN ('code', 'full_list')),
        "paper_size"     VARCHAR(8)   NOT NULL DEFAULT 'A5',
        "orientation"    VARCHAR(20)  NOT NULL
                         CHECK("orientation" IN ('portrait', 'landscape')),
        "geometry"       TEXT         NOT NULL,
        "geometry_hash"  VARCHAR(64)  NOT NULL,
        "catalog_hash"   VARCHAR(64),
        "is_active"      INTEGER      NOT NULL DEFAULT 0,
        "activated_at"   DATETIME,
        "retired_at"     DATETIME,
        "created_at"     DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_omr_form_templates_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_omr_form_templates_revision" UNIQUE ("revision"),
        CONSTRAINT "UQ_omr_form_templates_geometry_hash" UNIQUE ("geometry_hash")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "omr_form_template_rows" (
        "id"                   VARCHAR(36)  NOT NULL,
        "template_id"          VARCHAR(36)  NOT NULL,
        "row_index"            INTEGER      NOT NULL,
        "menu_item_id"         VARCHAR(36)  NOT NULL,
        "code_snapshot"        VARCHAR(20)  NOT NULL,
        "short_label_snapshot" VARCHAR(100) NOT NULL,
        "position"             INTEGER      NOT NULL,
        "created_at"           DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_omr_form_template_rows_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_omr_template_rows_template" FOREIGN KEY ("template_id")
          REFERENCES "omr_form_templates"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "issued_omr_forms" (
        "id"           VARCHAR(36)  NOT NULL,
        "token"        VARCHAR(36)  NOT NULL,
        "user_id"      VARCHAR(36)  NOT NULL,
        "service_date" VARCHAR(20)  NOT NULL,
        "roi_version"  VARCHAR(64)  NOT NULL,
        "template_id"  VARCHAR(36),
        "form_mode"    VARCHAR(20),
        "issued_by"    VARCHAR(36)  NOT NULL,
        "status"       VARCHAR(20)  NOT NULL DEFAULT 'issued'
                       CHECK("status" IN ('issued', 'void')),
        "consumed_sheet_id" VARCHAR(36),
        "reserved_sheet_id" VARCHAR(36),
        "voided_at"    DATETIME,
        "void_reason"  VARCHAR(100),
        "issued_at"    DATETIME     NOT NULL DEFAULT (datetime('now')),
        "consumed_at"  DATETIME,
        "created_at"   DATETIME     NOT NULL DEFAULT (datetime('now')),
        "updated_at"   DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_issued_omr_forms_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_issued_omr_forms_token" UNIQUE ("token")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "issued_omr_forms"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "omr_form_template_rows"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "omr_form_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "threshold_config"`);
  }
}
