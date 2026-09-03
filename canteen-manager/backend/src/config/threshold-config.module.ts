import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThresholdConfig } from './threshold-config.entity';
import { ThresholdConfigService } from './threshold-config.service';
import { ThresholdConfigController } from './threshold-config.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ThresholdConfig])],
  controllers: [ThresholdConfigController],
  providers: [ThresholdConfigService],
  exports: [ThresholdConfigService],
})
export class ThresholdConfigModule {}
