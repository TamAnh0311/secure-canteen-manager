import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from './config/env-validation';
import { AppModule } from './app.module';

export function configureRequestBodyParsers(
  app: NestExpressApplication,
  config: ConfigService<AppEnv, true>,
): void {
  // Preserve scanner callback bytes exactly; the webhook service parses only after
  // its dedicated bearer guard accepts the request. The general JSON parser below
  // remains responsible for the existing /scans 15 MiB contract.
  app.use(
    '/webhooks/order-scanner',
    express.raw({
      type: 'application/json',
      limit: config.get('SCANNER_WEBHOOK_MAX_PAYLOAD_BYTES', { infer: true }),
    }),
  );
  // Scan uploads carry a base64-encoded form image in the JSON body; a scanned
  // ADF page base64-inflates well past Express's 100kb default, so raise the
  // JSON limit to keep /scans from rejecting real images with 413.
  app.useBodyParser('json', { limit: '15mb' });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Production has exactly one Nginx hop. Compose binds this backend port to
  // host loopback, so LAN clients cannot bypass Nginx and spoof forwarded IPs.
  app.set('trust proxy', 1);
  const config = app.get(ConfigService<AppEnv, true>);
  configureRequestBodyParsers(app, config);
  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`Backend listening on port ${port}`);
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error('Failed to start backend:', err);
    process.exit(1);
  });
}
