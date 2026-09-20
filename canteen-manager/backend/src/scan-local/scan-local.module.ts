import { Module } from '@nestjs/common';
import { ThresholdConfigModule } from '../config/threshold-config.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { ScanLocalController } from './scan-local.controller';
import { ScanLocalService } from './scan-local.service';

@Module({
  imports: [ThresholdConfigModule, MenuModule, OrdersModule],
  controllers: [ScanLocalController],
  providers: [ScanLocalService],
})
export class ScanLocalModule {}
