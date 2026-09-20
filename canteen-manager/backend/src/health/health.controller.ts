import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { AppEnv } from '../config/env-validation';

interface HealthResponse {
  status: 'ok';
  db: 'up';
}

interface ConnectionInfoResponse {
  /** LAN URL tablets can use to reach the canteen page, or null if unavailable. */
  canteenUrl: string | null;
}

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ message: 'Database unavailable', code: 'HEALTH.DB_UNAVAILABLE' });
    }
  }

  /**
   * Return the LAN URL for tablet connections.
   * Only meaningful in Electron mode where LAN_IP is set.
   */
  @Public()
  @Get('connection-info')
  getConnectionInfo(): ConnectionInfoResponse {
    const lanIp = this.config.get('LAN_IP', { infer: true });
    const port = this.config.get('BACKEND_PORT', { infer: true });
    if (!lanIp) {
      return { canteenUrl: null };
    }
    return { canteenUrl: `http://${lanIp}:${port}/canteen` };
  }
}
