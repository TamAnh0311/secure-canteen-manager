import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the sync_runs audit table: one row per legacy-sync execution.
// Status transitions: running → success | failed. Never deleted; provides
// a full audit trail of sync history for operators to inspect.
export class CreateSyncRuns20260616030002 implements MigrationInterface {
  name = 'CreateSyncRuns20260616030002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."sync_runs_status_enum" AS ENUM ('running', 'success', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "sync_runs" (
        "id"          UUID                                  NOT NULL DEFAULT gen_random_uuid(),
        "started_at"  TIMESTAMPTZ                           NOT NULL,
        "finished_at" TIMESTAMPTZ                           NULL,
        "row_count"   INTEGER                               NOT NULL DEFAULT 0,
        "status"      "public"."sync_runs_status_enum"      NOT NULL DEFAULT 'running',
        "trigger"     CHARACTER VARYING(50)                 NOT NULL,
        "error"       TEXT                                  NULL,
        "created_at"  TIMESTAMPTZ                           NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_runs_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sync_runs"`);
    await queryRunner.query(`DROP TYPE "public"."sync_runs_status_enum"`);
  }
}
