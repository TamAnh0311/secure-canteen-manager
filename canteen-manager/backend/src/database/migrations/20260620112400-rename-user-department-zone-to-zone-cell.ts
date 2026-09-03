import { MigrationInterface, QueryRunner } from 'typeorm';

// In-place rename of the two user location columns: the column that held the real
// "Khu" data (department) becomes `zone`, and the previously-NULL `zone` column becomes
// `cell`. Renames preserve data in place — no copy, no data loss.
//
// Order matters: rename the inner column (zone→cell) FIRST, then department→zone. Doing
// department→zone first would collide with the still-present `zone` column.
export class RenameUserDepartmentZoneToZoneCell20260620112400
  implements MigrationInterface
{
  name = 'RenameUserDepartmentZoneToZoneCell20260620112400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "zone" TO "cell"`);
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "department" TO "zone"`);
  }

  // Reverses in the opposite order. Rollback precondition: no row may hold a non-NULL
  // `cell` value (SELECT COUNT(*) FROM users WHERE cell IS NOT NULL = 0). `cell` is the
  // ex-zone column (NULL in production) and stays NULL until the legacy source wires a real
  // column; once it holds data, this down() would overwrite the real Khu data in `zone`
  // with cell strings, corrupting the directory.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "zone" TO "department"`);
    await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "cell" TO "zone"`);
  }
}
