import 'reflect-metadata';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppEnv } from './config/env-validation';
import { AppModule } from './app.module';
import { SessionLoggerService } from './common/logging/session-logger.service';

/**
 * Log a timestamped startup step with elapsed time from process start.
 */
function logStep(step: string): void {
  const elapsed = (performance.now() / 1000).toFixed(2);
  console.log(`[STARTUP +${elapsed}s] ${step}`);
}

/**
 * Bootstrap the NestJS application.
 * In Electron mode (SQLite), runs pending migrations and seeds demo data automatically.
 * Sends IPC 'ready' message to the Electron parent process.
 */
async function bootstrap(): Promise<void> {
  logStep('bootstrap() called — creating NestJS app...');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  logStep('NestJS app created');

  // Initialise the file-backed session logger so all NestJS log output is captured
  // to a rotating log file. In SQLite (Electron) mode the log sits next to the DB;
  // in Postgres (Docker) mode it falls back to the working directory.
  const sessionLogger = app.get(SessionLoggerService);
  const config = app.get(ConfigService<AppEnv, true>);
  const dbType = config.get('DATABASE_TYPE', { infer: true });
  const logBaseDir = dbType === 'sqlite'
    ? path.dirname(config.get('DATABASE_PATH', { infer: true }) ?? '')
    : process.cwd();
  if (logBaseDir) {
    sessionLogger.init(logBaseDir);
    app.useLogger(sessionLogger);
  }
  logStep('Session logger initialised');

  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const dataSource = app.get(DataSource);
  logStep('DataSource obtained');

  // Run pending migrations for SQLite (Electron mode).
  // In Docker mode, the separate migrate container handles this.
  if (dbType === 'sqlite') {
    logStep('Checking for pending SQLite migrations...');
    const pending = await dataSource.showMigrations();
    if (pending) {
      logStep('Running pending SQLite migrations...');
      await dataSource.runMigrations();
      logStep('Migrations complete');
    } else {
      logStep('No pending migrations');
    }
  }

  // Seed MVP demo data on first launch (Electron/SQLite mode).
  // Checks for existing demo users — if none found, seeds the full dataset.
  const seedUser = config.get('SEED_ADMIN_USERNAME', { infer: true });
  const seedPass = config.get('SEED_ADMIN_PASSWORD', { infer: true });
  if (seedUser && seedPass && dbType === 'sqlite') {
    logStep('Checking if seeding is needed...');
    const { User } = await import('./users/user.entity');
    const userCount = await dataSource.getRepository(User).count();
    if (userCount === 0) {
      logStep('No users found — seeding MVP demo data...');
      const { seedMvpDemo } = await import('./database/seeds/mvp-seed');
      await seedMvpDemo(dataSource);
      logStep('MVP demo data seeded');
    } else {
      logStep(`Seeding skipped — ${userCount} user(s) already exist`);
    }
  }

  app.useBodyParser('json', { limit: '15mb' });

  const port = config.get('BACKEND_PORT', { infer: true });
  logStep(`Starting HTTP listener on 0.0.0.0:${port}...`);
  await app.listen(port, '0.0.0.0');
  logStep(`Backend listening on 0.0.0.0:${port}`);

  if (process.send) {
    process.send({ type: 'ready', port });
    logStep('IPC ready message sent to Electron');
  }

  process.on('message', (msg: unknown) => {
    if (msg && typeof msg === 'object' && (msg as { type: string }).type === 'shutdown') {
      console.log('Received shutdown signal, closing gracefully...');
      app.close().then(() => process.exit(0));
    }
  });
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error('Failed to start backend:', err);
    if (process.send) {
      process.send({ type: 'error', message: String(err) });
    }
    process.exit(1);
  });
}
