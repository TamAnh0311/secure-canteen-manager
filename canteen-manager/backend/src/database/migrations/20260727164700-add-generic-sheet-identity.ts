import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGenericSheetIdentity20260727164700 implements MigrationInterface {
  name = 'AddGenericSheetIdentity20260727164700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."scan_admission_source_enum" AS ENUM ('browser', 'agent')`);
    await queryRunner.query(`CREATE TYPE "public"."omr_operational_form_mode_enum" AS ENUM ('issued', 'generic')`);
    await queryRunner.query(`CREATE TYPE "public"."identity_selection_source_enum" AS ENUM ('ranked_candidate_selected', 'manual_search_selected')`);

    await queryRunner.query(`ALTER TABLE "users" ADD "normalized_cell" CHARACTER VARYING(255) NULL`);
    await queryRunner.query(`ALTER TABLE "users" ADD "cell_normalization_version" SMALLINT NULL`);
    await queryRunner.query(`
      CREATE INDEX "IDX_users_active_normalized_cell"
      ON "users" ("normalized_cell", "cell_normalization_version", "id")
      WHERE "is_active" = true
    `);

    await queryRunner.query(`ALTER TABLE "sheets" ADD "template_id" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "admitted_at" TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "admission_source" "public"."scan_admission_source_enum" NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "admitted_mode" "public"."omr_operational_form_mode_enum" NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "admitted_generation" CHARACTER VARYING(64) NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "admitted_by" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_route_zone" CHARACTER VARYING(255) NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_evidence_json" JSONB NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "ranked_candidates_json" JSONB NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "proposed_user_id" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_selected_by" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_selected_at" TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_selection_source" "public"."identity_selection_source_enum" NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_selection_reason" CHARACTER VARYING(500) NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "identity_evidence_purged_at" TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "purge_generation" INTEGER NOT NULL DEFAULT 0`);

    await queryRunner.query(`UPDATE "sheets" SET "admitted_at" = "created_at" WHERE "admitted_at" IS NULL`);
    await queryRunner.query(`UPDATE "sheets" SET "admission_source" = 'agent' WHERE "admission_source" IS NULL`);
    await queryRunner.query(`UPDATE "sheets" SET "admitted_mode" = 'issued' WHERE "admitted_mode" IS NULL`);
    await queryRunner.query(`UPDATE "sheets" SET "admitted_generation" = 'issued-v1' WHERE "admitted_generation" IS NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "admitted_at" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "admission_source" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "admitted_mode" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "admitted_generation" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "FK_sheets_generic_template" FOREIGN KEY ("template_id") REFERENCES "omr_form_templates" ("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "FK_sheets_proposed_user" FOREIGN KEY ("proposed_user_id") REFERENCES "users" ("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "FK_sheets_identity_selected_by" FOREIGN KEY ("identity_selected_by") REFERENCES "operators" ("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "FK_sheets_admitted_by" FOREIGN KEY ("admitted_by") REFERENCES "operators" ("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "CHK_sheets_single_form_binding" CHECK (NOT ("issued_form_id" IS NOT NULL AND "template_id" IS NOT NULL))`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "CHK_sheets_generic_proposal_disabled" CHECK ("admitted_mode" <> 'generic' OR "proposed_user_id" IS NULL)`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "CHK_sheets_identity_selection_audit" CHECK (
      ("identity_selected_at" IS NULL AND "identity_selected_by" IS NULL AND "identity_selection_source" IS NULL AND "identity_selection_reason" IS NULL)
      OR
      ("identity_selected_at" IS NOT NULL AND "identity_selected_by" IS NOT NULL AND "identity_selection_source" IS NOT NULL)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_sheets_generic_template" ON "sheets" ("template_id") WHERE "template_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_sheets_identity_route" ON "sheets" ("matched_user_id", "template_id", "status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const genericRows: Array<{ count: string }> = await queryRunner.query(`
      SELECT count(*)::text AS count FROM "sheets"
      WHERE "template_id" IS NOT NULL
         OR "identity_evidence_json" IS NOT NULL
         OR "ranked_candidates_json" IS NOT NULL
         OR "identity_selected_at" IS NOT NULL
    `);
    if (Number(genericRows[0]?.count ?? 0) > 0) {
      throw new Error('Refusing to remove generic OMR identity history');
    }

    await queryRunner.query(`DROP INDEX "IDX_sheets_identity_route"`);
    await queryRunner.query(`DROP INDEX "IDX_sheets_generic_template"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "CHK_sheets_identity_selection_audit"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "CHK_sheets_generic_proposal_disabled"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "CHK_sheets_single_form_binding"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "FK_sheets_identity_selected_by"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "FK_sheets_admitted_by"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "FK_sheets_proposed_user"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "FK_sheets_generic_template"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "purge_generation"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_evidence_purged_at"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_selection_reason"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_selection_source"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_selected_at"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_selected_by"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "proposed_user_id"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "ranked_candidates_json"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_evidence_json"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "admitted_generation"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "identity_route_zone"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "admitted_by"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "admitted_mode"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "admission_source"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "admitted_at"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "template_id"`);

    await queryRunner.query(`DROP INDEX "IDX_users_active_normalized_cell"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "cell_normalization_version"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "normalized_cell"`);
    await queryRunner.query(`DROP TYPE "public"."identity_selection_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."omr_operational_form_mode_enum"`);
    await queryRunner.query(`DROP TYPE "public"."scan_admission_source_enum"`);
  }
}
