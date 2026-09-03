import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { KioskService, KioskPrisonerView, KioskOrderResult } from './kiosk.service';
import { CreateKioskOrderDto } from './dto/create-kiosk-order.dto';
import { KioskLookupRateLimitGuard } from './kiosk-lookup-rate-limit.guard';

// Relative-facing kiosk on the trusted LAN. Routes are @Public (bypass JwtAuthGuard): a
// read-only prisoner view plus a single write that places a PENDING order — money is never
// moved here (the order is unpaid until a cashier accepts it at the counter).
@Controller('kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Public()
  @Get('prisoner/:prisonId')
  @UseGuards(KioskLookupRateLimitGuard)
  prisoner(@Param('prisonId') prisonId: string): Promise<KioskPrisonerView> {
    return this.kioskService.prisonerView(prisonId);
  }

  @Public()
  @Post('orders')
  placeOrder(@Body() dto: CreateKioskOrderDto): Promise<KioskOrderResult> {
    return this.kioskService.placeOrder(dto);
  }
}
