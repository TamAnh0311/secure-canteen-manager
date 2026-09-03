import 'reflect-metadata';
import { DataSource } from 'typeorm';

// Primary Postgres DataSource — exported for TypeORM CLI (migration:generate/run/revert).
// Named 'default' so NestJS TypeORM module picks it up without extra config.
// A second read-only legacy DataSource is wired separately in the legacy-sync module
// and must use a distinct name to avoid connection pool collision.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env['DATABASE_URL'],
  synchronize: false,
  migrationsRun: false,
  logging: process.env['NODE_ENV'] === 'development',
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsTableName: 'typeorm_migrations',
});
