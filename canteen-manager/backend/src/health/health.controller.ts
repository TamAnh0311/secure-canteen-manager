import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

interface HealthResponse {
  status: 'ok';
  db: 'up';
}

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'up' };
    } catch {
      // 503 so compose healthcheck and load-balancers treat DB-down as not-ready
      throw new ServiceUnavailableException({ message: 'Database unavailable', code: 'HEALTH.DB_UNAVAILABLE' });
    }
  }
}
