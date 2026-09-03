import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderTg8Documents20260717112000 implements MigrationInterface {
  name = 'CreateOrderTg8Documents20260717112000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION is_valid_tg8_snapshot(value jsonb)
      RETURNS boolean AS $$
      DECLARE
        item jsonb;
        acceptance_date text;
        key_count integer;
      BEGIN
        IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT (value ?& ARRAY[
            'schemaVersion',
            'prisoner',
            'items',
            'acceptedTotal',
            'acceptedTotalWords',
            'acceptanceDate'
          ])
          OR value->>'schemaVersion' IS DISTINCT FROM 'tg8-snapshot-v1'
          OR jsonb_typeof(value->'prisoner') IS DISTINCT FROM 'object'
          OR NOT ((value->'prisoner') ?& ARRAY[
            'name',
            'legacyId',
            'dateOfBirth',
            'offense'
          ])
          OR jsonb_typeof(value->'prisoner'->'name') IS DISTINCT FROM 'string'
          OR jsonb_typeof(value->'prisoner'->'legacyId') IS DISTINCT FROM 'string'
          OR jsonb_typeof(value->'prisoner'->'dateOfBirth') NOT IN ('string', 'null')
          OR jsonb_typeof(value->'prisoner'->'offense') NOT IN ('string', 'null')
          OR jsonb_typeof(value->'items') IS DISTINCT FROM 'array'
          OR jsonb_typeof(value->'acceptedTotal') IS DISTINCT FROM 'number'
          OR (value->>'acceptedTotal') !~ '^(0|[1-9][0-9]*)$'
          OR jsonb_typeof(value->'acceptedTotalWords') IS DISTINCT FROM 'string'
          OR jsonb_typeof(value->'acceptanceDate') IS DISTINCT FROM 'string'
        THEN
          RETURN false;
        END IF;

        SELECT count(*) INTO key_count FROM jsonb_object_keys(value);
        IF key_count <> 6 THEN
          RETURN false;
        END IF;
        SELECT count(*) INTO key_count FROM jsonb_object_keys(value->'prisoner');
        IF key_count <> 4 THEN
          RETURN false;
        END IF;

        FOR item IN SELECT jsonb_array_elements(value->'items')
        LOOP
          IF jsonb_typeof(item) IS DISTINCT FROM 'object'
            OR NOT (item ?& ARRAY['name', 'quantity'])
            OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string'
            OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
            OR (item->>'quantity') !~ '^[1-9][0-9]*$'
          THEN
            RETURN false;
          END IF;
          SELECT count(*) INTO key_count FROM jsonb_object_keys(item);
          IF key_count <> 2 THEN
            RETURN false;
          END IF;
        END LOOP;

        acceptance_date := value->>'acceptanceDate';
        RETURN acceptance_date ~
          '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          AND to_char(acceptance_date::date, 'YYYY-MM-DD') = acceptance_date;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE STRICT
    `);
    await queryRunner.query(`
      CREATE TABLE "order_tg8_documents" (
        "order_id" uuid NOT NULL,
        "template_revision" character varying(50) NOT NULL,
        "snapshot" jsonb NOT NULL,
        "accepted_at" timestamptz NOT NULL,
        "operator_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_tg8_documents_order_id" PRIMARY KEY ("order_id"),
        CONSTRAINT "CHK_order_tg8_documents_snapshot_object"
          CHECK (is_valid_tg8_snapshot("snapshot")),
        CONSTRAINT "FK_order_tg8_documents_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_order_tg8_documents_operator"
          FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_order_tg8_documents_accepted_at"
        ON "order_tg8_documents" ("accepted_at" DESC)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_order_tg8_document_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'TG8 documents are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_order_tg8_documents_immutable"
      BEFORE UPDATE OR DELETE ON "order_tg8_documents"
      FOR EACH ROW EXECUTE FUNCTION prevent_order_tg8_document_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "order_tg8_documents"`,
    );
    if (Number(count) > 0) {
      throw new Error('Cannot revert TG8 document migration while immutable snapshots exist');
    }
    await queryRunner.query(
      `DROP TRIGGER "TRG_order_tg8_documents_immutable" ON "order_tg8_documents"`,
    );
    await queryRunner.query(`DROP FUNCTION prevent_order_tg8_document_mutation()`);
    await queryRunner.query(`DROP TABLE "order_tg8_documents"`);
    await queryRunner.query(`DROP FUNCTION is_valid_tg8_snapshot(jsonb)`);
  }
}
