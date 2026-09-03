import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ThresholdConfigService } from './threshold-config.service';
import { ThresholdConfig } from './threshold-config.entity';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';

class UpdateThresholdsBody {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  icrThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  omrEmptyMax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  omrTickedMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(4)
  @Max(10)
  @Type(() => Number)
  digitBoxCount?: number;
}

@Controller('config/thresholds')
@Roles(OperatorRole.ADMIN)
export class ThresholdConfigController {
  constructor(private readonly service: ThresholdConfigService) {}

  @Get()
  get(): Promise<ThresholdConfig> {
    return this.service.getGlobal();
  }

  @Put()
  update(@Body() body: UpdateThresholdsBody): Promise<ThresholdConfig> {
    return this.service.updateGlobal(body);
  }
}
