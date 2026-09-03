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
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { OperatorZoneAccessModule } from './auth/operator-zone-access.module';

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
      autoLoadEntities: true,
      logging: isDevLogging,
    };
  }

  return {
    type: 'postgres' as const,
    url: config.get('DATABASE_URL', { infer: true }),
    synchronize: false,
    migrationsRun: false,
    autoLoadEntities: true,
    logging: isDevLogging,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '../deploy/.env',
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
          return [{ rootPath: path.join(__dirname, '..', 'public-noop'), exclude: ['/(.*)'] }];
        }
        return [{ rootPath: frontendPath, exclude: ['/api/(.*)'] }];
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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
