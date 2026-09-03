import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../health.controller';
import { DataSource } from 'typeorm';

function makeDataSource(rejects: boolean): DataSource {
  return {
    query: rejects
      ? jest.fn().mockRejectedValue(new Error('connection refused'))
      : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as DataSource;
}

describe('HealthController', () => {
  it('returns { status: ok, db: up } when DB query succeeds', async () => {
    const controller = new HealthController(makeDataSource(false));
    const result = await controller.check();
    expect(result).toEqual({ status: 'ok', db: 'up' });
  });

  it('throws ServiceUnavailableException (503) when DB query fails', async () => {
    const controller = new HealthController(makeDataSource(true));
    const err = await controller.check().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'HEALTH.DB_UNAVAILABLE' });
  });
});
