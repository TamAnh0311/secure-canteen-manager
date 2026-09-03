import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentConfig } from './payment-config.entity';
import { PaymentConfigService } from './payment-config.service';
import { PaymentConfigController } from './payment-config.controller';

// Exports the service so the kiosk can read the configured account to build its offline VietQR.
@Module({
  imports: [TypeOrmModule.forFeature([PaymentConfig])],
  controllers: [PaymentConfigController],
  providers: [PaymentConfigService],
  exports: [PaymentConfigService],
})
export class PaymentConfigModule {}
