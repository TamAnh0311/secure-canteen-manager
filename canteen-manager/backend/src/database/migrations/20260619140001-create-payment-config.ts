import { MigrationInterface, QueryRunner } from 'typeorm';

// True-singleton global config table holding the one canteen bank account the kiosk renders as
// an offline VietQR. Fields are nullable and the single row is seeded EMPTY here (a bank account
// has no env default) so the public kiosk path is a pure read — no lazy insert-race on an
// unauthenticated route. The `singleton` UNIQUE index permits exactly one row.
export class CreatePaymentConfig20260619140001 implements MigrationInterface {
  name = 'CreatePaymentConfig20260619140001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_config" (
        "id"             UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "singleton"      BOOLEAN               NOT NULL DEFAULT true,
        "bank_bin"       CHARACTER VARYING(6)  NULL,
        "account_number" CHARACTER VARYING(19) NULL,
        "account_name"   CHARACTER VARYING(140) NULL,
        "updated_at"     TIMESTAMPTZ           NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_config_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_payment_config_singleton"
        ON "payment_config" ("singleton")
    `);

    // Seed the one empty row so getGlobal on the public kiosk path is a pure read.
    await queryRunner.query(`
      INSERT INTO "payment_config" ("singleton") VALUES (true)
        ON CONFLICT ("singleton") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_payment_config_singleton"`);
    await queryRunner.query(`DROP TABLE "payment_config"`);
  }
}
