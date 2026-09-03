import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sheet } from './sheet.entity';
import { User } from '../users/user.entity';
import { ScansService } from './scans.service';
import { DemoScanService } from './demo-scan.service';
import { ScansController } from './scans.controller';
import { ScanProcessorService } from './scan-processor.service';
import { ScanStorageService } from './scan-storage.service';
import { ScanAuthGuard } from './scan-auth.guard';
import { UsersModule } from '../users/users.module';
import { OrdersModule } from '../orders/orders.module';
import { MenuModule } from '../menu/menu.module';
import { AccountsModule } from '../accounts/accounts.module';
import { OmrClientModule } from '../omr/omr-client.module';
import { ThresholdConfigModule } from '../config/threshold-config.module';
import { AuthModule } from '../auth/auth.module';
import { Operator } from '../operators/operator.entity';
import { Order } from '../orders/order.entity';
import { VerifyController } from './verify/verify.controller';
import { VerifyService } from './verify/verify.service';
import { ScanImageValidatorService } from './scan-image-validator.service';
import { OmrFormsModule } from '../omr-forms/omr-forms.module';
import { ScanAdmissionService } from './scan-admission.service';
import { ScanRetentionService } from './scan-retention.service';
import { ScanStorageReconciliationService } from './scan-storage-reconciliation.service';
import { PurchaseLimitConfigModule } from '../purchase-limit-config/purchase-limit-config.module';
import { ScannerWebhookEvent } from './webhook/scanner-webhook-event.entity';
import { ScannerArtifactJob } from './webhook/scanner-artifact-job.entity';
import { ScannerWebhookController } from './webhook/scanner-webhook.controller';
import { ScannerWebhookAuthGuard } from './webhook/scanner-webhook-auth.guard';
import { ScannerWebhookService } from './webhook/scanner-webhook.service';
import { ScannerArtifactImporterService } from './webhook/scanner-artifact-importer.service';
import { ScanWorkflowModeModule } from '../config/scan-workflow-mode.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sheet, Operator, Order, User, ScannerWebhookEvent, ScannerArtifactJob]),
    UsersModule,
    OrdersModule,
    MenuModule,
    AccountsModule,
    OmrClientModule,
    ThresholdConfigModule,
    // AuthModule provides JwtModule (and thus JwtService) needed by ScanAuthGuard
    AuthModule,
    OmrFormsModule,
    PurchaseLimitConfigModule,
    ScanWorkflowModeModule,
  ],
  controllers: [ScansController, VerifyController, ScannerWebhookController],
  providers: [ScansService, DemoScanService, ScanProcessorService, ScanStorageService, ScanStorageReconciliationService, ScanImageValidatorService, ScanAdmissionService, ScanRetentionService, ScanAuthGuard, VerifyService, ScannerWebhookAuthGuard, ScannerWebhookService, ScannerArtifactImporterService],
})
export class ScansModule {}
