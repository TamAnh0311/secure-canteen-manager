import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { SyncRun } from './sync-run.entity';
import { LegacySyncService } from './legacy-sync.service';
import { LegacySyncController } from './legacy-sync.controller';
import { MssqlLegacyEmployeeSource } from './mssql-legacy-employee-source';
import { LEGACY_EMPLOYEE_SOURCE } from './legacy-employee-source';

@Module({
  imports: [TypeOrmModule.forFeature([User, SyncRun])],
  controllers: [LegacySyncController],
  providers: [
    LegacySyncService,
    { provide: LEGACY_EMPLOYEE_SOURCE, useClass: MssqlLegacyEmployeeSource },
  ],
  exports: [LegacySyncService],
})
export class LegacySyncModule {}
