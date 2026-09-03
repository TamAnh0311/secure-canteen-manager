import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePurchaseLimitConfig20260715154402 implements MigrationInterface {
  name = 'CreatePurchaseLimitConfig20260715154402';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "purchase_limit_config" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "singleton" BOOLEAN NOT NULL DEFAULT true,
        "prisoner_food_enabled" BOOLEAN NOT NULL DEFAULT true,
        "prisoner_food_amount" BIGINT NULL DEFAULT 100000,
        "prisoner_essential_enabled" BOOLEAN NOT NULL DEFAULT false,
        "prisoner_essential_amount" BIGINT NULL,
        "visitor_food_enabled" BOOLEAN NOT NULL DEFAULT true,
        "visitor_food_amount" BIGINT NULL DEFAULT 500000,
        "visitor_essential_enabled" BOOLEAN NOT NULL DEFAULT false,
        "visitor_essential_amount" BIGINT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_limit_config_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_purchase_limit_config_singleton_true" CHECK ("singleton" IS TRUE),
        CONSTRAINT "CHK_purchase_limit_config_prisoner_food_amount" CHECK ("prisoner_food_amount" IS NULL OR "prisoner_food_amount" BETWEEN 1 AND 1000000000),
        CONSTRAINT "CHK_purchase_limit_config_prisoner_essential_amount" CHECK ("prisoner_essential_amount" IS NULL OR "prisoner_essential_amount" BETWEEN 1 AND 1000000000),
        CONSTRAINT "CHK_purchase_limit_config_visitor_food_amount" CHECK ("visitor_food_amount" IS NULL OR "visitor_food_amount" BETWEEN 1 AND 1000000000),
        CONSTRAINT "CHK_purchase_limit_config_visitor_essential_amount" CHECK ("visitor_essential_amount" IS NULL OR "visitor_essential_amount" BETWEEN 1 AND 1000000000),
        CONSTRAINT "CHK_purchase_limit_config_prisoner_food_enabled_amount" CHECK (NOT "prisoner_food_enabled" OR "prisoner_food_amount" IS NOT NULL),
        CONSTRAINT "CHK_purchase_limit_config_prisoner_essential_enabled_amount" CHECK (NOT "prisoner_essential_enabled" OR "prisoner_essential_amount" IS NOT NULL),
        CONSTRAINT "CHK_purchase_limit_config_visitor_food_enabled_amount" CHECK (NOT "visitor_food_enabled" OR "visitor_food_amount" IS NOT NULL),
        CONSTRAINT "CHK_purchase_limit_config_visitor_essential_enabled_amount" CHECK (NOT "visitor_essential_enabled" OR "visitor_essential_amount" IS NOT NULL)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_purchase_limit_config_singleton" ON "purchase_limit_config" ("singleton")`);
    await queryRunner.query(`
      INSERT INTO "purchase_limit_config" ("singleton") VALUES (true)
      ON CONFLICT ("singleton") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_purchase_limit_config_singleton"`);
    await queryRunner.query(`DROP TABLE "purchase_limit_config"`);
  }
}
