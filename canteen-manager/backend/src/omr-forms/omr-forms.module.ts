import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThresholdConfigModule } from '../config/threshold-config.module';
import { OmrClientModule } from '../omr/omr-client.module';
import { UsersModule } from '../users/users.module';
import { IssuedOmrForm } from './issued-omr-form.entity';
import { OmrFormsController } from './omr-forms.controller';
import { OmrFormsService } from './omr-forms.service';
import { OmrFormTemplate } from './omr-form-template.entity';
import { OmrFormTemplateRow } from './omr-form-template-row.entity';
import { OmrFormTemplatesService } from './omr-form-templates.service';
import { OperatorZoneAccessModule } from '../auth/operator-zone-access.module';
import { OmrOperationalModeService } from './omr-operational-mode.service';
import { ScanWorkflowModeModule } from '../config/scan-workflow-mode.module';

@Module({
  imports: [TypeOrmModule.forFeature([IssuedOmrForm, OmrFormTemplate, OmrFormTemplateRow]), UsersModule, ThresholdConfigModule, OmrClientModule, OperatorZoneAccessModule, ScanWorkflowModeModule],
  controllers: [OmrFormsController],
  providers: [OmrFormsService, OmrFormTemplatesService, OmrOperationalModeService],
  exports: [OmrFormsService, OmrFormTemplatesService, OmrOperationalModeService, TypeOrmModule],
})
export class OmrFormsModule {}
