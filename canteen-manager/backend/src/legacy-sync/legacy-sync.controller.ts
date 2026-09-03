import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { LegacySyncService, SkippedResult } from './legacy-sync.service';
import { SyncRun } from './sync-run.entity';

@Controller('admin/legacy-sync')
@Roles(OperatorRole.ADMIN)
export class LegacySyncController {
  constructor(private readonly legacySyncService: LegacySyncService) {}

  @Post()
  run(): Promise<SyncRun | SkippedResult> {
    return this.legacySyncService.run('manual');
  }

  @Get('status')
  status(): Promise<SyncRun | null> {
    return this.legacySyncService.getStatus();
  }
}
