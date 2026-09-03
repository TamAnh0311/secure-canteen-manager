import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanWorkflowModeService } from './scan-workflow-mode.service';

@Module({
  imports: [ConfigModule],
  providers: [ScanWorkflowModeService],
  exports: [ScanWorkflowModeService],
})
export class ScanWorkflowModeModule {}
