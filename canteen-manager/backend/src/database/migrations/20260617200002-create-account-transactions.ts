import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the append-only account_transactions ledger. Signed integer-VND amount,
// snapshot balance_after (>= 0), non-null operator_id (every move is attributable),
// indexes on user_id and related_order_id. down() refuses to drop a populated ledger.
export class CreateAccountTransactions20260617200002 implements MigrationInterface {
  name = 'CreateAccountTransactions20260617200002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."account_transactions_type_enum" AS ENUM ('topup', 'order_debit', 'reversal')
    `);

    await queryRunner.query(`
      CREATE TABLE "account_transactions" (
        "id"               UUID                                       NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID                                       NOT NULL,
        "type"             "public"."account_transactions_type_enum"  NOT NULL,
        "amount"           BIGINT                                     NOT NULL,
        "balance_after"    BIGINT                                     NOT NULL,
        "method"           CHARACTER VARYING(20)                      NULL,
        "ref"              CHARACTER VARYING(255)                     NULL,
        "related_order_id" UUID                                       NULL,
        "operator_id"      UUID                                       NOT NULL,
        "note"             CHARACTER VARYING(500)                     NULL,
        "created_at"       TIMESTAMPTZ                                NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_account_transactions_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_account_transactions_balance_after_nonneg" CHECK ("balance_after" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_account_transactions_user_id"
        ON "account_transactions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_account_transactions_related_order_id"
        ON "account_transactions" ("related_order_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ count: number }> = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "account_transactions"`,
    );
    if (rows[0].count > 0) {
      throw new Error(
        `Refusing to drop account_transactions: ${rows[0].count} ledger row(s) present. Archive the ledger before reverting.`,
      );
    }
    await queryRunner.query(`DROP INDEX "IDX_account_transactions_related_order_id"`);
    await queryRunner.query(`DROP INDEX "IDX_account_transactions_user_id"`);
    await queryRunner.query(`DROP TABLE "account_transactions"`);
    await queryRunner.query(`DROP TYPE "public"."account_transactions_type_enum"`);
  }
}
