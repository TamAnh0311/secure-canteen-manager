import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the read-only detainee profile to users: date_of_birth, hometown, offense, arrest_date,
// and a detention_status native enum that collapses three custody classifications (pre-charge
// hold, pre-trial detention, post-conviction) into one stored value. All columns are nullable
// with no default — the legacy sync or demo seed populates them, and the legacy box may not map
// them yet, so there is no backfill. Birth/arrest are DATE (no time component) — calendar dates
// that carry no timezone, displayed in the deploy timezone.
export class AddUserDetaineeProfile20260620230500 implements MigrationInterface {
  name = 'AddUserDetaineeProfile20260620230500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."users_detention_status_enum" AS ENUM ('temporary_hold', 'pre_trial_detention', 'convicted')
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "date_of_birth"    DATE                                          NULL,
        ADD COLUMN "hometown"         CHARACTER VARYING(500)                        NULL,
        ADD COLUMN "offense"          CHARACTER VARYING(500)                        NULL,
        ADD COLUMN "arrest_date"      DATE                                          NULL,
        ADD COLUMN "detention_status" "public"."users_detention_status_enum"        NULL
    `);
  }

  // Reverting drops the five profile columns and the enum type. Lossy for any synced/seeded
  // profile data, but these columns are new-only so no pre-existing data is affected.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "detention_status",
        DROP COLUMN "arrest_date",
        DROP COLUMN "offense",
        DROP COLUMN "hometown",
        DROP COLUMN "date_of_birth"
    `);
    await queryRunner.query(`DROP TYPE "public"."users_detention_status_enum"`);
  }
}
