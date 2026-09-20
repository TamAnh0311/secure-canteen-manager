import * as path from 'path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ValidationPipe } from '@nestjs/common';

import configuration from './config/configuration';
import { AppEnv } from './config/env-validation';
import { AuthModule } from './auth/auth.module';
import { OperatorsModule } from './operators/operators.module';
import { UsersModule } from './users/users.module';
import { LegacySyncModule } from './legacy-sync/legacy-sync.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { AccountsModule } from './accounts/accounts.module';
import { CounterModule } from './counter/counter.module';
import { KioskModule } from './kiosk/kiosk.module';
import { PaymentConfigModule } from './payment-config/payment-config.module';
import { PurchaseLimitConfigModule } from './purchase-limit-config/purchase-limit-config.module';
import { HealthController } from './health/health.controller';
import { DiagnosticsController } from './common/logging/diagnostics.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { SessionLoggerService } from './common/logging/session-logger.service';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { OperatorZoneAccessModule } from './auth/operator-zone-access.module';
import { InitialSchema00000000000001 } from './database/migrations-sqlite/00000000000001-initial-schema';
import { AddOmrTables00000000000002 } from './database/migrations-sqlite/00000000000002-add-omr-tables';
import { AddAuditLogs00000000000003 } from './database/migrations-sqlite/00000000000003-add-audit-logs';
import { ScanLocalModule } from './scan-local/scan-local.module';

/**
 * Build TypeORM config dynamically based on DATABASE_TYPE.
 */
function buildTypeOrmConfig(config: ConfigService<AppEnv, true>) {
  const dbType = config.get('DATABASE_TYPE', { infer: true });
  const isDevLogging = config.get('NODE_ENV', { infer: true }) === 'development';

  if (dbType === 'sqlite') {
    return {
      type: 'better-sqlite3' as const,
      database: config.get('DATABASE_PATH', { infer: true }),
      synchronize: false,
      migrationsRun: false,
      migrationsTransactionMode: 'none' as const,
      autoLoadEntities: true,
      logging: isDevLogging,
      migrations: [InitialSchema00000000000001, AddOmrTables00000000000002, AddAuditLogs00000000000003],
      migrationsTableName: 'typeorm_migrations',
      prepareDatabase: (db: { pragma: (s: string) => void }) => {
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('foreign_keys = ON');
      },
    };
  }

  return {
    type: 'postgres' as const,
    url: config.get('DATABASE_URL', { infer: true }),
    synchronize: false,
    migrationsRun: false,
    autoLoadEntities: true,
    logging: isDevLogging,
    migrations: [path.join(__dirname, 'database', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '../deploy/.env'],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => buildTypeOrmConfig(config),
    }),
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const frontendPath = config.get('FRONTEND_DIST_PATH', { infer: true });
        if (!frontendPath) {
          // No static serving in Docker mode (Nginx handles it)
          return [{ rootPath: path.join(__dirname, '..', 'public-noop'), exclude: ['/api{/*path}'] }];
        }
        return [{ rootPath: frontendPath, exclude: ['/api{/*path}'] }];
      },
    }),
    AuthModule,
    OperatorZoneAccessModule,
    OperatorsModule,
    UsersModule,
    LegacySyncModule,
    MenuModule,
    OrdersModule,
    AccountsModule,
    CounterModule,
    KioskModule,
    PaymentConfigModule,
    PurchaseLimitConfigModule,
    ScanLocalModule,
    AuditModule,
  ],
  controllers: [HealthController, DiagnosticsController],
  providers: [
    SessionLoggerService,
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
