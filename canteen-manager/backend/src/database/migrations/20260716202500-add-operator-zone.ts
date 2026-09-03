import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOperatorZone20260716202500 implements MigrationInterface {
  name = 'AddOperatorZone20260716202500';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operators" ADD "zone" character varying(255) NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "operators" DROP COLUMN "zone"`);
  }
}
