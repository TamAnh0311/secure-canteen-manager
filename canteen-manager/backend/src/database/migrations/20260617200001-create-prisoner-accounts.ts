import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the prisoner_accounts table: one balance row per prisoner, integer VND,
// non-negative. Backfills a zero-balance account for every existing user so the hot
// money path never races on first-touch creation. down() refuses to drop a populated
// table — an air-gapped node has no off-box backup of commissary balances.
export class CreatePrisonerAccounts20260617200001 implements MigrationInterface {
  name = 'CreatePrisonerAccounts20260617200001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prisoner_accounts" (
        "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    UUID         NOT NULL,
        "balance"    BIGINT       NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prisoner_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prisoner_accounts_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_prisoner_accounts_balance_nonneg" CHECK ("balance" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_prisoner_accounts_user_id"
        ON "prisoner_accounts" ("user_id")
    `);

    // Backfill one zero-balance account per existing prisoner. ON CONFLICT keeps this
    // re-runnable and harmless if any rows already exist.
    await queryRunner.query(`
      INSERT INTO "prisoner_accounts" ("user_id")
      SELECT "id" FROM "users"
      ON CONFLICT ("user_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ count: number }> = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "prisoner_accounts"`,
    );
    if (rows[0].count > 0) {
      throw new Error(
        `Refusing to drop prisoner_accounts: ${rows[0].count} balance row(s) present. Archive balances before reverting.`,
      );
    }
    await queryRunner.query(`DROP INDEX "UQ_prisoner_accounts_user_id"`);
    await queryRunner.query(`DROP TABLE "prisoner_accounts"`);
  }
}
