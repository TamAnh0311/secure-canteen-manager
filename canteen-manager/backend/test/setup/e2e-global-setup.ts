import 'reflect-metadata';
import { DataSource } from 'typeorm';

// Jest globalSetup: runs ONCE before the whole e2e suite. Drops the e2e database and replays
// the full migration chain from empty, so the suite always runs against the current schema —
// never a stale, session-era shape left behind by an older run. globalSetup executes in its
// own process before any worker imports a test module, so it cannot read test/setup/e2e-env.ts
// (a `setupFiles` entry, scoped to the worker). It resolves the same connection string here.
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://canteen:change_me_in_production@localhost:55433/canteen_e2e';

export default async function globalSetup(): Promise<void> {
  const ds = new DataSource({
    type: 'postgres',
    url: E2E_DATABASE_URL,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    // Resolve from compiled JS or ts-jest source; the chain is identical to data-source.ts.
    entities: [__dirname + '/../../src/**/*.entity.{ts,js}'],
    migrations: [__dirname + '/../../src/database/migrations/*.{ts,js}'],
    migrationsTableName: 'typeorm_migrations',
  });

  await ds.initialize();
  try {
    await ds.dropDatabase();
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}
