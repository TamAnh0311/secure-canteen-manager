import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItem } from './menu-item.entity';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { ThresholdConfigModule } from '../config/threshold-config.module';
import { OmrClientModule } from '../omr/omr-client.module';
import { OmrFormsModule } from '../omr-forms/omr-forms.module';
import { ScanWorkflowModeModule } from '../config/scan-workflow-mode.module';

// The menu is a single global list with no per-day scoping. It pulls ThresholdConfigModule for
// the global ROI form template (the form-generated lock signal) and OmrClientModule for the
// /menu/form generate call.
@Module({
  imports: [
    TypeOrmModule.forFeature([MenuItem]),
    ThresholdConfigModule,
    OmrClientModule,
    OmrFormsModule,
    ScanWorkflowModeModule,
  ],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
