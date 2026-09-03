import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVersionedOmrFormTemplates20260717090000 implements MigrationInterface {
  name = 'CreateVersionedOmrFormTemplates20260717090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."omr_form_mode_enum" AS ENUM ('code', 'full_list')`);
    await queryRunner.query(`CREATE TYPE "public"."omr_form_orientation_enum" AS ENUM ('portrait', 'landscape')`);
    await queryRunner.query(`
      CREATE TABLE "omr_form_templates" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "revision" CHARACTER VARYING(64) NOT NULL,
        "mode" "public"."omr_form_mode_enum" NOT NULL,
        "paper_size" CHARACTER VARYING(8) NOT NULL,
        "orientation" "public"."omr_form_orientation_enum" NOT NULL,
        "geometry" JSONB NOT NULL,
        "geometry_hash" CHARACTER(64) NOT NULL,
        "catalog_hash" CHARACTER(64) NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT false,
        "activated_at" TIMESTAMPTZ NULL,
        "retired_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_omr_form_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_omr_form_templates_revision" UNIQUE ("revision"),
        CONSTRAINT "UQ_omr_form_templates_geometry_hash" UNIQUE ("geometry_hash"),
        CONSTRAINT "CHK_omr_form_templates_layout" CHECK (
          ("paper_size" = 'A5' AND "mode" = 'code' AND "orientation" = 'portrait') OR
          ("paper_size" = 'A5' AND "mode" = 'full_list' AND "orientation" = 'landscape') OR
          ("paper_size" = 'A4' AND "mode" = 'code' AND "orientation" = 'portrait' AND "is_active" = false)
        ),
        CONSTRAINT "CHK_omr_form_templates_catalog_hash" CHECK (
          ("mode" = 'code' AND "catalog_hash" IS NULL) OR
          ("mode" = 'full_list' AND "catalog_hash" IS NOT NULL)
        ),
        CONSTRAINT "CHK_omr_form_templates_activation" CHECK (
          ("is_active" = false) OR ("activated_at" IS NOT NULL AND "retired_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_omr_form_templates_active_mode"
      ON "omr_form_templates" ("mode") WHERE "is_active" = true
    `);
    await queryRunner.query(`
      CREATE TABLE "omr_form_template_rows" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "template_id" UUID NOT NULL,
        "row_index" SMALLINT NOT NULL,
        "menu_item_id" UUID NOT NULL,
        "code_snapshot" CHARACTER(3) NOT NULL,
        "short_label_snapshot" CHARACTER VARYING(100) NOT NULL,
        "position" INTEGER NOT NULL,
        CONSTRAINT "PK_omr_form_template_rows" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_omr_form_template_rows_index" UNIQUE ("template_id", "row_index"),
        CONSTRAINT "UQ_omr_form_template_rows_menu" UNIQUE ("template_id", "menu_item_id"),
        CONSTRAINT "CHK_omr_form_template_rows_index" CHECK ("row_index" >= 0 AND "row_index" < 52),
        CONSTRAINT "CHK_omr_form_template_rows_position" CHECK ("position" >= 0),
        CONSTRAINT "CHK_omr_form_template_rows_code" CHECK ("code_snapshot" ~ '^[0-9]{3}$'),
        CONSTRAINT "CHK_omr_form_template_rows_label" CHECK (length(btrim("short_label_snapshot")) > 0),
        CONSTRAINT "FK_omr_form_template_rows_template" FOREIGN KEY ("template_id") REFERENCES "omr_form_templates" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_omr_form_template_rows_menu" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ADD "template_id" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ADD "form_mode" "public"."omr_form_mode_enum" NULL`);
    await queryRunner.query(`
      DO $$
      DECLARE
        legacy_template_id UUID;
        legacy_roi JSONB;
        legacy_generated_at TIMESTAMPTZ;
        issued_count BIGINT;
      BEGIN
        SELECT count(*) INTO issued_count FROM "issued_omr_forms";
        SELECT "roi_template", "roi_generated_at"
          INTO legacy_roi, legacy_generated_at
          FROM "threshold_config"
          WHERE "roi_template" IS NOT NULL
          LIMIT 1;

        IF legacy_roi IS NOT NULL THEN
          INSERT INTO "omr_form_templates" (
            "revision", "mode", "paper_size", "orientation", "geometry",
            "geometry_hash", "catalog_hash", "is_active", "activated_at", "retired_at"
          ) VALUES (
            'a4-code-v3', 'code', 'A4', 'portrait', legacy_roi,
            md5(legacy_roi::text) || md5(legacy_roi::text), NULL, false,
            COALESCE(legacy_generated_at, now()), now()
          ) RETURNING "id" INTO legacy_template_id;

          UPDATE "issued_omr_forms"
             SET "template_id" = legacy_template_id, "form_mode" = 'code';
        ELSIF issued_count > 0 THEN
          RAISE EXCEPTION 'Cannot backfill issued OMR forms: singleton ROI is missing';
        END IF;
      END $$
    `);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ALTER COLUMN "template_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" ALTER COLUMN "form_mode" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "issued_omr_forms"
      ADD CONSTRAINT "FK_issued_omr_forms_template"
      FOREIGN KEY ("template_id") REFERENCES "omr_form_templates" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`CREATE INDEX "IDX_issued_omr_forms_template" ON "issued_omr_forms" ("template_id")`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_omr_template_row_parent() RETURNS trigger AS $$
      DECLARE parent_mode "public"."omr_form_mode_enum";
      BEGIN
        SELECT "mode" INTO parent_mode FROM "omr_form_templates" WHERE "id" = NEW."template_id";
        IF parent_mode IS DISTINCT FROM 'full_list' THEN
          RAISE EXCEPTION 'Catalog rows belong only to full-list OMR templates';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_omr_form_template_rows_parent"
      BEFORE INSERT OR UPDATE ON "omr_form_template_rows"
      FOR EACH ROW EXECUTE FUNCTION validate_omr_template_row_parent()
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_activated_omr_template_mutation() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD."activated_at" IS NOT NULL THEN
            RAISE EXCEPTION 'Activated OMR templates are immutable';
          END IF;
          RETURN OLD;
        END IF;
        IF OLD."activated_at" IS NOT NULL AND NOT (
          OLD."is_active" = true AND NEW."is_active" = false AND
          OLD."retired_at" IS NULL AND NEW."retired_at" IS NOT NULL AND
          NEW."id" = OLD."id" AND NEW."revision" = OLD."revision" AND
          NEW."mode" = OLD."mode" AND NEW."paper_size" = OLD."paper_size" AND
          NEW."orientation" = OLD."orientation" AND NEW."geometry" = OLD."geometry" AND
          NEW."geometry_hash" = OLD."geometry_hash" AND
          NEW."catalog_hash" IS NOT DISTINCT FROM OLD."catalog_hash" AND
          NEW."activated_at" = OLD."activated_at" AND NEW."created_at" = OLD."created_at"
        ) THEN
          RAISE EXCEPTION 'Activated OMR templates are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_omr_form_templates_immutable"
      BEFORE UPDATE OR DELETE ON "omr_form_templates"
      FOR EACH ROW EXECUTE FUNCTION reject_activated_omr_template_mutation()
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_activated_omr_template_row_mutation() RETURNS trigger AS $$
      DECLARE parent_activated TIMESTAMPTZ;
      BEGIN
        SELECT "activated_at" INTO parent_activated FROM "omr_form_templates"
          WHERE "id" = COALESCE(OLD."template_id", NEW."template_id");
        IF parent_activated IS NOT NULL THEN
          RAISE EXCEPTION 'Activated OMR template rows are immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_omr_form_template_rows_immutable"
      BEFORE UPDATE OR DELETE ON "omr_form_template_rows"
      FOR EACH ROW EXECUTE FUNCTION reject_activated_omr_template_row_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const unsafe: Array<{ count: string }> = await queryRunner.query(`
      SELECT count(*)::text AS count
      FROM "omr_form_templates" t
      WHERE t."revision" <> 'a4-code-v3'
         OR EXISTS (SELECT 1 FROM "issued_omr_forms" f WHERE f."template_id" = t."id" AND t."revision" <> 'a4-code-v3')
    `);
    if (Number(unsafe[0]?.count ?? 0) > 0) {
      throw new Error('Refusing to remove versioned OMR template audit history');
    }
    await queryRunner.query(`DROP INDEX "IDX_issued_omr_forms_template"`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" DROP CONSTRAINT "FK_issued_omr_forms_template"`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" DROP COLUMN "form_mode"`);
    await queryRunner.query(`ALTER TABLE "issued_omr_forms" DROP COLUMN "template_id"`);
    await queryRunner.query(`DROP TRIGGER "TRG_omr_form_template_rows_immutable" ON "omr_form_template_rows"`);
    await queryRunner.query(`DROP FUNCTION reject_activated_omr_template_row_mutation()`);
    await queryRunner.query(`DROP TRIGGER "TRG_omr_form_template_rows_parent" ON "omr_form_template_rows"`);
    await queryRunner.query(`DROP FUNCTION validate_omr_template_row_parent()`);
    await queryRunner.query(`DROP TRIGGER "TRG_omr_form_templates_immutable" ON "omr_form_templates"`);
    await queryRunner.query(`DROP FUNCTION reject_activated_omr_template_mutation()`);
    await queryRunner.query(`DROP TABLE "omr_form_template_rows"`);
    await queryRunner.query(`DROP INDEX "UQ_omr_form_templates_active_mode"`);
    await queryRunner.query(`DROP TABLE "omr_form_templates"`);
    await queryRunner.query(`DROP TYPE "public"."omr_form_orientation_enum"`);
    await queryRunner.query(`DROP TYPE "public"."omr_form_mode_enum"`);
  }
}
