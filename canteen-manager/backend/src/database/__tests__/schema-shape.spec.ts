import 'reflect-metadata';
import { DataSource, DataSourceOptions, MigrationInterface } from 'typeorm';

// Schema-shape guard: runs the real migration chain against a throwaway Postgres DB and
// asserts the post-migration shape that money-critical code depends on. A wrong schema here
// means wrong debits downstream, so these invariants are pinned in a test rather than trusted.
//
// Points at SCHEMA_SHAPE_DATABASE_URL (default: the dedicated canteen_test DB). It is built
// as its own DataSource — never the app's default — and the schema is dropped + re-migrated
// from empty on every run so editing an already-applied create-migration can never go stale.
const TEST_DB_URL =
  process.env['SCHEMA_SHAPE_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://canteen:change_me_in_production@localhost:55433/canteen_test';

function buildDataSource(migrations: DataSourceOptions['migrations'] = [__dirname + '/../migrations/*.{ts,js}']): DataSource {
  return new DataSource({
    type: 'postgres',
    url: TEST_DB_URL,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    entities: [__dirname + '/../../**/*.entity.{ts,js}'],
    migrations,
    migrationsTableName: 'typeorm_migrations',
  });
}

describe('schema shape (post-migration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    // Empty the DB then replay the full migration chain so the asserted shape reflects the
    // migration files as edited, not whatever state the target DB happened to be left in.
    await ds.dropDatabase();
    await ds.runMigrations();
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.destroy();
    }
  });

  async function tableExists(table: string): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await ds.query(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`public.${table}`],
    );
    return rows[0].exists;
  }

  async function columnIsNotNull(table: string, column: string): Promise<boolean | null> {
    const rows: Array<{ is_nullable: string }> = await ds.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    if (rows.length === 0) return null;
    return rows[0].is_nullable === 'NO';
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const rows: Array<{ n: string }> = await ds.query(
      `SELECT count(*) AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return Number(rows[0].n) > 0;
  }

  async function columnCharacterMaximumLength(
    table: string,
    column: string,
  ): Promise<number | null> {
    const rows: Array<{ character_maximum_length: number | null }> = await ds.query(
      `SELECT character_maximum_length FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows[0]?.character_maximum_length ?? null;
  }

  // Returns the index's column list (ordered) and partial WHERE predicate, or null if absent.
  async function getIndex(
    name: string,
  ): Promise<{ columns: string[]; predicate: string | null } | null> {
    const rows: Array<{ indexdef: string }> = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      [name],
    );
    if (rows.length === 0) return null;
    const def = rows[0].indexdef;
    const cols = def.slice(def.indexOf('(') + 1, def.indexOf(')'));
    const columns = cols.split(',').map((c) => c.trim().replace(/"/g, ''));
    const whereIdx = def.toUpperCase().indexOf(' WHERE ');
    const predicate = whereIdx >= 0 ? def.slice(whereIdx + 7).trim() : null;
    return { columns, predicate };
  }

  async function getForeignKey(
    table: string,
    column: string,
  ): Promise<{ referencedTable: string; deleteRule: string } | null> {
    const rows: Array<{ referenced_table: string; delete_rule: string }> = await ds.query(
      `SELECT ccu.table_name AS referenced_table, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.constraint_schema = kcu.constraint_schema
         JOIN information_schema.referential_constraints rc
           ON tc.constraint_name = rc.constraint_name
          AND tc.constraint_schema = rc.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON rc.unique_constraint_name = ccu.constraint_name
          AND rc.unique_constraint_schema = ccu.constraint_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = $2`,
      [table, column],
    );
    if (rows.length === 0) return null;
    return {
      referencedTable: rows[0].referenced_table,
      deleteRule: rows[0].delete_rule,
    };
  }

  async function enumLabels(typeName: string): Promise<string[]> {
    const rows: Array<{ enumlabel: string }> = await ds.query(
      `SELECT e.enumlabel
         FROM pg_type t
         JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [typeName],
    );
    return rows.map((row) => row.enumlabel);
  }

  it('drops the meal_sessions table', async () => {
    expect(await tableExists('meal_sessions')).toBe(false);
  });

  it('adds a nullable operator zone assignment', async () => {
    expect(await columnExists('operators', 'zone')).toBe(true);
    expect(await columnIsNotNull('operators', 'zone')).toBe(false);
  });

  it('menu_items.code exists and is unique, session_id is gone', async () => {
    expect(await columnExists('menu_items', 'code')).toBe(true);
    expect(await columnExists('menu_items', 'session_id')).toBe(false);

    // A unique constraint on code must reject a duplicate insert (23505).
    await ds.query(
      `INSERT INTO menu_items (code, position, name, price, category, is_active)
        VALUES ('DUP1', 9001, 'first', 0, 'food', true)`,
    );
    await expect(
      ds.query(
        `INSERT INTO menu_items (code, position, name, price, category, is_active)
          VALUES ('DUP1', 9002, 'second', 0, 'food', true)`,
      ),
    ).rejects.toMatchObject({ code: '23505' });

    // position is globally unique under its pinned name.
    const posIdx = await getIndex('UQ_menu_items_position');
    expect(posIdx).not.toBeNull();
    expect(posIdx!.columns).toEqual(['position']);
  });

  it('adds non-null food/essential category snapshots and the seeded checked singleton policy', async () => {
    expect(await enumLabels('menu_item_category_enum')).toEqual(['food', 'essential']);
    expect(await columnIsNotNull('menu_items', 'category')).toBe(true);
    expect(await columnIsNotNull('order_items', 'category')).toBe(true);

    const rows = await ds.query(`SELECT * FROM purchase_limit_config`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      singleton: true,
      prisoner_food_enabled: true,
      prisoner_food_amount: '100000',
      prisoner_essential_enabled: false,
      prisoner_essential_amount: null,
      visitor_food_enabled: true,
      visitor_food_amount: '500000',
      visitor_essential_enabled: false,
      visitor_essential_amount: null,
    });
    await expect(ds.query(`INSERT INTO purchase_limit_config (singleton) VALUES (false)`))
      .rejects.toMatchObject({ code: '23514' });
    await expect(ds.query(`INSERT INTO purchase_limit_config (singleton) VALUES (true)`))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('orders.service_date is NOT NULL and session_id is gone', async () => {
    expect(await columnExists('orders', 'service_date')).toBe(true);
    expect(await columnIsNotNull('orders', 'service_date')).toBe(true);
    expect(await columnExists('orders', 'session_id')).toBe(false);
  });

  it('orders active-uniqueness index has the pinned name and column tuple', async () => {
    // Phase 3's supersede/dedup query scope must match this index column-for-column.
    const idx = await getIndex('UQ_orders_active_date_user_source');
    expect(idx).not.toBeNull();
    expect(idx!.columns).toEqual(['service_date', 'user_id', 'source']);
    expect(idx!.predicate).not.toBeNull();
    expect(idx!.predicate!.toLowerCase()).toContain("status = 'active'");
    // The old per-session index must be gone.
    expect(await getIndex('UQ_orders_active_session_user')).toBeNull();
    expect(await getIndex('UQ_orders_active_session_user_source')).toBeNull();
  });

  it('allows scanner orders while sharing the active scanned-order channel', async () => {
    const sourceConstraint = await ds.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'CHK_orders_source'
    `);
    expect(sourceConstraint[0].definition).toContain("'scanner'");
    const idx = await getIndex('UQ_orders_active_date_user_scanned_channel');
    expect(idx).toMatchObject({ columns: ['service_date', 'user_id'] });
    expect(idx?.predicate?.toLowerCase()).toContain("source" );
    expect(idx?.predicate?.toLowerCase()).toContain("'scanner'");
  });

  it('sheets.service_date exists and session_id is gone', async () => {
    expect(await columnExists('sheets', 'service_date')).toBe(true);
    expect(await columnExists('sheets', 'session_id')).toBe(false);
  });

  it('adds generic admission, identity audit, and normalized-cell contracts additively', async () => {
    expect(await columnExists('users', 'normalized_cell')).toBe(true);
    expect(await columnExists('users', 'cell_normalization_version')).toBe(true);
    const normalizedCellIndex = await getIndex('IDX_users_active_normalized_cell');
    expect(normalizedCellIndex?.columns).toEqual(['normalized_cell', 'cell_normalization_version', 'id']);
    expect(normalizedCellIndex?.predicate).toContain('is_active');

    for (const column of [
      'template_id',
      'admitted_at',
      'admission_source',
      'admitted_mode',
      'admitted_generation',
      'admitted_by',
      'identity_evidence_json',
      'ranked_candidates_json',
      'proposed_user_id',
      'identity_selected_by',
      'identity_selected_at',
      'identity_selection_source',
      'identity_selection_reason',
      'identity_evidence_purged_at',
      'purge_generation',
    ]) {
      expect(await columnExists('sheets', column)).toBe(true);
    }
    expect(await columnIsNotNull('sheets', 'admitted_at')).toBe(true);
    expect(await columnIsNotNull('sheets', 'admission_source')).toBe(true);
    expect(await columnIsNotNull('sheets', 'admitted_mode')).toBe(true);
    expect(await columnIsNotNull('sheets', 'admitted_generation')).toBe(true);
    expect(await enumLabels('scan_admission_source_enum')).toEqual(['browser', 'agent', 'scanner']);
    expect(await enumLabels('omr_operational_form_mode_enum')).toEqual(['issued', 'generic', 'scanner']);
    expect(await enumLabels('identity_selection_source_enum')).toEqual([
      'ranked_candidate_selected',
      'manual_search_selected',
    ]);
    expect(await getForeignKey('sheets', 'template_id')).toEqual({
      referencedTable: 'omr_form_templates',
      deleteRule: 'RESTRICT',
    });
    expect(await getForeignKey('sheets', 'proposed_user_id')).toEqual({
      referencedTable: 'users',
      deleteRule: 'SET NULL',
    });
  });

  it('creates durable scanner webhook receipts, linked sheets, and artifact jobs', async () => {
    expect(await tableExists('scanner_webhook_events')).toBe(true);
    expect(await tableExists('scanner_artifact_jobs')).toBe(true);
    expect(await columnExists('sheets', 'scanner_event_id')).toBe(true);
    expect(await columnIsNotNull('sheets', 'image_path')).toBe(false);
    expect(await getForeignKey('sheets', 'scanner_event_id')).toEqual({
      referencedTable: 'scanner_webhook_events',
      deleteRule: 'RESTRICT',
    });
    expect(await getIndex('UQ_sheets_scanner_event_id')).toMatchObject({
      columns: ['scanner_event_id'],
    });
    expect(await getIndex('UQ_scanner_artifact_jobs_event_artifact')).toMatchObject({
      columns: ['event_id', 'artifact_id'],
    });
    expect(await enumLabels('scanner_artifact_job_state_enum')).toEqual([
      'pending', 'processing', 'retrying', 'available', 'missing',
      'permanent_failed', 'integrity_fault', 'purged',
    ]);
  });

  it('users has zone + cell columns and the old department column is gone', async () => {
    // The rename moves ex-department (real Khu data) into zone and ex-zone into cell.
    // Selecting/filtering on the dropped department name would error post-migration.
    expect(await columnExists('users', 'zone')).toBe(true);
    expect(await columnExists('users', 'cell')).toBe(true);
    expect(await columnExists('users', 'department')).toBe(false);
  });

  it('threshold_config has roi columns and enforces a single row', async () => {
    expect(await columnExists('threshold_config', 'roi_template')).toBe(true);
    expect(await columnExists('threshold_config', 'roi_version')).toBe(true);
    expect(await columnExists('threshold_config', 'roi_generated_at')).toBe(true);

    // A real singleton: a first row inserts, a second must raise 23505 so the global OMR
    // template owner can never split into two rows (split → null read → spurious failure).
    await ds.query(`DELETE FROM threshold_config`);
    await ds.query(
      `INSERT INTO threshold_config (icr_threshold, omr_empty_max, omr_ticked_min, digit_box_count)
        VALUES (0.85, 0.30, 0.70, 6)`,
    );
    await expect(
      ds.query(
        `INSERT INTO threshold_config (icr_threshold, omr_empty_max, omr_ticked_min, digit_box_count)
          VALUES (0.80, 0.25, 0.75, 6)`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('issued_omr_forms stores an immutable issued/consumed/void audit lifecycle', async () => {
    expect(await tableExists('issued_omr_forms')).toBe(true);

    for (const column of [
      'token',
      'user_id',
      'service_date',
      'roi_version',
      'issued_by',
      'status',
      'issued_at',
      'created_at',
      'updated_at',
    ]) {
      expect(await columnIsNotNull('issued_omr_forms', column)).toBe(true);
    }
    expect(await columnExists('issued_omr_forms', 'consumed_sheet_id')).toBe(true);
    expect(await columnIsNotNull('issued_omr_forms', 'consumed_sheet_id')).toBe(false);
    expect(await columnIsNotNull('issued_omr_forms', 'template_id')).toBe(true);
    expect(await columnIsNotNull('issued_omr_forms', 'form_mode')).toBe(true);
    expect(await columnCharacterMaximumLength('issued_omr_forms', 'roi_version')).toBe(64);

    expect(await enumLabels('issued_omr_forms_status_enum')).toEqual([
      'issued',
      'consumed',
      'void',
    ]);

    expect(await getForeignKey('issued_omr_forms', 'user_id')).toEqual({
      referencedTable: 'users',
      deleteRule: 'RESTRICT',
    });
    expect(await getForeignKey('issued_omr_forms', 'issued_by')).toEqual({
      referencedTable: 'operators',
      deleteRule: 'RESTRICT',
    });
    expect(await getForeignKey('issued_omr_forms', 'consumed_sheet_id')).toEqual({
      referencedTable: 'sheets',
      deleteRule: 'RESTRICT',
    });
    expect(await getForeignKey('issued_omr_forms', 'template_id')).toEqual({
      referencedTable: 'omr_form_templates',
      deleteRule: 'RESTRICT',
    });
  });

  it('creates immutable versioned OMR templates with bounded ordered rows', async () => {
    expect(await tableExists('omr_form_templates')).toBe(true);
    expect(await tableExists('omr_form_template_rows')).toBe(true);
    expect(await enumLabels('omr_form_mode_enum')).toEqual(['code', 'full_list']);
    expect(await enumLabels('omr_form_orientation_enum')).toEqual(['portrait', 'landscape']);
    const active = await getIndex('UQ_omr_form_templates_active_mode');
    expect(active?.columns).toEqual(['mode']);
    expect(active?.predicate?.toLowerCase()).toContain('is_active');
    expect(await getForeignKey('omr_form_template_rows', 'template_id')).toEqual({
      referencedTable: 'omr_form_templates',
      deleteRule: 'RESTRICT',
    });
    expect(await getForeignKey('omr_form_template_rows', 'menu_item_id')).toEqual({
      referencedTable: 'menu_items',
      deleteRule: 'RESTRICT',
    });
  });

  it('rejects activated template changes and catalog rows on code templates', async () => {
    const [menuItem] = await ds.query(
      `INSERT INTO menu_items (code, position, name, price, category, is_active)
       VALUES ('998', 8998, 'Template guard item', 0, 'food', true) RETURNING id`,
    );
    const [codeTemplate] = await ds.query(
      `INSERT INTO omr_form_templates
        (revision, mode, paper_size, orientation, geometry, geometry_hash, is_active, activated_at)
       VALUES ('guard-code-v1', 'code', 'A5', 'portrait', '{}'::jsonb, repeat('b', 64), false, now())
       RETURNING id`,
    );
    await expect(ds.query(
      `INSERT INTO omr_form_template_rows
        (template_id, row_index, menu_item_id, code_snapshot, short_label_snapshot, position)
       VALUES ($1, 0, $2, '998', 'Invalid code row', 8998)`,
      [codeTemplate.id, menuItem.id],
    )).rejects.toThrow(/only to full-list/i);
    await expect(ds.query(
      `UPDATE omr_form_templates SET geometry = '{"changed":true}'::jsonb WHERE id = $1`,
      [codeTemplate.id],
    )).rejects.toThrow(/immutable/i);
  });

  it('allows full-list rows to be frozen before atomic activation', async () => {
    const [menuItem] = await ds.query(
      `INSERT INTO menu_items (code, position, name, price, category, is_active)
       VALUES ('997', 8997, 'Activation row item', 0, 'food', true) RETURNING id`,
    );
    const [template] = await ds.query(
      `INSERT INTO omr_form_templates
        (revision, mode, paper_size, orientation, geometry, geometry_hash, catalog_hash, is_active, activated_at)
       VALUES ('activation-full-v1', 'full_list', 'A5', 'landscape', '{}'::jsonb,
         repeat('c', 64), repeat('d', 64), false, NULL)
       RETURNING id`,
    );
    await ds.query(
      `INSERT INTO omr_form_template_rows
        (template_id, row_index, menu_item_id, code_snapshot, short_label_snapshot, position)
       VALUES ($1, 0, $2, '997', 'Activation item', 8997)`,
      [template.id, menuItem.id],
    );
    await ds.query(
      `UPDATE omr_form_templates SET is_active = true, activated_at = now() WHERE id = $1`,
      [template.id],
    );
    const [activated] = await ds.query(
      `SELECT is_active, activated_at FROM omr_form_templates WHERE id = $1`,
      [template.id],
    );
    expect(activated.is_active).toBe(true);
    expect(activated.activated_at).not.toBeNull();
  });

  it('allows only one issued form per prisoner and service date', async () => {
    const idx = await getIndex('UQ_issued_omr_forms_active_user_date');
    expect(idx).not.toBeNull();
    expect(idx!.columns).toEqual(['user_id', 'service_date']);
    expect(idx!.predicate?.toLowerCase().replace(/"/g, '')).toContain("status = 'issued'");

    const [user] = await ds.query(
      `INSERT INTO users (legacy_id, name, synced_at)
       VALUES ('OMR-SCHEMA-USER', 'OMR schema prisoner', now())
       RETURNING id`,
    );
    const [issuer] = await ds.query(
      `INSERT INTO operators (username, password_hash, display_name, role)
       VALUES ('omr-schema-issuer', 'not-a-real-password-hash', 'OMR schema issuer', 'operator')
       RETURNING id`,
    );
    const serviceDate = '2099-12-30';
    const [template] = await ds.query(
      `INSERT INTO omr_form_templates
        (revision, mode, paper_size, orientation, geometry, geometry_hash, is_active, activated_at)
       VALUES ('schema-code-v1', 'code', 'A5', 'portrait', '{}'::jsonb, repeat('a', 64), true, now())
       RETURNING id`,
    );

    await ds.query(
      `INSERT INTO issued_omr_forms (token, user_id, service_date, roi_version, issued_by, template_id, form_mode)
       VALUES ($1, $2, $3, 'v3', $4, $5, 'code')`,
      ['11111111-1111-4111-8111-111111111111', user.id, serviceDate, issuer.id, template.id],
    );
    await expect(
      ds.query(
        `INSERT INTO issued_omr_forms (token, user_id, service_date, roi_version, issued_by, template_id, form_mode)
         VALUES ($1, $2, $3, 'v3', $4, $5, 'code')`,
        ['22222222-2222-4222-8222-222222222222', user.id, serviceDate, issuer.id, template.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await ds.query(
      `UPDATE issued_omr_forms SET status = 'void'
        WHERE user_id = $1 AND service_date = $2`,
      [user.id, serviceDate],
    );
    await expect(
      ds.query(
        `INSERT INTO issued_omr_forms (token, user_id, service_date, roi_version, issued_by, template_id, form_mode)
         VALUES ($1, $2, $3, 'v3', $4, $5, 'code')`,
        ['33333333-3333-4333-8333-333333333333', user.id, serviceDate, issuer.id, template.id],
      ),
    ).resolves.toBeDefined();
  });

  it('creates one immutable TG8 snapshot per accepted relative order', async () => {
    expect(await tableExists('order_tg8_documents')).toBe(true);
    for (const column of [
      'order_id',
      'template_revision',
      'snapshot',
      'accepted_at',
      'operator_id',
      'created_at',
    ]) {
      expect(await columnIsNotNull('order_tg8_documents', column)).toBe(true);
    }
    expect(await getForeignKey('order_tg8_documents', 'order_id')).toEqual({
      referencedTable: 'orders',
      deleteRule: 'RESTRICT',
    });
    expect(await getForeignKey('order_tg8_documents', 'operator_id')).toEqual({
      referencedTable: 'operators',
      deleteRule: 'RESTRICT',
    });

    const triggers: Array<{ tgname: string }> = await ds.query(
      `SELECT tgname
         FROM pg_trigger
        WHERE tgrelid = 'order_tg8_documents'::regclass
          AND NOT tgisinternal`,
    );
    expect(triggers.map((row) => row.tgname)).toContain('TRG_order_tg8_documents_immutable');

    const [operator] = await ds.query(
      `INSERT INTO operators (username, password_hash, display_name, role, is_active)
       VALUES ('tg8-schema-cashier', 'not-a-real-hash', 'TG8 schema cashier', 'cashier', true)
       RETURNING id`,
    );
    const [user] = await ds.query(
      `INSERT INTO users (legacy_id, name, synced_at)
       VALUES ('TG8-SCHEMA-P001', 'TG8 schema prisoner', now())
       RETURNING id`,
    );
    const [order] = await ds.query(
      `INSERT INTO orders
        (service_date, user_id, source, status, total_amount, payment_status, payment_method)
       VALUES ('2026-07-18', $1, 'relative', 'active', 1000, 'paid', 'cash')
       RETURNING id`,
      [user.id],
    );
    const invalidSnapshots = [
      { schemaVersion: 'tg8-snapshot-v1' },
      {
        schemaVersion: 'tg8-snapshot-v1',
        prisoner: {
          legacyId: 'TG8-SCHEMA-P001',
          name: 'TG8 schema prisoner',
          dateOfBirth: null,
          offense: null,
          sensitiveExtra: 'must not persist',
        },
        items: [],
        acceptedTotal: 1000,
        acceptedTotalWords: 'một nghìn đồng',
        acceptanceDate: '2026-07-17',
      },
      {
        schemaVersion: 'tg8-snapshot-v1',
        prisoner: {
          legacyId: 'TG8-SCHEMA-P001',
          name: 'TG8 schema prisoner',
          dateOfBirth: null,
          offense: null,
        },
        items: [{ name: 'Mì gói', quantity: 1.5 }],
        acceptedTotal: -1000,
        acceptedTotalWords: 'invalid',
        acceptanceDate: '2026-02-31',
      },
    ];
    for (const snapshot of invalidSnapshots) {
      await expect(
        ds.query(
          `INSERT INTO order_tg8_documents
            (order_id, template_revision, snapshot, accepted_at, operator_id)
           VALUES ($1, 'tg8-v1', $2::jsonb, now(), $3)`,
          [order.id, JSON.stringify(snapshot), operator.id],
        ),
      ).rejects.toBeDefined();
    }
    await ds.query(
      `INSERT INTO order_tg8_documents
        (order_id, template_revision, snapshot, accepted_at, operator_id)
       VALUES (
         $1,
         'tg8-v1',
         '{
           "schemaVersion":"tg8-snapshot-v1",
           "prisoner":{
             "legacyId":"TG8-SCHEMA-P001",
             "name":"TG8 schema prisoner",
             "dateOfBirth":null,
             "offense":null
           },
           "items":[],
           "acceptedTotal":1000,
           "acceptedTotalWords":"một nghìn đồng",
           "acceptanceDate":"2026-07-17"
         }'::jsonb,
         now(),
         $2
       )`,
      [order.id, operator.id],
    );
    await expect(
      ds.query(`UPDATE order_tg8_documents SET template_revision = 'changed' WHERE order_id = $1`, [
        order.id,
      ]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      ds.query(`DELETE FROM order_tg8_documents WHERE order_id = $1`, [order.id]),
    ).rejects.toThrow(/immutable/i);
  });

  it('backfills existing A4 issued history to one retired legacy template', async () => {
    const allMigrations = ds.migrations.map(
      (migration) => migration.constructor as new () => MigrationInterface,
    );
    const priorMigrations = allMigrations.filter(
      (Migration) => ![
        'CreateVersionedOmrFormTemplates20260717090000',
        'AddGenericSheetIdentity20260727164700',
        'CreateScannerWebhookEvents20260806085000',
        'AddScannerOrderChannel20260806113000',
      ].includes(new Migration().name ?? ''),
    );

    await ds.dropDatabase();
    await ds.destroy();
    ds = buildDataSource(priorMigrations);
    await ds.initialize();
    await ds.runMigrations();

    await ds.query(
      `INSERT INTO threshold_config
        (icr_threshold, omr_empty_max, omr_ticked_min, digit_box_count, roi_template, roi_version, roi_generated_at)
       VALUES (0.85, 0.30, 0.70, 6, '{"roi_version":"v3","regions":[]}'::jsonb, 'v3', now())`,
    );
    const [user] = await ds.query(
      `INSERT INTO users (legacy_id, name, synced_at)
       VALUES ('LEGACY-OMR-USER', 'Legacy OMR prisoner', now()) RETURNING id`,
    );
    const [issuer] = await ds.query(
      `INSERT INTO operators (username, password_hash, display_name, role)
       VALUES ('legacy-omr-issuer', 'not-a-real-password-hash', 'Legacy OMR issuer', 'operator') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO issued_omr_forms (token, user_id, service_date, roi_version, issued_by)
       VALUES ('44444444-4444-4444-8444-444444444444', $1, '2099-12-31', 'v3', $2)`,
      [user.id, issuer.id],
    );

    await ds.destroy();
    ds = buildDataSource(allMigrations);
    await ds.initialize();
    await ds.runMigrations();

    const [form] = await ds.query(
      `SELECT f.form_mode, f.template_id, t.revision, t.paper_size, t.is_active, t.retired_at
         FROM issued_omr_forms f
         JOIN omr_form_templates t ON t.id = f.template_id
        WHERE f.token = '44444444-4444-4444-8444-444444444444'`,
    );
    expect(form).toMatchObject({
      form_mode: 'code',
      revision: 'a4-code-v3',
      paper_size: 'A4',
      is_active: false,
    });
    expect(form.template_id).toBeTruthy();
    expect(form.retired_at).toBeInstanceOf(Date);
  });
});
