import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScannerWebhookEvents20260806085000 implements MigrationInterface {
  name = 'CreateScannerWebhookEvents20260806085000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."scan_admission_source_enum" ADD VALUE IF NOT EXISTS 'scanner'`);
    await queryRunner.query(`ALTER TYPE "public"."omr_operational_form_mode_enum" ADD VALUE IF NOT EXISTS 'scanner'`);
    await queryRunner.query(`
      CREATE TYPE "public"."scanner_webhook_event_state_enum"
      AS ENUM ('received', 'quarantined', 'integrity_fault')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."scanner_artifact_job_state_enum"
      AS ENUM ('pending', 'processing', 'retrying', 'available', 'missing', 'permanent_failed', 'integrity_fault', 'purged')
    `);
    await queryRunner.query(`
      CREATE TABLE "scanner_webhook_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" character varying(100) NOT NULL,
        "idempotency_key" character varying(255) NOT NULL,
        "payload_sha256" character(64) NOT NULL,
        "payload_length" integer NOT NULL,
        "raw_payload" bytea NOT NULL,
        "payload_json" jsonb NOT NULL,
        "schema_version" character varying(32) NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "document_id" character varying(100) NOT NULL,
        "revision" integer NOT NULL,
        "service_date" date NOT NULL,
        "outcome" character varying(32) NOT NULL,
        "state" "public"."scanner_webhook_event_state_enum" NOT NULL DEFAULT 'received',
        "fault_code" character varying(100),
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scanner_webhook_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_scanner_webhook_events_event_id" UNIQUE ("event_id"),
        CONSTRAINT "CHK_scanner_webhook_events_payload_sha256" CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_scanner_webhook_events_revision" CHECK ("revision" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_scanner_webhook_events_service_date"
      ON "scanner_webhook_events" ("service_date")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_scanner_webhook_events_result"
      ON "scanner_webhook_events" ("document_id", "revision")
    `);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "image_path" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD "scanner_event_id" UUID NULL`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "UQ_sheets_scanner_event_id" UNIQUE ("scanner_event_id")`);
    await queryRunner.query(`ALTER TABLE "sheets" ADD CONSTRAINT "FK_sheets_scanner_event" FOREIGN KEY ("scanner_event_id") REFERENCES "scanner_webhook_events" ("id") ON DELETE RESTRICT`);
    await queryRunner.query(`
      CREATE TABLE "scanner_artifact_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" uuid NOT NULL,
        "artifact_id" character varying(100) NOT NULL,
        "kind" character varying(100) NOT NULL,
        "media_type" character varying(100) NOT NULL,
        "source_url" character varying(1000) NOT NULL,
        "expected_sha256" character(64) NOT NULL,
        "source_occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "relative_path" character varying(500),
        "state" "public"."scanner_artifact_job_state_enum" NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lease_expires_at" TIMESTAMP WITH TIME ZONE,
        "lease_token" uuid,
        "failure_code" character varying(100),
        "available_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scanner_artifact_jobs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_scanner_artifact_jobs_event_artifact" UNIQUE ("event_id", "artifact_id"),
        CONSTRAINT "FK_scanner_artifact_jobs_event" FOREIGN KEY ("event_id")
          REFERENCES "scanner_webhook_events"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_scanner_artifact_jobs_sha256" CHECK ("expected_sha256" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_scanner_artifact_jobs_attempts" CHECK ("attempt_count" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_scanner_artifact_jobs_due"
      ON "scanner_artifact_jobs" ("state", "next_attempt_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "scanner_webhook_events"`,
    );
    if (Number(count) > 0) {
      throw new Error('Cannot remove scanner webhook receipts while evidence exists');
    }
    await queryRunner.query(`DROP INDEX "IDX_scanner_artifact_jobs_due"`);
    await queryRunner.query(`DROP TABLE "scanner_artifact_jobs"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "FK_sheets_scanner_event"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP CONSTRAINT "UQ_sheets_scanner_event_id"`);
    await queryRunner.query(`ALTER TABLE "sheets" DROP COLUMN "scanner_event_id"`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "image_path" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX "IDX_scanner_webhook_events_result"`);
    await queryRunner.query(`DROP INDEX "IDX_scanner_webhook_events_service_date"`);
    await queryRunner.query(`DROP TABLE "scanner_webhook_events"`);
    await queryRunner.query(`DROP TYPE "public"."scanner_artifact_job_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."scanner_webhook_event_state_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."scan_admission_source_enum" RENAME TO "scan_admission_source_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."scan_admission_source_enum" AS ENUM ('browser', 'agent')`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "admission_source" TYPE "public"."scan_admission_source_enum" USING "admission_source"::text::"public"."scan_admission_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."scan_admission_source_enum_old"`);
    await queryRunner.query(`ALTER TYPE "public"."omr_operational_form_mode_enum" RENAME TO "omr_operational_form_mode_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."omr_operational_form_mode_enum" AS ENUM ('issued', 'generic')`);
    await queryRunner.query(`ALTER TABLE "sheets" ALTER COLUMN "admitted_mode" TYPE "public"."omr_operational_form_mode_enum" USING "admitted_mode"::text::"public"."omr_operational_form_mode_enum"`);
    await queryRunner.query(`DROP TYPE "public"."omr_operational_form_mode_enum_old"`);
  }
}
