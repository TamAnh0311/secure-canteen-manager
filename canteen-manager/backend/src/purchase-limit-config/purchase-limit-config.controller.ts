import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { UpdatePurchaseLimitConfigDto } from './dto/update-purchase-limit-config.dto';
import { PurchaseLimitConfigService, PurchaseLimitConfigView } from './purchase-limit-config.service';

@Controller('config/purchase-limits')
@Roles(OperatorRole.ADMIN)
export class PurchaseLimitConfigController {
  constructor(private readonly service: PurchaseLimitConfigService) {}

  @Get()
  async get(): Promise<PurchaseLimitConfigView> {
    return this.service.toView(await this.service.getGlobal());
  }

  @Put()
  async update(@Body() dto: UpdatePurchaseLimitConfigDto): Promise<PurchaseLimitConfigView> {
    return this.service.toView(await this.service.updateGlobal(dto));
  }
}
