import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the audit_logs table for tracking admin/operator actions.
 * Append-only: rows are never updated or deleted.
 */
export class AddAuditLogs00000000000003 implements MigrationInterface {
  name = 'AddAuditLogs00000000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id"          VARCHAR(36)  NOT NULL,
        "operator_id" VARCHAR(36)  NOT NULL,
        "username"    VARCHAR(100) NOT NULL,
        "role"        VARCHAR(20)  NOT NULL,
        "action"      VARCHAR(50)  NOT NULL,
        "resource"    VARCHAR(50)  NOT NULL,
        "resource_id" VARCHAR(36),
        "method"      VARCHAR(10)  NOT NULL,
        "path"        VARCHAR(500) NOT NULL,
        "status_code" INTEGER      NOT NULL,
        "detail"      TEXT,
        "ip"          VARCHAR(45),
        "created_at"  DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_operator" ON "audit_logs" ("operator_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_created_at" ON "audit_logs" ("created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
