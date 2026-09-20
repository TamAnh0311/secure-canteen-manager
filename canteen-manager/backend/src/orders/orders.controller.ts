import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { OrdersService, OrderWithItems, DeliveryVoucher, DashboardStats, FinancialReport } from './orders.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { GetVouchersDto } from './dto/get-vouchers.dto';
import { GetStatsDto } from './dto/get-stats.dto';
import { Order } from './order.entity';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';

interface AuthRequest {
  user: OperatorPublic;
}

// No public create endpoint — orders are ingested via OrdersService.createOrReplace()
// called by the OMR ingestion pipeline. Reads are available to all authenticated operators.
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@Query() query: ListOrdersDto, @Req() req: AuthRequest): Promise<Order[]> {
    return this.ordersService.findAll(query, req.user);
  }

  /** Dashboard aggregate stats for a service-date range. Available to all authenticated operators. */
  @Get('stats')
  getStats(@Query() query: GetStatsDto): Promise<DashboardStats> {
    return this.ordersService.getStats(query);
  }

  /** Admin-only financial report across a date range. */
  @Get('financial-report')
  @Roles(OperatorRole.ADMIN)
  getFinancialReport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ): Promise<FinancialReport> {
    return this.ordersService.getFinancialReport(dateFrom, dateTo);
  }

  // ADMIN-only delivery vouchers. MUST stay declared before @Get(':id') — a literal route has
  // to precede the param route, else "vouchers" is captured by :id and ParseUUIDPipe 400s it.
  @Get('vouchers')
  @Roles(OperatorRole.ADMIN)
  getVouchers(@Query() query: GetVouchersDto): Promise<DeliveryVoucher[]> {
    return this.ordersService.getDeliveryVouchers({ date: query.date });
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ): Promise<OrderWithItems> {
    return this.ordersService.findOne(id, req.user);
  }
}
