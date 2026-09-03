import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseLimitConfigController } from './purchase-limit-config.controller';
import { PurchaseLimitConfig } from './purchase-limit-config.entity';
import { PurchaseLimitConfigService } from './purchase-limit-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([PurchaseLimitConfig])],
  controllers: [PurchaseLimitConfigController],
  providers: [PurchaseLimitConfigService],
  exports: [PurchaseLimitConfigService],
})
export class PurchaseLimitConfigModule {}
