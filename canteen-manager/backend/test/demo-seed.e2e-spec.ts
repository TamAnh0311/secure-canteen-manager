import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppDataSource } from '../src/database/data-source';
import { runDemoSeed } from '../src/database/seeds/demo-seed';

describe('demo seed against the migrated schema', () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteen-demo-seed-'));

  beforeAll(() => {
    process.env.SCAN_STORAGE_DIR = storageDir;
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('is idempotent and binds every resolved demo sheet to the immutable bundled template', async () => {
    await runDemoSeed();
    await runDemoSeed();

    await AppDataSource.initialize();
    const [shape] = await AppDataSource.query(`
      SELECT
        count(*) FILTER (WHERE s.status = 'auto_accepted')::int AS accepted_count,
        count(*) FILTER (WHERE s.status = 'flagged')::int AS flagged_count,
        count(DISTINCT f.template_id)::int AS template_count,
        count(*) FILTER (
          WHERE f.template_id IS NULL
             OR f.form_mode <> 'code'
             OR f.roi_version <> t.revision
             OR t.revision <> 'a4-code-v3'
             OR t.paper_size <> 'A4'
             OR t.is_active
             OR t.activated_at IS NULL
             OR t.retired_at IS NULL
        )::int AS incoherent_count
      FROM sheets s
      JOIN issued_omr_forms f ON f.token = s.issued_form_id
      JOIN omr_form_templates t ON t.id = f.template_id
      WHERE s.batch = 'DEMO'
        AND s.status IN ('auto_accepted', 'flagged')
    `);
    expect(shape).toEqual({
      accepted_count: 25,
      flagged_count: 9,
      template_count: 1,
      incoherent_count: 0,
    });

    const flagged: Array<{ id: string; template_id: string; geometry_hash: string }> =
      await AppDataSource.query(`
        SELECT s.id, t.id AS template_id, t.geometry_hash
        FROM sheets s
        JOIN issued_omr_forms f ON f.token = s.issued_form_id
        JOIN omr_form_templates t ON t.id = f.template_id
        WHERE s.batch = 'DEMO' AND s.status = 'flagged'
      `);
    expect(flagged).toHaveLength(9);
    for (const row of flagged) {
      const cacheKey = `${row.template_id}:${row.geometry_hash}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      expect(fs.existsSync(path.join(storageDir, 'warped', `${row.id}__${cacheKey}.png`))).toBe(true);
    }

    const demoCases: Array<{ flag: string; count: number }> = await AppDataSource.query(`
      SELECT flag.value AS flag, count(*)::int AS count
      FROM sheets s
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.flags, '[]'::jsonb)) AS flag(value)
      WHERE s.batch = 'DEMO' AND s.status = 'flagged'
        AND flag.value IN ('DEMO_INSUFFICIENT_FUNDS', 'DEMO_LIMIT_AT_BOUNDARY', 'DEMO_LIMIT_EXCEEDED')
      GROUP BY flag.value
      ORDER BY flag.value
    `);
    expect(demoCases).toEqual([
      { flag: 'DEMO_INSUFFICIENT_FUNDS', count: 3 },
      { flag: 'DEMO_LIMIT_AT_BOUNDARY', count: 1 },
      { flag: 'DEMO_LIMIT_EXCEEDED', count: 2 },
    ]);
  }, 120_000);
});
