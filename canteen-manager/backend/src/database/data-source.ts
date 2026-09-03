import 'reflect-metadata';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * Build TypeORM DataSource options based on DATABASE_TYPE env var.
 * Supports 'postgres' (Docker/production) and 'sqlite' (Electron).
 */
function buildOptions(): DataSourceOptions {
  const dbType = process.env['DATABASE_TYPE'] ?? 'postgres';

  if (dbType === 'sqlite') {
    const dbPath = process.env['DATABASE_PATH'] ?? 'canteen.sqlite';
    return {
      type: 'better-sqlite3',
      database: dbPath,
      synchronize: false,
      migrationsRun: false,
      logging: process.env['NODE_ENV'] === 'development',
      entities: [__dirname + '/../**/*.entity.{ts,js}'],
      migrations: [__dirname + '/migrations-sqlite/*.{ts,js}'],
      migrationsTableName: 'typeorm_migrations',
    };
  }

  return {
    type: 'postgres',
    url: process.env['DATABASE_URL'],
    synchronize: false,
    migrationsRun: false,
    logging: process.env['NODE_ENV'] === 'development',
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsTableName: 'typeorm_migrations',
  };
}

// Exported for TypeORM CLI (migration:generate/run/revert) and NestJS module.
export const AppDataSource = new DataSource(buildOptions());
