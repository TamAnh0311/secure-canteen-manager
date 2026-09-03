import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppEnv } from './config/env-validation';
import { AppModule } from './app.module';

/**
 * Bootstrap the NestJS application.
 * In Electron mode (SQLite), runs pending migrations automatically.
 * Sends IPC 'ready' message to the Electron parent process.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const config = app.get(ConfigService<AppEnv, true>);

  // Run pending migrations for SQLite (Electron mode).
  // In Docker mode, the separate migrate container handles this.
  const dbType = config.get('DATABASE_TYPE', { infer: true });
  if (dbType === 'sqlite') {
    const dataSource = app.get(DataSource);
    const pending = await dataSource.showMigrations();
    if (pending) {
      console.log('Running pending SQLite migrations...');
      await dataSource.runMigrations();
      console.log('Migrations complete.');
    }
  }

  // Seed admin operator if configured and not yet present.
  const seedUser = config.get('SEED_ADMIN_USERNAME', { infer: true });
  const seedPass = config.get('SEED_ADMIN_PASSWORD', { infer: true });
  if (seedUser && seedPass) {
    process.env['SEED_ADMIN_USERNAME'] = seedUser;
    process.env['SEED_ADMIN_PASSWORD'] = seedPass;
  }

  app.useBodyParser('json', { limit: '15mb' });

  const port = config.get('BACKEND_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(`Backend listening on 0.0.0.0:${port}`);

  if (process.send) {
    process.send({ type: 'ready', port });
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
