import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../health.controller';
import { DataSource } from 'typeorm';
import type { AppEnv } from '../../config/env-validation';
import type { ConfigService } from '@nestjs/config';

function makeDataSource(rejects: boolean): DataSource {
  return {
    query: rejects
      ? jest.fn().mockRejectedValue(new Error('connection refused'))
      : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as DataSource;
}

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService<AppEnv, true> {
  const values: Record<string, unknown> = {
    LAN_IP: '192.168.1.100',
    BACKEND_PORT: 3000,
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<AppEnv, true>;
}

describe('HealthController', () => {
  it('returns { status: ok, db: up } when DB query succeeds', async () => {
    const controller = new HealthController(makeDataSource(false), makeConfig());
    const result = await controller.check();
    expect(result).toEqual({ status: 'ok', db: 'up' });
  });

  it('throws ServiceUnavailableException (503) when DB query fails', async () => {
    const controller = new HealthController(makeDataSource(true), makeConfig());
    const err = await controller.check().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'HEALTH.DB_UNAVAILABLE' });
  });

  it('returns canteenUrl when LAN_IP is set', () => {
    const controller = new HealthController(makeDataSource(false), makeConfig());
    expect(controller.getConnectionInfo()).toEqual({ canteenUrl: 'http://192.168.1.100:3000/canteen' });
  });

  it('returns null canteenUrl when LAN_IP is not set', () => {
    const controller = new HealthController(makeDataSource(false), makeConfig({ LAN_IP: undefined }));
    expect(controller.getConnectionInfo()).toEqual({ canteenUrl: null });
  });
});
