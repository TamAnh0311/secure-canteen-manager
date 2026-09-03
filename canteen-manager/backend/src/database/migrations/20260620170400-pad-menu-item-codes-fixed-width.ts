import { MigrationInterface, QueryRunner } from 'typeorm';

// Left-pads existing numeric menu codes to a fixed 3-digit width ('1' → '001', '01' → '001').
// The order form now captures a dish by its handwritten code digits, resolved downstream by an
// exact string match against menu_items.code — so stored codes must share the form's fixed width
// or a scanned '001' would never match a stored '1'. Only purely-numeric codes shorter than the
// target width are touched; anything already ≥3 chars or non-numeric is left as-is.
export class PadMenuItemCodesFixedWidth20260620170400 implements MigrationInterface {
  name = 'PadMenuItemCodesFixedWidth20260620170400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "menu_items"
        SET "code" = LPAD("code", 3, '0')
        WHERE "code" ~ '^[0-9]+$' AND length("code") < 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Strip leading zeros back to a minimum 2-digit width for numeric codes below 100,
    // reversing the prior 2-digit convention. Codes ≥100 keep their natural width.
    await queryRunner.query(`
      UPDATE "menu_items"
        SET "code" = LPAD(CAST(CAST("code" AS INTEGER) AS TEXT), 2, '0')
        WHERE "code" ~ '^[0-9]+$' AND CAST("code" AS INTEGER) < 100
    `);
  }
}
