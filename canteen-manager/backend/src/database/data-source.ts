import 'dotenv/config';
import 'reflect-metadata';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Operator } from '../operators/operator.entity';
import { User } from '../users/user.entity';
import { MenuItem } from '../menu/menu-item.entity';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { PrisonerAccount } from '../accounts/prisoner-account.entity';
import { AccountTransaction } from '../accounts/account-transaction.entity';
import { PurchaseLimitConfig } from '../purchase-limit-config/purchase-limit-config.entity';
import { PaymentConfig } from '../payment-config/payment-config.entity';
import { Tg8Document } from '../orders/tg8-document.entity';
import { SyncRun } from '../legacy-sync/sync-run.entity';
import { InitialSchema00000000000001 } from './migrations-sqlite/00000000000001-initial-schema';

/** Entities compatible with SQLite (no Postgres-only types like char, jsonb, arrays). */
const sqliteEntities = [
  Operator, User, MenuItem, Order, OrderItem, Tg8Document,
  PrisonerAccount, AccountTransaction,
  PurchaseLimitConfig, PaymentConfig, SyncRun,
];

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
      migrationsTransactionMode: 'none' as const,
      logging: process.env['NODE_ENV'] === 'development',
      entities: sqliteEntities,
      migrations: [InitialSchema00000000000001],
      migrationsTableName: 'typeorm_migrations',
      prepareDatabase: (db: { pragma: (s: string) => void }) => {
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('foreign_keys = ON');
      },
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
